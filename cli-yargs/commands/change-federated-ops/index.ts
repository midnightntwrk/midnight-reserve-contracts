import type { Argv, CommandModule } from "yargs";
import { parse } from "@blaze-cardano/data";
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
import { resolve } from "path";
import type { GlobalOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";
import { getDeployerAddress } from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import {
  getContractInstances,
  getContractAddress,
  findScriptByHash,
} from "../../lib/contracts";
import {
  getContractUtxos,
  parseUpgradeState,
} from "../../lib/governance-provider";
import { parsePrivateKeys } from "../../lib/signers";
import { parsePermissionedCandidates } from "../../lib/candidates";
import {
  createNativeMultisigScript,
  createRewardAccount,
  signTransaction,
  attachWitnesses,
  findUtxoWithMainAsset,
  findUtxoByTxRef,
  parseInlineDatum,
} from "../../lib/transaction";
import { writeTransactionFile } from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";
import { createTxMetadata } from "../../lib/metadata";
import { getDatumHandler } from "../../lib/datum-versions";
import * as Contracts from "../../../contract_blueprint";

interface ChangeFederatedOpsOptions extends GlobalOptions {
  "tx-hash": string;
  "tx-index": number;
  sign: boolean;
  "output-file": string;
  "use-build": boolean;
}

export const command = "change-federated-ops";
export const describe = "Update federated ops members";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("tx-hash", {
      type: "string",
      demandOption: true,
      description: "Transaction hash for the fee-paying UTxO",
    })
    .option("tx-index", {
      type: "number",
      demandOption: true,
      description: "Transaction index for the fee-paying UTxO",
    })
    .option("sign", {
      type: "boolean",
      default: true,
      description:
        "Sign the transaction (requires TECH_AUTH_PRIVATE_KEYS and COUNCIL_PRIVATE_KEYS)",
    })
    .option("output-file", {
      type: "string",
      default: "change-federated-ops-tx.json",
      description: "Output file name for the transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description:
        "Use build output instead of deployed-scripts versioned blueprint",
    });
}

export async function handler(argv: ChangeFederatedOpsOptions) {
  const {
    network,
    output,
    sign,
    "tx-hash": txHash,
    "tx-index": txIndex,
    "output-file": outputFile,
    "use-build": useBuild,
  } = argv;

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nChanging Federated Ops members on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances(network, useBuild);

  const federatedOpsForeverAddress = getContractAddress(
    network,
    contracts.federatedOpsForever.Script,
  );

  console.log(
    "\nFederated Ops Forever Address:",
    federatedOpsForeverAddress.toBech32(),
  );

  const providerType = argv.provider as
    | "blockfrost"
    | "maestro"
    | "emulator"
    | "kupmios"
    | undefined;
  const { blaze, provider } = await createBlaze(network, providerType);

  // Query all contract UTxOs in parallel
  const allUtxos = await getContractUtxos(
    provider,
    {
      federatedOpsForever: contracts.federatedOpsForever.Script,
      federatedOpsThreshold: contracts.mainFederatedOpsUpdateThreshold.Script,
      councilForever: contracts.councilForever.Script,
      techAuthForever: contracts.techAuthForever.Script,
      federatedOpsTwoStage: contracts.federatedOpsTwoStage.Script,
      councilTwoStage: contracts.councilTwoStage.Script,
      techAuthTwoStage: contracts.techAuthTwoStage.Script,
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
    !allUtxos.federatedOpsTwoStage.length ||
    !allUtxos.councilTwoStage.length ||
    !allUtxos.techAuthTwoStage.length
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
  const councilTwoStageUtxo = findUtxoWithMainAsset(allUtxos.councilTwoStage);
  const techAuthTwoStageUtxo = findUtxoWithMainAsset(allUtxos.techAuthTwoStage);

  if (!federatedOpsTwoStageUtxo) {
    throw new Error(
      'Could not find federated ops two-stage UTxO with "main" asset',
    );
  }

  if (!councilTwoStageUtxo) {
    throw new Error('Could not find council two-stage UTxO with "main" asset');
  }

  if (!techAuthTwoStageUtxo) {
    throw new Error(
      'Could not find tech auth two-stage UTxO with "main" asset',
    );
  }

  // Parse federated ops two-stage upgrade state — source of truth for logic hash and logic_round
  console.log("\nReading federated ops two-stage upgrade state...");
  const twoStageDatum = federatedOpsTwoStageUtxo
    .output()
    .datum()
    ?.asInlineData();
  if (!twoStageDatum) {
    throw new Error("Federated ops two-stage UTxO missing inline datum");
  }

  const upgradeState = parseUpgradeState(twoStageDatum.toCbor());
  if (!upgradeState) {
    throw new Error(
      "Could not parse UpgradeState from federated ops two-stage datum",
    );
  }

  const { logicHash, mitigationLogicHash, logicRound } = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");
  console.log("  Logic round:", logicRound);

  const logicScript = findScriptByHash(logicHash, network, useBuild);
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
      useBuild,
    );
    if (!mitigationLogicScript) {
      throw new Error(
        `Unknown mitigation logic script hash in UpgradeState: ${mitigationLogicHash}`,
      );
    }
  }

  // Version-aware datum handling — read logic_round from the datum itself (always the
  // last element) since migrate-federated-ops can change the datum shape without
  // updating logicRound in the two-stage UpgradeState
  console.log("\nDecoding federated ops forever datum (version-aware)...");
  const foreverDatum = federatedOpsForeverUtxo.output().datum()?.asInlineData();
  if (!foreverDatum) {
    throw new Error("Federated ops forever UTxO missing inline datum");
  }

  const datumList = foreverDatum.asList();
  if (!datumList || datumList.getLength() < 3) {
    throw new Error(
      "Invalid federated ops datum: expected at least 3 elements",
    );
  }
  const datumLogicRound = Number(
    datumList.get(datumList.getLength() - 1).asInteger()!,
  );
  if (datumLogicRound !== logicRound) {
    console.log(
      `  Datum logic_round=${datumLogicRound} differs from two-stage logicRound=${logicRound}, using datum value`,
    );
  }
  const datumHandler = getDatumHandler("federated-ops", datumLogicRound);
  const currentData = datumHandler.decode(foreverDatum);

  console.log("  Current candidates count:", currentData.candidates.length);

  // Parse current council state for ML-3 validation (version-aware)
  console.log("\nReading current council state for ML-3 validation...");
  const councilTwoStageDatum = councilTwoStageUtxo
    .output()
    .datum()
    ?.asInlineData();
  if (!councilTwoStageDatum) {
    throw new Error("Council two-stage UTxO missing inline datum");
  }

  const councilUpgradeState = parseUpgradeState(councilTwoStageDatum.toCbor());
  if (!councilUpgradeState) {
    throw new Error(
      "Could not parse UpgradeState from council two-stage datum",
    );
  }

  const councilDatum = councilForeverUtxo.output().datum()?.asInlineData();
  if (!councilDatum) {
    throw new Error("Council forever UTxO missing inline datum");
  }

  const councilDatumHandler = getDatumHandler(
    "council",
    councilUpgradeState.logicRound,
  );
  const councilData = councilDatumHandler.decode(councilDatum);
  const councilSigners = councilData.signers;

  if (!councilSigners.length) {
    throw new Error("No council signers found in council forever datum");
  }

  // Parse current tech auth state for ML-3 validation (version-aware)
  console.log("\nReading current tech auth state for ML-3 validation...");
  const techAuthTwoStageDatum = techAuthTwoStageUtxo
    .output()
    .datum()
    ?.asInlineData();
  if (!techAuthTwoStageDatum) {
    throw new Error("Tech auth two-stage UTxO missing inline datum");
  }

  const techAuthUpgradeState = parseUpgradeState(
    techAuthTwoStageDatum.toCbor(),
  );
  if (!techAuthUpgradeState) {
    throw new Error(
      "Could not parse UpgradeState from tech auth two-stage datum",
    );
  }

  const techAuthDatum = techAuthForeverUtxo.output().datum()?.asInlineData();
  if (!techAuthDatum) {
    throw new Error("Tech auth forever UTxO missing inline datum");
  }

  const techAuthDatumHandler = getDatumHandler(
    "tech-auth",
    techAuthUpgradeState.logicRound,
  );
  const techAuthData = techAuthDatumHandler.decode(techAuthDatum);
  const techAuthSigners = techAuthData.signers;

  if (!techAuthSigners.length) {
    throw new Error("No tech auth signers found in tech auth forever datum");
  }

  // Build new federated ops state using version-aware handler
  const newCandidates = parsePermissionedCandidates("PERMISSIONED_CANDIDATES");
  const newData = datumHandler.setCandidates!(currentData, newCandidates);
  const newFederatedOpsForeverStateCbor = datumHandler.encode(newData);

  console.log("\nNew federated ops candidates count:", newCandidates.length);

  // Read threshold datum from federated ops threshold UTxO
  console.log("\nReading federated ops update threshold...");
  const thresholdState = parseInlineDatum(
    federatedOpsThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

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

  // FederatedOps redeemer: wrap inner redeemer in LogicRedeemer::Normal(inner)
  // for v2 logic scripts (next_version.ak), plain integer for v1
  const innerRedeemer = PlutusData.newInteger(0n);
  const federatedOpsRedeemer =
    logicRound >= 1 && logicScript
      ? PlutusData.fromCore({
          constructor: 0n,
          fields: { items: [innerRedeemer.toCore()] },
        })
      : innerRedeemer;

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
        datum: newFederatedOpsForeverStateCbor.toCore(),
      }),
    )
    .addWithdrawal(logicRewardAccount, 0n, federatedOpsRedeemer)
    .provideScript(logicScript)
    .setChangeAddress(changeAddress)
    .setMetadata(createTxMetadata("change-federated-ops"))
    .setFeePadding(50000n);

  // Add mitigation logic withdrawal if present in UpgradeState
  if (mitigationLogicScript && mitigationLogicRewardAccount) {
    console.log("  Adding mitigation logic withdrawal...");
    txBuilder
      .addWithdrawal(mitigationLogicRewardAccount, 0n, federatedOpsRedeemer)
      .provideScript(mitigationLogicScript);
  }

  const { tx } = await completeTx(txBuilder, {
    commandName: "change-federated-ops",
    provider,
    networkId,
    environment: network,
    knownUtxos: [
      federatedOpsForeverUtxo,
      federatedOpsThresholdUtxo,
      councilForeverUtxo,
      techAuthForeverUtxo,
      federatedOpsTwoStageUtxo,
      userUtxo,
    ],
  });

  if (sign) {
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
  } else {
    writeTransactionFile(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      "Change Federated Ops Transaction",
    );
  }

  console.log("\nTransaction ID:", tx.getId());
}

const commandModule: CommandModule<GlobalOptions, ChangeFederatedOpsOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
