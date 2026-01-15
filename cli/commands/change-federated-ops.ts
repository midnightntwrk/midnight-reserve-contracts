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
import { parse, serialize } from "@blaze-cardano/data";
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
  parsePrivateKeys,
  extractSignersFromCbor,
} from "../lib/signers";
import { createFederatedOpsDatum } from "../lib/candidates";
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

export async function changeFederatedOps(
  options: ChangeAuthOptions,
): Promise<void> {
  const { network, output, txHash, txIndex, sign, outputFile } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nChanging Federated Ops members on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances(network);

  const federatedOpsForeverAddress = getCredentialAddress(
    network,
    contracts.federatedOpsForever.Script.hash(),
  );
  const federatedOpsUpdateThresholdAddress = getCredentialAddress(
    network,
    contracts.mainFederatedOpsUpdateThreshold.Script.hash(),
  );
  const councilForeverAddress = getCredentialAddress(
    network,
    contracts.councilForever.Script.hash(),
  );
  const techAuthForeverAddress = getCredentialAddress(
    network,
    contracts.techAuthForever.Script.hash(),
  );
  const federatedOpsTwoStageAddress = getCredentialAddress(
    network,
    contracts.federatedOpsTwoStage.Script.hash(),
  );

  console.log(
    "\nFederated Ops Forever Address:",
    federatedOpsForeverAddress.toBech32(),
  );

  const { blaze, provider } = await createBlaze(network, options.provider);

  printProgress("Fetching contract UTxOs...");

  const federatedOpsForeverUtxos = await provider.getUnspentOutputs(
    federatedOpsForeverAddress,
  );
  const federatedOpsThresholdUtxos = await provider.getUnspentOutputs(
    federatedOpsUpdateThresholdAddress,
  );
  const councilForeverUtxos = await provider.getUnspentOutputs(
    councilForeverAddress,
  );
  const techAuthForeverUtxos = await provider.getUnspentOutputs(
    techAuthForeverAddress,
  );
  const federatedOpsTwoStageUtxos = await provider.getUnspentOutputs(
    federatedOpsTwoStageAddress,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Federated ops forever:", federatedOpsForeverUtxos.length);
  console.log("  Federated ops threshold:", federatedOpsThresholdUtxos.length);
  console.log("  Council forever:", councilForeverUtxos.length);
  console.log("  Tech auth forever:", techAuthForeverUtxos.length);
  console.log("  Federated ops two stage:", federatedOpsTwoStageUtxos.length);

  if (
    !federatedOpsForeverUtxos.length ||
    !federatedOpsThresholdUtxos.length ||
    !councilForeverUtxos.length ||
    !techAuthForeverUtxos.length ||
    !federatedOpsTwoStageUtxos.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const federatedOpsForeverUtxo = federatedOpsForeverUtxos[0];
  const federatedOpsThresholdUtxo = federatedOpsThresholdUtxos[0];
  const councilForeverUtxo = councilForeverUtxos[0];
  const techAuthForeverUtxo = techAuthForeverUtxos[0];
  const federatedOpsTwoStageUtxo = findUtxoWithMainAsset(
    federatedOpsTwoStageUtxos,
  );

  if (!federatedOpsTwoStageUtxo) {
    throw new Error(
      'Could not find federated ops two-stage UTxO with "main" asset',
    );
  }

  console.log("\nReading federated ops two-stage upgrade state...");
  const federatedOpsTwoStageDatum = federatedOpsTwoStageUtxo.output().datum();
  if (!federatedOpsTwoStageDatum?.asInlineData()) {
    throw new Error("Missing inline datum on federated ops two-stage UTxO");
  }

  const upgradeState = parse(
    Contracts.UpgradeState,
    federatedOpsTwoStageDatum.asInlineData()!,
  );
  const [logicHash, mitigationLogicHash] = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");

  const logicScript = findScriptByHash(logicHash, network);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. Expected: ${contracts.federatedOpsLogic.Script.hash()}`,
    );
  }

  let mitigationLogicScript: Script | null = null;
  if (mitigationLogicHash && mitigationLogicHash !== "") {
    mitigationLogicScript = findScriptByHash(mitigationLogicHash, network);
    if (!mitigationLogicScript) {
      throw new Error(
        `Unknown mitigation logic script hash in UpgradeState: ${mitigationLogicHash}`,
      );
    }
  }

  console.log("\nCurrent federated ops forever datum:");
  const currentDatum = federatedOpsForeverUtxo.output().datum();
  if (!currentDatum?.asInlineData()) {
    throw new Error("Missing inline datum on federated ops forever UTxO");
  }

  console.log("  Has inline datum");
  const currentFederatedOpsState = parse(
    Contracts.FederatedOps,
    currentDatum.asInlineData()!,
  );
  // FederatedOps = [Unit, List<PermissionedCandidateDatumV1>, logic_round]
  const currentLogicRound = currentFederatedOpsState[2];
  console.log("  Current logic round:", currentLogicRound);

  // Parse current council state for ML-3 validation
  console.log("\nReading current council state for ML-3 validation...");
  const councilDatum = councilForeverUtxo.output().datum();
  if (!councilDatum?.asInlineData()) {
    throw new Error("Council forever UTxO missing inline datum");
  }

  // Use CBOR-aware extraction to preserve duplicate keys
  const councilSigners = extractSignersFromCbor(councilDatum.asInlineData()!);

  if (!councilSigners.length) {
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

  if (!techAuthSigners.length) {
    throw new Error("No tech auth signers found in tech auth forever datum");
  }

  // Create new federated ops datum from environment
  const newFederatedOpsDatum = createFederatedOpsDatum(
    "PERMISSIONED_CANDIDATES",
    currentLogicRound, // Preserve the logic round
  );

  console.log("\nNew federated ops candidates loaded from PERMISSIONED_CANDIDATES");

  const requiredSigners = 2;
  const councilRequiredSigners = 2;

  const nativeScriptCouncil = createNativeMultisigScript(
    councilRequiredSigners,
    councilSigners,
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
  console.log("Council signers:");
  councilSigners.forEach((s, i) => console.log(`  ${i}: ${s.paymentHash}`));
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

  printProgress("Fetching user UTXO...");
  const changeAddress = Address.fromBech32(deployerAddress);
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);
  const userUtxo = findUtxoByTxRef(deployerUtxos, txHash, txIndex);

  if (!userUtxo) {
    throw new Error(`User UTXO not found: ${txHash}#${txIndex}`);
  }

  printProgress("Building transaction...");

  // Create the redeemer for the federated ops logic (empty redeemer)
  const federatedOpsRedeemer = PlutusData.newInteger(0n);

  try {
    const txBuilder = blaze
      .newTransaction()
      .addInput(userUtxo)
      .addInput(federatedOpsForeverUtxo, PlutusData.newInteger(0n))
      .addReferenceInput(federatedOpsThresholdUtxo)
      .addReferenceInput(councilForeverUtxo)
      .addReferenceInput(techAuthForeverUtxo)
      .addReferenceInput(federatedOpsTwoStageUtxo)
      .provideScript(contracts.federatedOpsForever.Script)
      .addMint(councilPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptCouncil))
      .addMint(techAuthPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptTechAuth))
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(federatedOpsForeverAddress.toBech32()),
          value: {
            coins: federatedOpsForeverUtxo.output().amount().coin(),
            assets: new Map([
              [AssetId(contracts.federatedOpsForever.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.FederatedOps,
            newFederatedOpsDatum,
          ).toCore(),
        }),
      )
      // Add logic withdrawal (from UpgradeState)
      .addWithdrawal(logicRewardAccount, 0n, federatedOpsRedeemer)
      .provideScript(logicScript)
      .setChangeAddress(changeAddress)
      .setFeePadding(50000n);

    // Add mitigation logic withdrawal if present in UpgradeState
    if (mitigationLogicScript && mitigationLogicRewardAccount) {
      console.log("  Adding mitigation logic withdrawal...");
      txBuilder
        .addWithdrawal(mitigationLogicRewardAccount, 0n, federatedOpsRedeemer)
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
