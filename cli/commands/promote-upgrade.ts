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
  writeTransactionFile,
  getContractUtxos,
  getTwoStageUtxos,
  parseInlineDatum,
} from "../utils";
import {
  createNativeMultisigScript,
  createRewardAccount,
  signTransaction,
  attachWitnesses,
  findUtxoByTxRef,
} from "../utils/transaction";
import { createTxMetadata } from "../utils/metadata";
import { updateCurrentSymlinks, getNextVersionNumber } from "../lib/versions";
import * as Contracts from "../../contract_blueprint";

export async function promoteUpgrade(
  options: PromoteUpgradeOptions,
): Promise<void> {
  const { network, output, validator, txHash, txIndex, sign, outputFile } =
    options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(
    `\nPromoting staged upgrade to main for ${validator} on ${network} network`,
  );
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances(network, options.useBuild);
  const targetContracts = getTwoStageContracts(
    validator,
    network,
    options.useBuild,
  );

  const twoStageAddress = getCredentialAddress(
    network,
    targetContracts.twoStage.Script.hash(),
  );

  console.log("\nTwo Stage Address:", twoStageAddress.toBech32());

  const { blaze, provider } = await createBlaze(network, options.provider);

  // Query all contract UTxOs in parallel
  const [{ main: mainUtxo, staging: stagingUtxo }, allUtxos] =
    await Promise.all([
      getTwoStageUtxos(provider, targetContracts.twoStage.Script, networkId),
      getContractUtxos(
        provider,
        {
          techAuthForever: contracts.techAuthForever.Script,
          councilForever: contracts.councilForever.Script,
          mainGovThreshold: contracts.mainGovThreshold.Script,
        },
        networkId,
      ),
    ]);

  console.log("\nFound contract UTxOs:");
  console.log("  Two stage: main and staging found");
  console.log("  Tech auth forever:", allUtxos.techAuthForever.length);
  console.log("  Council forever:", allUtxos.councilForever.length);
  console.log("  Main gov threshold:", allUtxos.mainGovThreshold.length);

  if (
    !allUtxos.techAuthForever.length ||
    !allUtxos.councilForever.length ||
    !allUtxos.mainGovThreshold.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const techAuthForeverUtxo = allUtxos.techAuthForever[0];
  const councilForeverUtxo = allUtxos.councilForever[0];
  const mainGovThresholdUtxo = allUtxos.mainGovThreshold[0];

  console.log("\nReading current tech auth state...");
  const techAuthState = parseInlineDatum(
    techAuthForeverUtxo,
    Contracts.VersionedMultisig,
    parse,
  );
  const techAuthSigners = extractSignersFromMultisigState(techAuthState);

  console.log("Reading current council state...");
  const councilState = parseInlineDatum(
    councilForeverUtxo,
    Contracts.VersionedMultisig,
    parse,
  );
  const councilSigners = extractSignersFromMultisigState(councilState);

  console.log("Reading main gov threshold...");
  const thresholdState = parseInlineDatum(
    mainGovThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

  // Parse staging state to get the staged logic hash
  console.log("Reading staging state...");
  const stagingState = parseInlineDatum(
    stagingUtxo,
    Contracts.UpgradeState,
    parse,
  );
  const stagedLogicHash = stagingState[0];

  console.log(`\nStaged logic hash to promote: ${stagedLogicHash}`);

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
  // Main datum should use main govAuth
  const govAuthRewardAccount = createRewardAccount(
    contracts.govAuth.Script.hash(),
    networkId,
  );

  // Get staging UTxO reference for redeemer
  const stagingInput = stagingUtxo.input();

  // Build redeemer - Main variant references the staging UTxO
  // TwoStageRedeemer is now a tuple: [UpdateField, WhichStage]
  const redeemer = serialize(Contracts.TwoStageRedeemer, [
    "Logic",
    {
      Main: [
        {
          transaction_id: stagingInput.transactionId(),
          output_index: BigInt(stagingInput.index()),
        },
      ],
    },
  ]);

  // Parse current main datum to get round
  const currentMainState = parseInlineDatum(
    mainUtxo,
    Contracts.UpgradeState,
    parse,
  );

  const newMainState: Contracts.UpgradeState = [
    stagedLogicHash,
    currentMainState[1], // keep mitigation_logic
    currentMainState[2], // keep gov_auth
    currentMainState[3], // keep mitigation_auth
    currentMainState[4], // keep round
    stagingState[5], // logic_round from staging (set during stage-upgrade)
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
  const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));
  const TECH_WITNESS_ASSET = toHex(
    new TextEncoder().encode("tech-auth-witness"),
  );
  const COUNCIL_WITNESS_ASSET = toHex(
    new TextEncoder().encode("council-auth-witness"),
  );

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
            coins: mainUtxo.output().amount().coin(),
            assets: new Map([
              [
                AssetId(
                  targetContracts.twoStage.Script.hash() + MAIN_TOKEN_HEX,
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, newMainState).toCore(),
        }),
      )
      .setChangeAddress(changeAddress)
      .setMetadata(createTxMetadata("promote-upgrade"))
      .setFeePadding(50000n);

    const tx = await txBuilder.complete();

    printSuccess(`Transaction built: ${tx.getId()}`);

    // Update deployed-scripts symlinks to point to the promoted version
    const latestVersion = getNextVersionNumber(network) - 1;
    const versionName = `v${latestVersion}`;
    try {
      updateCurrentSymlinks(network, versionName);
      printSuccess(
        `Updated deployed-scripts/${network}/ symlinks to ${versionName}`,
      );
    } catch (error) {
      console.warn(`Warning: Could not update symlinks: ${error}`);
    }

    if (sign) {
      // Sign with both tech auth and council keys
      const { parsePrivateKeys } = await import("../lib/signers");
      const signerKeyGroups = [
        {
          label: "tech auth",
          keys: parsePrivateKeys("TECH_AUTH_PRIVATE_KEYS"),
        },
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
      writeTransactionFile(
        outputPath,
        signedTx.toCbor(),
        tx.getId(),
        true,
        "Promote Upgrade Transaction",
      );
      printSuccess(`Signed transaction written to ${outputPath}`);
    } else {
      writeTransactionFile(
        outputPath,
        tx.toCbor(),
        tx.getId(),
        false,
        "Promote Upgrade Transaction",
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
