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
import { writeFileSync } from "fs";

import type { ChangeAuthOptions, Signer } from "../lib/types";
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

export async function changeCouncil(options: ChangeAuthOptions): Promise<void> {
  const { network, txHash, txIndex, sign, outputFile } = options;

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

  const councilForeverUtxos = await provider.getUnspentOutputs(councilForeverAddress);
  const councilThresholdUtxos = await provider.getUnspentOutputs(councilUpdateThresholdAddress);
  const techAuthForeverUtxos = await provider.getUnspentOutputs(techAuthForeverAddress);
  const councilTwoStageUtxos = await provider.getUnspentOutputs(councilTwoStageAddress);

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
  const currentCouncilSigners = extractSignersFromMultisigState(currentCouncilState);

  if (!currentCouncilSigners.length) {
    throw new Error("No council signers found in council forever datum");
  }

  // Parse current tech auth state for ML-3 validation
  console.log("\nReading current tech auth state for ML-3 validation...");
  const techAuthDatum = techAuthForeverUtxo.output().datum();
  if (!techAuthDatum?.asInlineData()) {
    throw new Error("Tech auth forever UTxO missing inline datum");
  }

  const currentTechAuthState = parse(
    Contracts.VersionedMultisig,
    techAuthDatum.asInlineData()!,
  );
  const techAuthSigners = extractSignersFromMultisigState(currentTechAuthState);

  // Parse new council signers
  const newCouncilSigners = parseSigners("COUNCIL_SIGNERS");
  const newCouncilForeverState = createMultisigState(
    newCouncilSigners,
    currentCouncilState.round,
  );
  const memberRedeemer = createRedeemerMap(newCouncilSigners);

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

  const councilLogicRewardAccount = createRewardAccount(
    contracts.councilLogic.Script.hash(),
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
            assets: new Map([[AssetId(contracts.councilForever.Script.hash()), 1n]]),
          },
          datum: serialize(Contracts.VersionedMultisig, newCouncilForeverState).toCore(),
        }),
      )
      .addWithdrawal(
        councilLogicRewardAccount,
        0n,
        serialize(Contracts.PermissionedRedeemer, memberRedeemer),
      )
      .provideScript(contracts.councilLogic.Script)
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
