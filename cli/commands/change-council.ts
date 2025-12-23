import {
  Address,
  AssetId,
  AssetName,
  PlutusData,
  PolicyId,
  Script,
  TransactionOutput,
  PaymentAddress,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { resolve } from "path";

import type { ChangeAuthOptions } from "../lib/types";
import { getNetworkId } from "../lib/types";
import { getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import {
  getContractInstances,
  getCredentialAddress,
  findScriptByHash,
} from "../lib/contracts";
import {
  parseSigners,
  parsePrivateKeys,
  extractSignersFromCbor,
  createMultisigStateCbor,
  createRedeemerMapCbor,
} from "../lib/signers";
import {
  printSuccess,
  printError,
  printProgress,
  writeTransactionFile,
} from "../utils/output";
import {
  createNativeMultisigScript,
  createRewardAccount,
  signTransaction,
  attachWitnesses,
  findUtxoWithMainAsset,
  findUtxoByTxRef,
} from "../utils/transaction";
import * as Contracts from "../../contract_blueprint";

export async function changeCouncil(options: ChangeAuthOptions): Promise<void> {
  const { network, output, txHash, txIndex, sign, outputFile } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nChanging Council members on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances();

  // Create addresses
  const councilForeverAddress = getCredentialAddress(
    network,
    contracts.councilForever.Script.hash(),
  );
  const councilUpdateThresholdAddress = getCredentialAddress(
    network,
    contracts.mainCouncilUpdateThreshold.Script.hash(),
  );
  const techAuthForeverAddress = getCredentialAddress(
    network,
    contracts.techAuthForever.Script.hash(),
  );
  const councilTwoStageAddress = getCredentialAddress(
    network,
    contracts.councilTwoStage.Script.hash(),
  );

  console.log("\nCouncil Forever Address:", councilForeverAddress.toBech32());

  // Create provider and fetch UTxOs
  const { blaze, provider } = await createBlaze(network, options.provider);

  printProgress("Fetching contract UTxOs...");

  const councilForeverUtxos = await provider.getUnspentOutputs(
    councilForeverAddress,
  );
  const councilThresholdUtxos = await provider.getUnspentOutputs(
    councilUpdateThresholdAddress,
  );
  const techAuthForeverUtxos = await provider.getUnspentOutputs(
    techAuthForeverAddress,
  );
  const councilTwoStageUtxos = await provider.getUnspentOutputs(
    councilTwoStageAddress,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Council forever:", councilForeverUtxos.length);
  console.log("  Council threshold:", councilThresholdUtxos.length);
  console.log("  Tech auth forever:", techAuthForeverUtxos.length);
  console.log("  Council two stage:", councilTwoStageUtxos.length);

  if (
    !councilForeverUtxos.length ||
    !councilThresholdUtxos.length ||
    !techAuthForeverUtxos.length ||
    !councilTwoStageUtxos.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const councilForeverUtxo = councilForeverUtxos[0];
  const councilThresholdUtxo = councilThresholdUtxos[0];
  const techAuthForeverUtxo = techAuthForeverUtxos[0];
  const councilTwoStageUtxo = findUtxoWithMainAsset(councilTwoStageUtxos);

  if (!councilTwoStageUtxo) {
    throw new Error('Could not find council two-stage UTxO with "main" asset');
  }

  // Parse the council two-stage UpgradeState datum
  console.log("\nReading council two-stage upgrade state...");
  const councilTwoStageDatum = councilTwoStageUtxo.output().datum();
  if (!councilTwoStageDatum?.asInlineData()) {
    throw new Error("Missing inline datum on council two-stage UTxO");
  }

  const upgradeState = parse(
    Contracts.UpgradeState,
    councilTwoStageDatum.asInlineData()!,
  );
  const [logicHash, mitigationLogicHash] = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");

  const logicScript = findScriptByHash(logicHash);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. Expected: ${contracts.councilLogic.Script.hash()}`,
    );
  }

  let mitigationLogicScript: Script | null = null;
  if (mitigationLogicHash && mitigationLogicHash !== "") {
    mitigationLogicScript = findScriptByHash(mitigationLogicHash);
    if (!mitigationLogicScript) {
      throw new Error(
        `Unknown mitigation logic script hash in UpgradeState: ${mitigationLogicHash}`,
      );
    }
  }

  // Parse current council state
  console.log("\nCurrent council forever datum:");
  const currentDatum = councilForeverUtxo.output().datum();
  if (!currentDatum?.asInlineData()) {
    throw new Error("Missing inline datum on council forever UTxO");
  }

  console.log("  Has inline datum");
  const currentCouncilState = parse(
    Contracts.VersionedMultisig,
    currentDatum.asInlineData()!,
  );
  // Use CBOR-aware extraction to preserve duplicate keys
  const currentCouncilSigners = extractSignersFromCbor(
    currentDatum.asInlineData()!,
  );

  if (!currentCouncilSigners.length) {
    throw new Error("No council signers found in council forever datum");
  }

  // Parse current tech auth state for ML-3 validation
  console.log("\nReading current tech auth state for ML-3 validation...");
  const techAuthDatum = techAuthForeverUtxo.output().datum();
  if (!techAuthDatum?.asInlineData()) {
    throw new Error("Tech auth forever UTxO missing inline datum");
  }

  // Use CBOR-aware extraction to preserve duplicate keys
  const techAuthSigners = extractSignersFromCbor(techAuthDatum.asInlineData()!);

  // Parse new council signers
  const newCouncilSigners = parseSigners("COUNCIL_SIGNERS");
  // Use CBOR functions that preserve duplicate keys
  // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
  const newCouncilForeverStateCbor = createMultisigStateCbor(
    newCouncilSigners,
    currentCouncilState[1], // round is second element of tuple
  );
  const memberRedeemerCbor = createRedeemerMapCbor(newCouncilSigners);

  console.log("New council signers count:", newCouncilSigners.length);
  console.log(
    "  Unique payment hashes:",
    new Set(newCouncilSigners.map((s) => s.paymentHash)).size,
  );

  // Create native scripts for multisig validation
  const requiredSigners = 2;
  const councilRequiredSigners = 2;

  const nativeScriptCouncil = createNativeMultisigScript(
    councilRequiredSigners,
    currentCouncilSigners,
    networkId,
  );

  const nativeScriptTechAuth = createNativeMultisigScript(
    requiredSigners,
    techAuthSigners,
    networkId,
  );

  const councilPolicyId = PolicyId(nativeScriptCouncil.hash());
  const techAuthPolicyId = PolicyId(nativeScriptTechAuth.hash());

  console.log("\n=== Debug Info ===");
  console.log("Council native script hash:", councilPolicyId);
  console.log("Tech auth native script hash:", techAuthPolicyId);
  console.log("Current council signers:");
  currentCouncilSigners.forEach((s, i) =>
    console.log(`  ${i}: ${s.paymentHash}`),
  );
  console.log("Tech auth signers:");
  techAuthSigners.forEach((s, i) => console.log(`  ${i}: ${s.paymentHash}`));

  // Create reward accounts for logic scripts from the UpgradeState
  const logicRewardAccount = createRewardAccount(logicHash, networkId);
  console.log("\nLogic reward account:", logicRewardAccount);

  let mitigationLogicRewardAccount: ReturnType<
    typeof createRewardAccount
  > | null = null;
  if (mitigationLogicScript) {
    mitigationLogicRewardAccount = createRewardAccount(
      mitigationLogicHash,
      networkId,
    );
    console.log(
      "Mitigation logic reward account:",
      mitigationLogicRewardAccount,
    );
  }

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

  try {
    const txBuilder = blaze
      .newTransaction()
      .addInput(councilForeverUtxo, PlutusData.newInteger(0n))
      .addReferenceInput(councilThresholdUtxo)
      .addReferenceInput(techAuthForeverUtxo)
      .addReferenceInput(councilTwoStageUtxo)
      .provideScript(contracts.councilForever.Script)
      .addMint(councilPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptCouncil))
      .addMint(techAuthPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptTechAuth))
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(councilForeverAddress.toBech32()),
          value: {
            coins: councilForeverUtxo.output().amount().coin(),
            assets: new Map([
              [AssetId(contracts.councilForever.Script.hash()), 1n],
            ]),
          },
          datum: newCouncilForeverStateCbor.toCore(),
        }),
      )
      // Add logic withdrawal (from UpgradeState)
      .addWithdrawal(logicRewardAccount, 0n, memberRedeemerCbor)
      .provideScript(logicScript)
      .setChangeAddress(changeAddress)
      .setFeePadding(50000n);

    // Add mitigation logic withdrawal if present in UpgradeState
    if (mitigationLogicScript && mitigationLogicRewardAccount) {
      console.log("  Adding mitigation logic withdrawal...");
      txBuilder
        .addWithdrawal(mitigationLogicRewardAccount, 0n, memberRedeemerCbor)
        .provideScript(mitigationLogicScript);
    }

    printProgress("Completing transaction (with evaluation)...");
    const tx = await txBuilder.complete();

    printSuccess(`Transaction built: ${tx.getId()}`);

    if (sign) {
      // Sign with both tech auth and council keys
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
      writeTransactionFile(outputPath, signedTx.toCbor(), tx.getId(), true);
      printSuccess(`Signed transaction written to ${outputPath}`);
    } else {
      writeTransactionFile(outputPath, tx.toCbor(), tx.getId(), false);
      printSuccess(`Unsigned transaction written to ${outputPath}`);
    }

    console.log("\nTransaction ID:", tx.getId());
  } catch (error) {
    printError("Transaction build failed");
    // Log detailed error info
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      if ("cause" in error && error.cause) {
        console.error("Error cause:", JSON.stringify(error.cause, null, 2));
      }
    }
    console.error(error);
    throw error;
  }
}
