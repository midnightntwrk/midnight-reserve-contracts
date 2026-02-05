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

import type { ChangeTermsOptions } from "../lib/types";
import { getNetworkId } from "../lib/types";
import { getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import {
  getContractInstances,
  getCredentialAddress,
  findScriptByHash,
} from "../lib/contracts";
import { parsePrivateKeys, extractSignersFromCbor } from "../lib/signers";
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
import { createTxMetadata } from "../utils/metadata";
import * as Contracts from "../../contract_blueprint";

export async function changeTerms(options: ChangeTermsOptions): Promise<void> {
  const { network, output, txHash, txIndex, hash, url, sign, outputFile } =
    options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nChanging Terms and Conditions on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);
  console.log(`New hash: ${hash}`);
  console.log(`New URL: ${url}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances(network, options.useBuild);

  const termsForeverAddress = getCredentialAddress(
    network,
    contracts.termsAndConditionsForever.Script.hash(),
  );

  console.log(
    "\nTerms and Conditions Forever Address:",
    termsForeverAddress.toBech32(),
  );

  const { blaze, provider } = await createBlaze(network, options.provider);

  // Query all contract UTxOs in parallel
  const allUtxos = await getContractUtxos(
    provider,
    {
      termsForever: contracts.termsAndConditionsForever.Script,
      termsThreshold: contracts.termsAndConditionsThreshold.Script,
      councilForever: contracts.councilForever.Script,
      techAuthForever: contracts.techAuthForever.Script,
      termsTwoStage: contracts.termsAndConditionsTwoStage.Script,
    },
    networkId,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Terms and conditions forever:", allUtxos.termsForever.length);
  console.log(
    "  Terms and conditions threshold:",
    allUtxos.termsThreshold.length,
  );
  console.log("  Council forever:", allUtxos.councilForever.length);
  console.log("  Tech auth forever:", allUtxos.techAuthForever.length);
  console.log(
    "  Terms and conditions two stage:",
    allUtxos.termsTwoStage.length,
  );

  if (
    !allUtxos.termsForever.length ||
    !allUtxos.termsThreshold.length ||
    !allUtxos.councilForever.length ||
    !allUtxos.techAuthForever.length ||
    !allUtxos.termsTwoStage.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const termsForeverUtxo = allUtxos.termsForever[0];
  const termsThresholdUtxo = allUtxos.termsThreshold[0];
  const councilForeverUtxo = allUtxos.councilForever[0];
  const techAuthForeverUtxo = allUtxos.techAuthForever[0];
  const termsTwoStageUtxo = findUtxoWithMainAsset(allUtxos.termsTwoStage);

  if (!termsTwoStageUtxo) {
    throw new Error(
      'Could not find terms and conditions two-stage UTxO with "main" asset',
    );
  }

  console.log("\nReading terms and conditions two-stage upgrade state...");
  const upgradeState = parseInlineDatum(
    termsTwoStageUtxo,
    Contracts.UpgradeState,
    parse,
  );
  const [logicHash, mitigationLogicHash] = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");

  const logicScript = findScriptByHash(logicHash, network, options.useBuild);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. Expected: ${contracts.termsAndConditionsLogic.Script.hash()}`,
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

  console.log("\nCurrent terms and conditions forever datum:");
  const currentTermsState = parseInlineDatum(
    termsForeverUtxo,
    Contracts.VersionedTermsAndConditions,
    parse,
  );
  console.log("  Has inline datum");
  // VersionedTermsAndConditions = [[hash, link], logic_round]
  const currentLogicRound = currentTermsState[1];
  console.log("  Current logic round:", currentLogicRound);
  console.log("  Current hash:", currentTermsState[0][0]);
  console.log("  Current URL:", currentTermsState[0][1]);

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

  // Create new terms and conditions datum
  // VersionedTermsAndConditions = [TermsAndConditions, logic_round]
  // TermsAndConditions = [hash, link]
  const newTermsDatum: Contracts.VersionedTermsAndConditions = [
    [hash, url],
    currentLogicRound, // Keep the same logic round
  ];

  console.log("\nNew terms and conditions:");
  console.log("  Hash:", hash);
  console.log("  URL:", url);
  console.log("  Logic round:", currentLogicRound);

  // Read threshold datum from terms threshold UTxO
  console.log("\nReading terms and conditions threshold...");
  const thresholdState = parseInlineDatum(
    termsThresholdUtxo,
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
  const termsRedeemer = PlutusData.newInteger(0n);

  try {
    const txBuilder = blaze
      .newTransaction()
      .addInput(userUtxo)
      .addInput(termsForeverUtxo, PlutusData.newInteger(0n))
      .addReferenceInput(termsThresholdUtxo)
      .addReferenceInput(councilForeverUtxo)
      .addReferenceInput(techAuthForeverUtxo)
      .addReferenceInput(termsTwoStageUtxo)
      .provideScript(contracts.termsAndConditionsForever.Script)
      .addMint(councilPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptCouncil))
      .addMint(techAuthPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptTechAuth))
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(termsForeverAddress.toBech32()),
          value: {
            coins: termsForeverUtxo.output().amount().coin(),
            assets: new Map([
              [AssetId(contracts.termsAndConditionsForever.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.VersionedTermsAndConditions,
            newTermsDatum,
          ).toCore(),
        }),
      )
      // Add logic withdrawal (from UpgradeState)
      .addWithdrawal(logicRewardAccount, 0n, termsRedeemer)
      .provideScript(logicScript)
      .setChangeAddress(changeAddress)
      .setMetadata(createTxMetadata("change-terms"))
      .setFeePadding(50000n);

    // Add mitigation logic withdrawal if present in UpgradeState
    if (mitigationLogicScript && mitigationLogicRewardAccount) {
      console.log("  Adding mitigation logic withdrawal...");
      txBuilder
        .addWithdrawal(mitigationLogicRewardAccount, 0n, termsRedeemer)
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
        "Change Terms and Conditions Transaction",
      );
      printSuccess(`Signed transaction written to ${outputPath}`);
    } else {
      writeTransactionFile(
        outputPath,
        tx.toCbor(),
        tx.getId(),
        false,
        "Change Terms and Conditions Transaction",
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
