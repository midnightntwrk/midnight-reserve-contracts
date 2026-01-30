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

import type { StageUpgradeOptions } from "../lib/types";
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
  writeTransactionFile,
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

export async function stageUpgrade(
  options: StageUpgradeOptions,
): Promise<void> {
  const {
    network,
    output,
    validator,
    newLogicHash,
    txHash,
    txIndex,
    sign,
    outputFile,
  } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nStaging upgrade for ${validator} on ${network} network`);
  console.log(`New logic hash: ${newLogicHash}`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances(network);
  const targetContracts = getTwoStageContracts(validator, network);

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
  // stagingGovThreshold is used because the two-stage datum stores stagingGovAuth
  // and stagingGovAuth selects threshold based on whether logic is on main
  const stagingGovThresholdAddress = getCredentialAddress(
    network,
    contracts.stagingGovThreshold.Script.hash(),
  );
  // Council two-stage is needed for staging_gov_auth's logic_is_on_main check
  const councilTwoStageAddress = getCredentialAddress(
    network,
    contracts.councilTwoStage.Script.hash(),
  );

  console.log("\nTwo Stage Address:", twoStageAddress.toBech32());

  const { blaze, provider } = await createBlaze(network, options.provider);
  const twoStageUtxos = await provider.getUnspentOutputs(twoStageAddress);
  const techAuthForeverUtxos = await provider.getUnspentOutputs(
    techAuthForeverAddress,
  );
  const councilForeverUtxos = await provider.getUnspentOutputs(
    councilForeverAddress,
  );
  const stagingGovThresholdUtxos = await provider.getUnspentOutputs(
    stagingGovThresholdAddress,
  );
  const councilTwoStageUtxos = await provider.getUnspentOutputs(
    councilTwoStageAddress,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Two stage:", twoStageUtxos.length);
  console.log("  Tech auth forever:", techAuthForeverUtxos.length);
  console.log("  Council forever:", councilForeverUtxos.length);
  console.log("  Staging gov threshold:", stagingGovThresholdUtxos.length);
  console.log("  Council two stage:", councilTwoStageUtxos.length);

  if (
    !twoStageUtxos.length ||
    !techAuthForeverUtxos.length ||
    !councilForeverUtxos.length ||
    !stagingGovThresholdUtxos.length ||
    !councilTwoStageUtxos.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const mainUtxo = findUtxoWithMainAsset(twoStageUtxos);
  const stagingUtxo = findUtxoWithStagingAsset(twoStageUtxos);
  const techAuthForeverUtxo = techAuthForeverUtxos[0];
  const councilForeverUtxo = councilForeverUtxos[0];
  const stagingGovThresholdUtxo = stagingGovThresholdUtxos[0];
  const councilTwoStageMainUtxo = findUtxoWithMainAsset(councilTwoStageUtxos);

  if (!mainUtxo) {
    throw new Error('Could not find two-stage UTxO with "main" asset');
  }
  if (!stagingUtxo) {
    throw new Error('Could not find two-stage UTxO with "staging" asset');
  }
  if (!councilTwoStageMainUtxo) {
    throw new Error('Could not find council two-stage UTxO with "main" asset');
  }

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

  console.log("Reading staging gov threshold...");
  const thresholdDatum = stagingGovThresholdUtxo.output().datum();
  if (!thresholdDatum?.asInlineData()) {
    throw new Error("Staging gov threshold UTxO missing inline datum");
  }
  const thresholdState = parse(
    Contracts.MultisigThreshold,
    thresholdDatum.asInlineData()!,
  );

  // Calculate required signers based on threshold
  // MultisigThreshold is now a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;
  const techAuthRequiredSigners = Number(
    (BigInt(techAuthSigners.length) * techAuthNum + (techAuthDenom - 1n)) /
      techAuthDenom,
  );
  const councilRequiredSigners = Number(
    (BigInt(councilSigners.length) * councilNum + (councilDenom - 1n)) /
      councilDenom,
  );

  console.log(
    `\nRequired tech auth signers: ${techAuthRequiredSigners}/${techAuthSigners.length}`,
  );
  console.log(
    `Required council signers: ${councilRequiredSigners}/${councilSigners.length}`,
  );

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
  // Use stagingGovAuth for staging operations - the datum stores stagingGovAuth as auth
  const govAuthRewardAccount = createRewardAccount(
    contracts.stagingGovAuth.Script.hash(),
    networkId,
  );

  // Get main UTxO reference for redeemer
  const mainInput = mainUtxo.input();

  // Build redeemer
  // TwoStageRedeemer is now a tuple: [UpdateField, WhichStage]
  const redeemer = serialize(Contracts.TwoStageRedeemer, [
    "Logic",
    {
      Staging: [
        {
          transaction_id: mainInput.transactionId(),
          output_index: BigInt(mainInput.index()),
        },
        newLogicHash,
      ],
    },
  ]);

  // Parse current staging datum to get round
  const stagingDatum = stagingUtxo.output().datum();
  if (!stagingDatum?.asInlineData()) {
    throw new Error("Staging UTxO missing inline datum");
  }
  const currentStagingState = parse(
    Contracts.UpgradeState,
    stagingDatum.asInlineData()!,
  );

  const newStagingState: Contracts.UpgradeState = [
    newLogicHash,
    currentStagingState[1], // keep mitigation_logic
    currentStagingState[2], // keep gov_auth
    currentStagingState[3], // keep mitigation_auth
    currentStagingState[4], // keep round
    currentStagingState[5] + 1n, // increment logic round
  ];

  // Build gov auth redeemer (using first tech auth signer)
  const govAuthRedeemerData = serialize(Contracts.PermissionedRedeemer, {
    [techAuthSigners[0].paymentHash]: techAuthSigners[0].sr25519Key,
  });

  const changeAddress = Address.fromBech32(deployerAddress);
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);
  const userUtxo = findUtxoByTxRef(deployerUtxos, txHash, txIndex);

  if (!userUtxo) {
    throw new Error(`User UTXO not found: ${txHash}#${txIndex}`);
  }
  const STAGING_TOKEN_HEX = toHex(new TextEncoder().encode("staging"));
  const TECH_WITNESS_ASSET = toHex(
    new TextEncoder().encode("tech-auth-witness"),
  );
  const COUNCIL_WITNESS_ASSET = toHex(
    new TextEncoder().encode("council-auth-witness"),
  );

  try {
    const txBuilder = blaze
      .newTransaction()
      .addInput(stagingUtxo, redeemer)
      .addInput(userUtxo)
      .addReferenceInput(mainUtxo)
      .addReferenceInput(stagingGovThresholdUtxo)
      .addReferenceInput(techAuthForeverUtxo)
      .addReferenceInput(councilForeverUtxo)
      .addReferenceInput(councilTwoStageMainUtxo) // For staging_gov_auth's logic_is_on_main check
      .provideScript(targetContracts.twoStage.Script)
      .provideScript(contracts.stagingGovAuth.Script)
      .addMint(
        techAuthWitnessPolicy,
        new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
      )
      .provideScript(Script.newNativeScript(techAuthNativeScript))
      .addMint(
        councilWitnessPolicy,
        new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
      )
      .provideScript(Script.newNativeScript(councilNativeScript))
      .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: stagingUtxo.output().amount().coin(),
            assets: new Map([
              [
                AssetId(
                  targetContracts.twoStage.Script.hash() + STAGING_TOKEN_HEX,
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, newStagingState).toCore(),
        }),
      )
      .setChangeAddress(changeAddress)
      .setFeePadding(50000n);

    const tx = await txBuilder.complete();

    printSuccess(`Transaction built: ${tx.getId()}`);

    if (sign) {
      // Sign with tech auth keys only (staging doesn't require council signatures)
      const { parsePrivateKeys } = await import("../lib/signers");
      const techAuthKeys = parsePrivateKeys("TECH_AUTH_PRIVATE_KEYS");

      console.log(
        `\nSigning with ${techAuthKeys.length} tech auth private keys...`,
      );
      const signatures = signTransaction(tx.getId(), techAuthKeys);
      console.log(`  Created ${signatures.length} signatures`);

      const signedTx = attachWitnesses(tx.toCbor(), signatures);
      writeTransactionFile(
        outputPath,
        signedTx.toCbor(),
        tx.getId(),
        true,
        "Stage Upgrade Transaction",
      );
      printSuccess(`Signed transaction written to ${outputPath}`);
    } else {
      writeTransactionFile(
        outputPath,
        tx.toCbor(),
        tx.getId(),
        false,
        "Stage Upgrade Transaction",
      );
      printSuccess(`Unsigned transaction written to ${outputPath}`);
    }

    console.log("\nTransaction ID:", tx.getId());
  } catch (error) {
    printError("Transaction build failed");
    console.error(error);
    throw error;
  }
}
