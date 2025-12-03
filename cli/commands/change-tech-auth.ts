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
import { serialize, parse } from "@blaze-cardano/data";

import type { ChangeAuthOptions } from "../lib/types";
import { getNetworkId } from "../lib/types";
import { getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import { getContractInstances, getCredentialAddress } from "../lib/contracts";
import {
  parseSigners,
  parsePrivateKeys,
  createMultisigState,
  createRedeemerMap,
  extractSignersFromMultisigState,
} from "../lib/signers";
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
  findUtxoByTxRef,
} from "../utils/transaction";
import * as Contracts from "../../contract_blueprint";

export async function changeTechAuth(options: ChangeAuthOptions): Promise<void> {
  const { network, txHash, txIndex, sign, outputFile } = options;

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

  // Parse current tech auth state
  console.log("\nCurrent tech auth forever datum:");
  const currentDatum = techAuthForeverUtxo.output().datum();
  if (!currentDatum?.asInlineData()) {
    throw new Error("Missing inline datum on tech auth forever UTxO");
  }

  console.log("  Has inline datum");
  const currentTechAuthState = parse(
    Contracts.Multisig,
    currentDatum.asInlineData()!,
  );
  const [currentThreshold] = currentTechAuthState;
  console.log("  Current threshold:", currentThreshold);

  const currentTechAuthSigners = extractSignersFromMultisigState(currentTechAuthState);

  if (!currentTechAuthSigners.length) {
    throw new Error("No tech auth signers found in tech auth forever datum");
  }

  // Parse current council state for ML-3 validation
  console.log("\nReading current council state for ML-3 validation...");
  const councilDatum = councilForeverUtxo.output().datum();
  if (!councilDatum?.asInlineData()) {
    throw new Error("Council forever UTxO missing inline datum");
  }

  const currentCouncilState = parse(
    Contracts.Multisig,
    councilDatum.asInlineData()!,
  );
  const currentCouncilSigners = extractSignersFromMultisigState(currentCouncilState);

  if (!currentCouncilSigners.length) {
    throw new Error("No council signers found in council forever datum");
  }

  // Parse new tech auth signers
  const newTechAuthSigners = parseSigners("TECH_AUTH_SIGNERS");
  const newTechAuthForeverState = createMultisigState(newTechAuthSigners);
  const memberRedeemer = createRedeemerMap(newTechAuthSigners);

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

  const techAuthLogicRewardAccount = createRewardAccount(
    contracts.techAuthLogic.Script.hash(),
    networkId,
  );

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
          datum: serialize(Contracts.Multisig, newTechAuthForeverState).toCore(),
        }),
      )
      .addWithdrawal(
        techAuthLogicRewardAccount,
        0n,
        serialize(Contracts.PermissionedRedeemer, memberRedeemer),
      )
      .provideScript(contracts.techAuthLogic.Script)
      .setChangeAddress(changeAddress)
      .setFeePadding(50000n);

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
      writeCborFile(outputFile, signedTx.toCbor());
      printSuccess(`Signed transaction written to ${outputFile}`);
    } else {
      writeCborFile(outputFile, tx.toCbor());
      printSuccess(`Unsigned transaction written to ${outputFile}`);
    }

    console.log("\nTransaction ID:", tx.getId());
  } catch (error) {
    printError("Transaction build failed");
    console.error(error);
    throw error;
  }
}
