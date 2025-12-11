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
import { getContractInstances, getCredentialAddress, findScriptByHash } from "../lib/contracts";
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

export async function changeTechAuth(options: ChangeAuthOptions): Promise<void> {
  const { network, output, txHash, txIndex, sign, outputFile } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nChanging Tech Auth members on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances();

  // Create addresses
  const techAuthForeverAddress = getCredentialAddress(
    network,
    contracts.techAuthForever.Script.hash(),
  );
  const techAuthUpdateThresholdAddress = getCredentialAddress(
    network,
    contracts.mainTechAuthUpdateThreshold.Script.hash(),
  );
  const councilForeverAddress = getCredentialAddress(
    network,
    contracts.councilForever.Script.hash(),
  );
  const techAuthTwoStageAddress = getCredentialAddress(
    network,
    contracts.techAuthTwoStage.Script.hash(),
  );

  console.log("\nTech Auth Forever Address:", techAuthForeverAddress.toBech32());

  // Create provider and fetch UTxOs
  const { blaze, provider } = await createBlaze(network, options.provider);

  printProgress("Fetching contract UTxOs...");

  const techAuthForeverUtxos = await provider.getUnspentOutputs(techAuthForeverAddress);
  const techAuthThresholdUtxos = await provider.getUnspentOutputs(techAuthUpdateThresholdAddress);
  const councilForeverUtxos = await provider.getUnspentOutputs(councilForeverAddress);
  const techAuthTwoStageUtxos = await provider.getUnspentOutputs(techAuthTwoStageAddress);

  console.log("\nFound contract UTxOs:");
  console.log("  Tech auth forever:", techAuthForeverUtxos.length);
  console.log("  Tech auth threshold:", techAuthThresholdUtxos.length);
  console.log("  Council forever:", councilForeverUtxos.length);
  console.log("  Tech auth two stage:", techAuthTwoStageUtxos.length);

  if (
    !techAuthForeverUtxos.length ||
    !techAuthThresholdUtxos.length ||
    !councilForeverUtxos.length ||
    !techAuthTwoStageUtxos.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const techAuthForeverUtxo = techAuthForeverUtxos[0];
  const techAuthThresholdUtxo = techAuthThresholdUtxos[0];
  const councilForeverUtxo = councilForeverUtxos[0];
  const techAuthTwoStageUtxo = findUtxoWithMainAsset(techAuthTwoStageUtxos);

  if (!techAuthTwoStageUtxo) {
    throw new Error('Could not find tech auth two-stage UTxO with "main" asset');
  }

  // Parse the tech auth two-stage UpgradeState datum
  console.log("\nReading tech auth two-stage upgrade state...");
  const techAuthTwoStageDatum = techAuthTwoStageUtxo.output().datum();
  if (!techAuthTwoStageDatum?.asInlineData()) {
    throw new Error("Missing inline datum on tech auth two-stage UTxO");
  }

  const upgradeState = parse(
    Contracts.UpgradeState,
    techAuthTwoStageDatum.asInlineData()!,
  );
  const [logicHash, mitigationLogicHash] = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");

  const logicScript = findScriptByHash(logicHash);
  if (!logicScript) {
    throw new Error(`Unknown logic script hash in UpgradeState: ${logicHash}. Expected: ${contracts.techAuthLogic.Script.hash()}`);
  }

  let mitigationLogicScript: Script | null = null;
  if (mitigationLogicHash && mitigationLogicHash !== "") {
    mitigationLogicScript = findScriptByHash(mitigationLogicHash);
    if (!mitigationLogicScript) {
      throw new Error(`Unknown mitigation logic script hash in UpgradeState: ${mitigationLogicHash}`);
    }
  }

  // Parse current tech auth state
  console.log("\nCurrent tech auth forever datum:");
  const currentDatum = techAuthForeverUtxo.output().datum();
  if (!currentDatum?.asInlineData()) {
    throw new Error("Missing inline datum on tech auth forever UTxO");
  }

  console.log("  Has inline datum");
  const currentTechAuthState = parse(
    Contracts.VersionedMultisig,
    currentDatum.asInlineData()!,
  );
  const [currentThreshold] = currentTechAuthState.data;
  console.log("  Current threshold:", currentThreshold);

  // Use CBOR-aware extraction to preserve duplicate keys
  const currentTechAuthSigners = extractSignersFromCbor(currentDatum.asInlineData()!);

  if (!currentTechAuthSigners.length) {
    throw new Error("No tech auth signers found in tech auth forever datum");
  }

  // Parse current council state for ML-3 validation
  console.log("\nReading current council state for ML-3 validation...");
  const councilDatum = councilForeverUtxo.output().datum();
  if (!councilDatum?.asInlineData()) {
    throw new Error("Council forever UTxO missing inline datum");
  }

  // Use CBOR-aware extraction to preserve duplicate keys
  const currentCouncilSigners = extractSignersFromCbor(councilDatum.asInlineData()!);

  if (!currentCouncilSigners.length) {
    throw new Error("No council signers found in council forever datum");
  }

  // Parse new tech auth signers
  const newTechAuthSigners = parseSigners("TECH_AUTH_SIGNERS");
  // Use CBOR functions that preserve duplicate keys
  const newTechAuthForeverStateCbor = createMultisigStateCbor(
    newTechAuthSigners,
    currentTechAuthState.round,
  );
  const memberRedeemerCbor = createRedeemerMapCbor(newTechAuthSigners);

  console.log("New tech auth signers count:", newTechAuthSigners.length);
  console.log("  Unique payment hashes:", new Set(newTechAuthSigners.map(s => s.paymentHash)).size);

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
    currentTechAuthSigners,
    networkId,
  );

  const councilPolicyId = PolicyId(nativeScriptCouncil.hash());
  const techAuthPolicyId = PolicyId(nativeScriptTechAuth.hash());

  // Create reward accounts for logic scripts from the UpgradeState
  const logicRewardAccount = createRewardAccount(logicHash, networkId);
  console.log("\nLogic reward account:", logicRewardAccount);

  let mitigationLogicRewardAccount: ReturnType<typeof createRewardAccount> | null = null;
  if (mitigationLogicScript) {
    mitigationLogicRewardAccount = createRewardAccount(mitigationLogicHash, networkId);
    console.log("Mitigation logic reward account:", mitigationLogicRewardAccount);
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
      .addInput(userUtxo)
      .addInput(techAuthForeverUtxo, PlutusData.newInteger(0n))
      .addReferenceInput(techAuthThresholdUtxo)
      .addReferenceInput(councilForeverUtxo)
      .addReferenceInput(techAuthTwoStageUtxo)
      .provideScript(contracts.techAuthForever.Script)
      .addMint(councilPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptCouncil))
      .addMint(techAuthPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptTechAuth))
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(techAuthForeverAddress.toBech32()),
          value: {
            coins: techAuthForeverUtxo.output().amount().coin(),
            assets: new Map([[AssetId(contracts.techAuthForever.Script.hash()), 1n]]),
          },
          datum: newTechAuthForeverStateCbor.toCore(),
        }),
      )
      // Add logic withdrawal (from UpgradeState)
      .addWithdrawal(
        logicRewardAccount,
        0n,
        memberRedeemerCbor,
      )
      .provideScript(logicScript)
      .setChangeAddress(changeAddress)
      .setFeePadding(50000n);

    // Add mitigation logic withdrawal if present in UpgradeState
    if (mitigationLogicScript && mitigationLogicRewardAccount) {
      console.log("  Adding mitigation logic withdrawal...");
      txBuilder
        .addWithdrawal(
          mitigationLogicRewardAccount,
          0n,
          memberRedeemerCbor,
        )
        .provideScript(mitigationLogicScript);
    }

    printProgress("Completing transaction (with evaluation)...");
    const tx = await txBuilder.complete();

    printSuccess(`Transaction built: ${tx.getId()}`);

    if (sign) {
      // Sign with both tech auth and council keys
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
      writeTransactionFile(outputPath, signedTx.toCbor(), tx.getId(), true);
      printSuccess(`Signed transaction written to ${outputPath}`);
    } else {
      writeTransactionFile(outputPath, tx.toCbor(), tx.getId(), false);
      printSuccess(`Unsigned transaction written to ${outputPath}`);
    }

    console.log("\nTransaction ID:", tx.getId());
  } catch (error) {
    printError("Transaction build failed");
    console.error(error);
    throw error;
  }
}
