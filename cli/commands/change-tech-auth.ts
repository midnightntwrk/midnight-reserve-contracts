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

export async function changeTechAuth(
  options: ChangeAuthOptions,
): Promise<void> {
  const { network, output, txHash, txIndex, sign, outputFile } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nChanging Tech Auth members on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances(network, options.useBuild);

  const techAuthForeverAddress = getCredentialAddress(
    network,
    contracts.techAuthForever.Script.hash(),
  );

  console.log(
    "\nTech Auth Forever Address:",
    techAuthForeverAddress.toBech32(),
  );

  const { blaze, provider } = await createBlaze(network, options.provider);

  // Query all contract UTxOs in parallel
  const allUtxos = await getContractUtxos(
    provider,
    {
      techAuthForever: contracts.techAuthForever.Script,
      techAuthThreshold: contracts.mainTechAuthUpdateThreshold.Script,
      councilForever: contracts.councilForever.Script,
      techAuthTwoStage: contracts.techAuthTwoStage.Script,
    },
    networkId,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Tech auth forever:", allUtxos.techAuthForever.length);
  console.log("  Tech auth threshold:", allUtxos.techAuthThreshold.length);
  console.log("  Council forever:", allUtxos.councilForever.length);
  console.log("  Tech auth two stage:", allUtxos.techAuthTwoStage.length);

  if (
    !allUtxos.techAuthForever.length ||
    !allUtxos.techAuthThreshold.length ||
    !allUtxos.councilForever.length ||
    !allUtxos.techAuthTwoStage.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const techAuthForeverUtxo = allUtxos.techAuthForever[0];
  const techAuthThresholdUtxo = allUtxos.techAuthThreshold[0];
  const councilForeverUtxo = allUtxos.councilForever[0];
  const techAuthTwoStageUtxo = findUtxoWithMainAsset(allUtxos.techAuthTwoStage);

  if (!techAuthTwoStageUtxo) {
    throw new Error(
      'Could not find tech auth two-stage UTxO with "main" asset',
    );
  }

  console.log("\nReading tech auth two-stage upgrade state...");
  const upgradeState = parseInlineDatum(
    techAuthTwoStageUtxo,
    Contracts.UpgradeState,
    parse,
  );
  const [logicHash, mitigationLogicHash] = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");

  const logicScript = findScriptByHash(logicHash, network, options.useBuild);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. Expected: ${contracts.techAuthLogic.Script.hash()}`,
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

  console.log("\nCurrent tech auth forever datum:");
  const currentTechAuthState = parseInlineDatum(
    techAuthForeverUtxo,
    Contracts.VersionedMultisig,
    parse,
  );
  console.log("  Has inline datum");
  // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
  const [multisig] = currentTechAuthState;
  const [currentThreshold] = multisig;
  console.log("  Current threshold:", currentThreshold);

  // Use CBOR-aware extraction to preserve duplicate keys
  const techAuthDatumRaw = techAuthForeverUtxo
    .output()
    .datum()!
    .asInlineData()!;
  const currentTechAuthSigners = extractSignersFromCbor(techAuthDatumRaw);

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
  const currentCouncilSigners = extractSignersFromCbor(
    councilDatum.asInlineData()!,
  );

  if (!currentCouncilSigners.length) {
    throw new Error("No council signers found in council forever datum");
  }

  const newTechAuthSigners = parseSigners("TECH_AUTH_SIGNERS");
  // Use CBOR functions that preserve duplicate keys
  // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
  const newTechAuthForeverStateCbor = createMultisigStateCbor(
    newTechAuthSigners,
    currentTechAuthState[1], // round is second element of tuple
  );
  const memberRedeemerCbor = createRedeemerMapCbor(newTechAuthSigners);

  console.log("New tech auth signers count:", newTechAuthSigners.length);
  console.log(
    "  Unique payment hashes:",
    new Set(newTechAuthSigners.map((s) => s.paymentHash)).size,
  );

  // Read threshold datum from tech auth threshold UTxO
  console.log("\nReading tech auth update threshold...");
  const thresholdState = parseInlineDatum(
    techAuthThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

  // Calculate required signers based on threshold
  // MultisigThreshold is a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;
  const requiredSigners = Number(
    (BigInt(currentTechAuthSigners.length) * techAuthNum +
      (techAuthDenom - 1n)) /
      techAuthDenom,
  );
  const councilRequiredSigners = Number(
    (BigInt(currentCouncilSigners.length) * councilNum + (councilDenom - 1n)) /
      councilDenom,
  );

  console.log(
    `\nRequired tech auth signers: ${requiredSigners}/${currentTechAuthSigners.length}`,
  );
  console.log(
    `Required council signers: ${councilRequiredSigners}/${currentCouncilSigners.length}`,
  );

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
            assets: new Map([
              [AssetId(contracts.techAuthForever.Script.hash()), 1n],
            ]),
          },
          datum: newTechAuthForeverStateCbor.toCore(),
        }),
      )
      // Add logic withdrawal (from UpgradeState)
      .addWithdrawal(logicRewardAccount, 0n, memberRedeemerCbor)
      .provideScript(logicScript)
      .setChangeAddress(changeAddress)
      .setMetadata(createTxMetadata("change-tech-auth"))
      .setFeePadding(50000n);

    // Add mitigation logic withdrawal if present in UpgradeState
    if (mitigationLogicScript && mitigationLogicRewardAccount) {
      console.log("  Adding mitigation logic withdrawal...");
      txBuilder
        .addWithdrawal(mitigationLogicRewardAccount, 0n, memberRedeemerCbor)
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
        "Change Technical Authority Transaction",
      );
      printSuccess(`Signed transaction written to ${outputPath}`);
    } else {
      writeTransactionFile(
        outputPath,
        tx.toCbor(),
        tx.getId(),
        false,
        "Change Technical Authority Transaction",
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
