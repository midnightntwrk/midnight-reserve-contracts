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
import {
  parseSigners,
  parsePrivateKeys,
  createRedeemerMapCbor,
} from "../../lib/signers";
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

interface ChangeTechAuthOptions extends GlobalOptions {
  "tx-hash": string;
  "tx-index": number;
  sign: boolean;
  "output-file": string;
  "use-build": boolean;
}

export const command = "change-tech-auth";
export const describe = "Update tech auth multisig members";

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
      default: "change-tech-auth-tx.json",
      description: "Output file name for the transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description:
        "Use build output instead of deployed-scripts versioned blueprint",
    });
}

export async function handler(argv: ChangeTechAuthOptions) {
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

  console.log(`\nChanging Tech Auth members on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances(network, useBuild);

  const techAuthForeverAddress = getContractAddress(
    network,
    contracts.techAuthForever.Script,
  );

  console.log(
    "\nTech Auth Forever Address:",
    techAuthForeverAddress.toBech32(),
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
      techAuthForever: contracts.techAuthForever.Script,
      techAuthThreshold: contracts.mainTechAuthUpdateThreshold.Script,
      councilForever: contracts.councilForever.Script,
      councilTwoStage: contracts.councilTwoStage.Script,
      techAuthTwoStage: contracts.techAuthTwoStage.Script,
    },
    networkId,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Tech auth forever:", allUtxos.techAuthForever.length);
  console.log("  Tech auth threshold:", allUtxos.techAuthThreshold.length);
  console.log("  Council forever:", allUtxos.councilForever.length);
  console.log("  Council two stage:", allUtxos.councilTwoStage.length);
  console.log("  Tech auth two stage:", allUtxos.techAuthTwoStage.length);

  if (
    !allUtxos.techAuthForever.length ||
    !allUtxos.techAuthThreshold.length ||
    !allUtxos.councilForever.length ||
    !allUtxos.councilTwoStage.length ||
    !allUtxos.techAuthTwoStage.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const techAuthForeverUtxo = allUtxos.techAuthForever[0];
  const techAuthThresholdUtxo = allUtxos.techAuthThreshold[0];
  const councilForeverUtxo = allUtxos.councilForever[0];
  const councilTwoStageUtxo = findUtxoWithMainAsset(allUtxos.councilTwoStage);
  const techAuthTwoStageUtxo = findUtxoWithMainAsset(allUtxos.techAuthTwoStage);

  if (!councilTwoStageUtxo) {
    throw new Error('Could not find council two-stage UTxO with "main" asset');
  }

  if (!techAuthTwoStageUtxo) {
    throw new Error(
      'Could not find tech auth two-stage UTxO with "main" asset',
    );
  }

  // Parse two-stage upgrade state — source of truth for logic hash and logic_round
  console.log("\nReading tech auth two-stage upgrade state...");
  const twoStageDatum = techAuthTwoStageUtxo.output().datum()?.asInlineData();
  if (!twoStageDatum) {
    throw new Error("Tech auth two-stage UTxO missing inline datum");
  }

  const upgradeState = parseUpgradeState(twoStageDatum.toCbor());
  if (!upgradeState) {
    throw new Error(
      "Could not parse UpgradeState from tech auth two-stage datum",
    );
  }

  const { logicHash, mitigationLogicHash, logicRound } = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");
  console.log("  Logic round:", logicRound);

  const logicScript = findScriptByHash(logicHash, network, useBuild);
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
      useBuild,
    );
    if (!mitigationLogicScript) {
      throw new Error(
        `Unknown mitigation logic script hash in UpgradeState: ${mitigationLogicHash}`,
      );
    }
  }

  // Version-aware datum handling — logicRound from two-stage state drives version selection
  console.log("\nDecoding tech auth forever datum (version-aware)...");
  const foreverDatum = techAuthForeverUtxo.output().datum()?.asInlineData();
  if (!foreverDatum) {
    throw new Error("Tech auth forever UTxO missing inline datum");
  }

  const datumHandler = getDatumHandler("tech-auth", logicRound);
  const currentData = datumHandler.decode(foreverDatum);
  const currentTechAuthSigners = currentData.signers;

  if (!currentTechAuthSigners.length) {
    throw new Error("No tech auth signers found in tech auth forever datum");
  }

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

  const councilDatum = councilForeverUtxo.output().datum();
  if (!councilDatum?.asInlineData()) {
    throw new Error("Council forever UTxO missing inline datum");
  }

  const councilDatumHandler = getDatumHandler(
    "council",
    councilUpgradeState.logicRound,
  );
  const councilData = councilDatumHandler.decode(councilDatum.asInlineData()!);
  const councilSigners = councilData.signers;

  if (!councilSigners.length) {
    throw new Error("No council signers found in council forever datum");
  }

  // Build new tech auth state using version-aware handler
  const newTechAuthSigners = parseSigners("TECH_AUTH_SIGNERS");
  const newData = {
    totalSigners: BigInt(newTechAuthSigners.length),
    signers: newTechAuthSigners,
  };
  const newTechAuthForeverStateCbor = datumHandler.encode(newData);
  const innerRedeemerCbor = createRedeemerMapCbor(newTechAuthSigners);
  // Wrap in LogicRedeemer::Normal(inner) for v2 logic scripts, plain for v1
  const memberRedeemerCbor =
    logicRound >= 1
      ? PlutusData.fromCore({
          constructor: 0n,
          fields: { items: [innerRedeemerCbor.toCore()] },
        })
      : innerRedeemerCbor;

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

  // MultisigThreshold is a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;
  const requiredSigners = Number(
    (BigInt(currentTechAuthSigners.length) * techAuthNum +
      (techAuthDenom - 1n)) /
      techAuthDenom,
  );
  const councilRequiredSigners = Number(
    (BigInt(councilSigners.length) * councilNum + (councilDenom - 1n)) /
      councilDenom,
  );

  console.log(
    `\nRequired tech auth signers: ${requiredSigners}/${currentTechAuthSigners.length}`,
  );
  console.log(
    `Required council signers: ${councilRequiredSigners}/${councilSigners.length}`,
  );

  const nativeScriptTechAuth = createNativeMultisigScript(
    requiredSigners,
    currentTechAuthSigners,
    networkId,
  );

  const nativeScriptCouncil = createNativeMultisigScript(
    councilRequiredSigners,
    councilSigners,
    networkId,
  );

  const techAuthPolicyId = PolicyId(nativeScriptTechAuth.hash());
  const councilPolicyId = PolicyId(nativeScriptCouncil.hash());

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

  const txBuilder = blaze
    .newTransaction()
    .addInput(userUtxo)
    .addInput(techAuthForeverUtxo, PlutusData.newInteger(0n))
    .addReferenceInput(techAuthThresholdUtxo)
    .addReferenceInput(councilForeverUtxo)
    .addReferenceInput(techAuthTwoStageUtxo)
    .provideScript(contracts.techAuthForever.Script)
    .addMint(techAuthPolicyId, new Map([[AssetName(""), 1n]]))
    .provideScript(Script.newNativeScript(nativeScriptTechAuth))
    .addMint(councilPolicyId, new Map([[AssetName(""), 1n]]))
    .provideScript(Script.newNativeScript(nativeScriptCouncil))
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

  const { tx } = await completeTx(txBuilder, {
    commandName: "change-tech-auth",
    provider,
    networkId,
    knownUtxos: [
      techAuthForeverUtxo,
      techAuthThresholdUtxo,
      councilForeverUtxo,
      techAuthTwoStageUtxo,
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
      "Change Technical Authority Transaction",
    );
  } else {
    writeTransactionFile(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      "Change Technical Authority Transaction",
    );
  }

  console.log("\nTransaction ID:", tx.getId());
}

const commandModule: CommandModule<GlobalOptions, ChangeTechAuthOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
