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
import { parsePrivateKeys, extractSignersFromCbor } from "../lib/signers";
import { createFederatedOpsDatum } from "../lib/candidates";
import {
  printSuccess,
  printError,
  writeTransactionFile,
  getContractUtxos,
  parseInlineDatum,
} from "../utils";
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
  const contracts = getContractInstances(network, options.useBuild);

  const federatedOpsForeverAddress = getCredentialAddress(
    network,
    contracts.federatedOpsForever.Script.hash(),
  );

  console.log(
    "\nFederated Ops Forever Address:",
    federatedOpsForeverAddress.toBech32(),
  );

  const { blaze, provider } = await createBlaze(network, options.provider);

  // Query all contract UTxOs in parallel
  const allUtxos = await getContractUtxos(
    provider,
    {
      federatedOpsForever: contracts.federatedOpsForever.Script,
      federatedOpsThreshold: contracts.mainFederatedOpsUpdateThreshold.Script,
      councilForever: contracts.councilForever.Script,
      techAuthForever: contracts.techAuthForever.Script,
      federatedOpsTwoStage: contracts.federatedOpsTwoStage.Script,
    },
    networkId,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Federated ops forever:", allUtxos.federatedOpsForever.length);
  console.log(
    "  Federated ops threshold:",
    allUtxos.federatedOpsThreshold.length,
  );
  console.log("  Council forever:", allUtxos.councilForever.length);
  console.log("  Tech auth forever:", allUtxos.techAuthForever.length);
  console.log(
    "  Federated ops two stage:",
    allUtxos.federatedOpsTwoStage.length,
  );

  if (
    !allUtxos.federatedOpsForever.length ||
    !allUtxos.federatedOpsThreshold.length ||
    !allUtxos.councilForever.length ||
    !allUtxos.techAuthForever.length ||
    !allUtxos.federatedOpsTwoStage.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const federatedOpsForeverUtxo = allUtxos.federatedOpsForever[0];
  const federatedOpsThresholdUtxo = allUtxos.federatedOpsThreshold[0];
  const councilForeverUtxo = allUtxos.councilForever[0];
  const techAuthForeverUtxo = allUtxos.techAuthForever[0];
  const federatedOpsTwoStageUtxo = findUtxoWithMainAsset(
    allUtxos.federatedOpsTwoStage,
  );

  if (!federatedOpsTwoStageUtxo) {
    throw new Error(
      'Could not find federated ops two-stage UTxO with "main" asset',
    );
  }

  console.log("\nReading federated ops two-stage upgrade state...");
  const upgradeState = parseInlineDatum(
    federatedOpsTwoStageUtxo,
    Contracts.UpgradeState,
    parse,
  );
  const [logicHash, mitigationLogicHash] = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");

  const logicScript = findScriptByHash(logicHash, network, options.useBuild);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. Expected: ${contracts.federatedOpsLogic.Script.hash()}`,
    );
  }

  let mitigationLogicScript: Script | null = null;
  if (mitigationLogicHash && mitigationLogicHash !== "") {
    mitigationLogicScript = findScriptByHash(
      mitigationLogicHash,
      network,
      options.useBuild,
    );
    if (!mitigationLogicScript) {
      throw new Error(
        `Unknown mitigation logic script hash in UpgradeState: ${mitigationLogicHash}`,
      );
    }
  }

  console.log("\nCurrent federated ops forever datum:");
  const currentFederatedOpsState = parseInlineDatum(
    federatedOpsForeverUtxo,
    Contracts.FederatedOps,
    parse,
  );
  console.log("  Has inline datum");
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
    1n, // Use logic_round 1
  );

  console.log(
    "\nNew federated ops candidates loaded from PERMISSIONED_CANDIDATES",
  );

  // Read threshold datum from federated ops threshold UTxO
  console.log("\nReading federated ops update threshold...");
  const thresholdState = parseInlineDatum(
    federatedOpsThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

  // Calculate required signers based on threshold
  // MultisigThreshold is a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
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

  const nativeScriptCouncil = createNativeMultisigScript(
    councilRequiredSigners,
    councilSigners,
    networkId,
  );

  const nativeScriptTechAuth = createNativeMultisigScript(
    techAuthRequiredSigners,
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

  const changeAddress = Address.fromBech32(deployerAddress);
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);
  const userUtxo = findUtxoByTxRef(deployerUtxos, txHash, txIndex);

  if (!userUtxo) {
    throw new Error(`User UTXO not found: ${txHash}#${txIndex}`);
  }
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
      writeTransactionFile(
        outputPath,
        signedTx.toCbor(),
        tx.getId(),
        true,
        "Change Federated Ops Transaction",
      );
      printSuccess(`Signed transaction written to ${outputPath}`);
    } else {
      writeTransactionFile(
        outputPath,
        tx.toCbor(),
        tx.getId(),
        false,
        "Change Federated Ops Transaction",
      );
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
