import {
  Address,
  AssetId,
  AssetName,
  PaymentAddress,
  PolicyId,
  Script,
  toHex,
  TransactionOutput,
} from "@blaze-cardano/core";
import { serialize, parse } from "@blaze-cardano/data";
import { resolve } from "path";

import type { PromoteUpgradeOptions } from "../lib/types";
import { getNetworkId } from "../lib/types";
import { getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import {
  getContractInstances,
  getCredentialAddress,
  getTwoStageContracts,
} from "../lib/contracts";
import { extractSignersFromMultisigState } from "../lib/signers";
import {
  printSuccess,
  printError,
  printProgress,
  writeCborFile,
} from "../utils/output";
import {
  createNativeMultisigScript,
  createRewardAccount,
  signTransaction,
  attachWitnesses,
  findUtxoWithMainAsset,
  findUtxoWithStagingAsset,
  findUtxoByTxRef,
} from "../utils/transaction";
import * as Contracts from "../../contract_blueprint";

export async function promoteUpgrade(options: PromoteUpgradeOptions): Promise<void> {
  const { network, output, validator, txHash, txIndex, sign, outputFile } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nPromoting staged upgrade to main for ${validator} on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances();
  const targetContracts = getTwoStageContracts(validator);

  // Create addresses for required contracts
  const twoStageAddress = getCredentialAddress(
    network,
    targetContracts.twoStage.Script.hash(),
  );
  const techAuthForeverAddress = getCredentialAddress(
    network,
    contracts.techAuthForever.Script.hash(),
  );
  const councilForeverAddress = getCredentialAddress(
    network,
    contracts.councilForever.Script.hash(),
  );
  const mainGovThresholdAddress = getCredentialAddress(
    network,
    contracts.mainGovThreshold.Script.hash(),
  );

  console.log("\nTwo Stage Address:", twoStageAddress.toBech32());

  // Create provider and fetch UTxOs
  const { blaze, provider } = await createBlaze(network, options.provider);

  printProgress("Fetching contract UTxOs...");

  const twoStageUtxos = await provider.getUnspentOutputs(twoStageAddress);
  const techAuthForeverUtxos = await provider.getUnspentOutputs(techAuthForeverAddress);
  const councilForeverUtxos = await provider.getUnspentOutputs(councilForeverAddress);
  const mainGovThresholdUtxos = await provider.getUnspentOutputs(mainGovThresholdAddress);

  console.log("\nFound contract UTxOs:");
  console.log("  Two stage:", twoStageUtxos.length);
  console.log("  Tech auth forever:", techAuthForeverUtxos.length);
  console.log("  Council forever:", councilForeverUtxos.length);
  console.log("  Main gov threshold:", mainGovThresholdUtxos.length);

  if (
    !twoStageUtxos.length ||
    !techAuthForeverUtxos.length ||
    !councilForeverUtxos.length ||
    !mainGovThresholdUtxos.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const mainUtxo = findUtxoWithMainAsset(twoStageUtxos);
  const stagingUtxo = findUtxoWithStagingAsset(twoStageUtxos);
  const techAuthForeverUtxo = techAuthForeverUtxos[0];
  const councilForeverUtxo = councilForeverUtxos[0];
  const mainGovThresholdUtxo = mainGovThresholdUtxos[0];

  if (!mainUtxo) {
    throw new Error('Could not find two-stage UTxO with "main" asset');
  }
  if (!stagingUtxo) {
    throw new Error('Could not find two-stage UTxO with "staging" asset');
  }

  // Parse current states
  console.log("\nReading current tech auth state...");
  const techAuthDatum = techAuthForeverUtxo.output().datum();
  if (!techAuthDatum?.asInlineData()) {
    throw new Error("Tech auth forever UTxO missing inline datum");
  }
  const techAuthState = parse(
    Contracts.VersionedMultisig,
    techAuthDatum.asInlineData()!,
  );
  const techAuthSigners = extractSignersFromMultisigState(techAuthState);

  console.log("Reading current council state...");
  const councilDatum = councilForeverUtxo.output().datum();
  if (!councilDatum?.asInlineData()) {
    throw new Error("Council forever UTxO missing inline datum");
  }
  const councilState = parse(
    Contracts.VersionedMultisig,
    councilDatum.asInlineData()!,
  );
  const councilSigners = extractSignersFromMultisigState(councilState);

  console.log("Reading main gov threshold...");
  const thresholdDatum = mainGovThresholdUtxo.output().datum();
  if (!thresholdDatum?.asInlineData()) {
    throw new Error("Main gov threshold UTxO missing inline datum");
  }
  const thresholdState = parse(
    Contracts.MultisigThreshold,
    thresholdDatum.asInlineData()!,
  );

  // Parse staging state to get the staged logic hash
  console.log("Reading staging state...");
  const stagingDatum = stagingUtxo.output().datum();
  if (!stagingDatum?.asInlineData()) {
    throw new Error("Staging UTxO missing inline datum");
  }
  const stagingState = parse(
    Contracts.UpgradeState,
    stagingDatum.asInlineData()!,
  );
  const stagedLogicHash = stagingState[0];

  console.log(`\nStaged logic hash to promote: ${stagedLogicHash}`);

  // Calculate required signers based on threshold
  const techAuthRequiredSigners = Number(
    (BigInt(techAuthSigners.length) * thresholdState.technical_auth_numerator +
      (thresholdState.technical_auth_denominator - 1n)) /
      thresholdState.technical_auth_denominator,
  );
  const councilRequiredSigners = Number(
    (BigInt(councilSigners.length) * thresholdState.council_numerator +
      (thresholdState.council_denominator - 1n)) /
      thresholdState.council_denominator,
  );

  console.log(`\nRequired tech auth signers: ${techAuthRequiredSigners}/${techAuthSigners.length}`);
  console.log(`Required council signers: ${councilRequiredSigners}/${councilSigners.length}`);

  // Create native scripts for multisig validation
  const techAuthNativeScript = createNativeMultisigScript(
    techAuthRequiredSigners,
    techAuthSigners,
    networkId,
  );
  const councilNativeScript = createNativeMultisigScript(
    councilRequiredSigners,
    councilSigners,
    networkId,
  );

  const techAuthWitnessPolicy = PolicyId(techAuthNativeScript.hash());
  const councilWitnessPolicy = PolicyId(councilNativeScript.hash());

  // Create gov auth reward account
  const govAuthRewardAccount = createRewardAccount(
    contracts.govAuth.Script.hash(),
    networkId,
  );

  // Get staging UTxO reference for redeemer
  const stagingInput = stagingUtxo.input();

  // Build redeemer - Main variant references the staging UTxO
  const redeemer = serialize(Contracts.TwoStageRedeemer, {
    update_field: "Logic",
    which_stage: {
      Main: [
        {
          transaction_id: stagingInput.transactionId(),
          output_index: BigInt(stagingInput.index()),
        },
      ],
    },
  });

  // Parse current main datum to get round
  const mainDatum = mainUtxo.output().datum();
  if (!mainDatum?.asInlineData()) {
    throw new Error("Main UTxO missing inline datum");
  }
  const currentMainState = parse(
    Contracts.UpgradeState,
    mainDatum.asInlineData()!,
  );

  // New main state with staged logic and incremented round
  const newMainState: Contracts.UpgradeState = [
    stagedLogicHash,
    currentMainState[1], // keep mitigation_logic
    currentMainState[2], // keep gov_auth
    currentMainState[3], // keep mitigation_auth
    currentMainState[4], // keep delay
    currentMainState[5] + 1n, // increment round
  ];

  // Build gov auth redeemer (using first tech auth signer)
  const govAuthRedeemerData = serialize(Contracts.PermissionedRedeemer, {
    [techAuthSigners[0].paymentHash]: techAuthSigners[0].sr25519Key,
  });

  // Fetch user UTxO
  printProgress("Fetching user UTXO...");
  const changeAddress = Address.fromBech32(deployerAddress);
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);
  const userUtxo = findUtxoByTxRef(deployerUtxos, txHash, txIndex);

  if (!userUtxo) {
    throw new Error(`User UTXO not found: ${txHash}#${txIndex}`);
  }

  // Build transaction
  printProgress("Building transaction...");

  const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));
  const TECH_WITNESS_ASSET = toHex(new TextEncoder().encode("tech-auth-witness"));
  const COUNCIL_WITNESS_ASSET = toHex(new TextEncoder().encode("council-auth-witness"));

  try {
    const txBuilder = blaze
      .newTransaction()
      .addInput(mainUtxo, redeemer)
      .addInput(userUtxo)
      .addReferenceInput(stagingUtxo)
      .addReferenceInput(mainGovThresholdUtxo)
      .addReferenceInput(techAuthForeverUtxo)
      .addReferenceInput(councilForeverUtxo)
      .provideScript(targetContracts.twoStage.Script)
      .provideScript(contracts.govAuth.Script)
      .addMint(techAuthWitnessPolicy, new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]))
      .provideScript(Script.newNativeScript(techAuthNativeScript))
      .addMint(councilWitnessPolicy, new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]))
      .provideScript(Script.newNativeScript(councilNativeScript))
      .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: mainUtxo.output().amount().coin(),
            assets: new Map([
              [
                AssetId(targetContracts.twoStage.Script.hash() + MAIN_TOKEN_HEX),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, newMainState).toCore(),
        }),
      )
      .setChangeAddress(changeAddress)
      .setFeePadding(50000n);

    printProgress("Completing transaction (with evaluation)...");
    const tx = await txBuilder.complete();

    printSuccess(`Transaction built: ${tx.getId()}`);

    if (sign) {
      // Sign with both tech auth and council keys
      const { parsePrivateKeys } = await import("../lib/signers");
      const signerKeyGroups = [
        { label: "tech auth", keys: parsePrivateKeys("TECH_AUTH_PRIVATE_KEYS") },
        { label: "council", keys: parsePrivateKeys("COUNCIL_PRIVATE_KEYS") },
      ];

      const allSignatures: ReturnType<typeof signTransaction> = [];

      for (const { label, keys } of signerKeyGroups) {
        console.log(`\nSigning with ${keys.length} ${label} private keys...`);
        const signatures = signTransaction(tx.getId(), keys);
        allSignatures.push(...signatures);
        console.log(`  Created ${signatures.length} signatures`);
      }

      const signedTx = attachWitnesses(tx.toCbor(), allSignatures);
      writeCborFile(outputPath, signedTx.toCbor());
      printSuccess(`Signed transaction written to ${outputPath}`);
    } else {
      writeCborFile(outputPath, tx.toCbor());
      printSuccess(`Unsigned transaction written to ${outputPath}`);
    }

    console.log("\nTransaction ID:", tx.getId());
  } catch (error) {
    printError("Transaction build failed");
    console.error(error);
    throw error;
  }
}
