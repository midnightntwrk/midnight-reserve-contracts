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
  extractSignersFromCbor,
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

interface ChangeCouncilOptions extends GlobalOptions {
  "tx-hash": string;
  "tx-index": number;
  sign: boolean;
  "output-file": string;
  "use-build": boolean;
}

export const command = "change-council";
export const describe = "Update council multisig members";

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
      default: "change-council-tx.json",
      description: "Output file name for the transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description:
        "Use build output instead of deployed-scripts versioned blueprint",
    });
}

export async function handler(argv: ChangeCouncilOptions) {
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

  console.log(`\nChanging Council members on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  const contracts = getContractInstances(network, useBuild);

  const councilForeverAddress = getContractAddress(
    network,
    contracts.councilForever.Script,
  );

  console.log("\nCouncil Forever Address:", councilForeverAddress.toBech32());

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
      councilForever: contracts.councilForever.Script,
      councilThreshold: contracts.mainCouncilUpdateThreshold.Script,
      techAuthForever: contracts.techAuthForever.Script,
      councilTwoStage: contracts.councilTwoStage.Script,
    },
    networkId,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Council forever:", allUtxos.councilForever.length);
  console.log("  Council threshold:", allUtxos.councilThreshold.length);
  console.log("  Tech auth forever:", allUtxos.techAuthForever.length);
  console.log("  Council two stage:", allUtxos.councilTwoStage.length);

  if (
    !allUtxos.councilForever.length ||
    !allUtxos.councilThreshold.length ||
    !allUtxos.techAuthForever.length ||
    !allUtxos.councilTwoStage.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const councilForeverUtxo = allUtxos.councilForever[0];
  const councilThresholdUtxo = allUtxos.councilThreshold[0];
  const techAuthForeverUtxo = allUtxos.techAuthForever[0];
  const councilTwoStageUtxo = findUtxoWithMainAsset(allUtxos.councilTwoStage);

  if (!councilTwoStageUtxo) {
    throw new Error('Could not find council two-stage UTxO with "main" asset');
  }

  // Parse two-stage upgrade state — source of truth for logic hash and logic_round
  console.log("\nReading council two-stage upgrade state...");
  const twoStageDatum = councilTwoStageUtxo.output().datum()?.asInlineData();
  if (!twoStageDatum) {
    throw new Error("Council two-stage UTxO missing inline datum");
  }

  const upgradeState = parseUpgradeState(twoStageDatum.toCbor());
  if (!upgradeState) {
    throw new Error(
      "Could not parse UpgradeState from council two-stage datum",
    );
  }

  const { logicHash, mitigationLogicHash, logicRound } = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");
  console.log("  Logic round:", logicRound);

  const logicScript = findScriptByHash(logicHash, network, useBuild);
  if (!logicScript) {
    throw new Error(
      `Unknown logic script hash in UpgradeState: ${logicHash}. Expected: ${contracts.councilLogic.Script.hash()}`,
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
  console.log("\nDecoding council forever datum (version-aware)...");
  const foreverDatum = councilForeverUtxo.output().datum()?.asInlineData();
  if (!foreverDatum) {
    throw new Error("Council forever UTxO missing inline datum");
  }

  const datumHandler = getDatumHandler("council", logicRound);
  const currentData = datumHandler.decode(foreverDatum);
  const currentCouncilSigners = currentData.signers;

  if (!currentCouncilSigners.length) {
    throw new Error("No council signers found in council forever datum");
  }

  // Parse current tech auth state for ML-3 validation
  console.log("\nReading current tech auth state for ML-3 validation...");
  const techAuthDatum = techAuthForeverUtxo.output().datum();
  if (!techAuthDatum?.asInlineData()) {
    throw new Error("Tech auth forever UTxO missing inline datum");
  }

  const techAuthSigners = extractSignersFromCbor(techAuthDatum.asInlineData()!);

  // Build new council state using version-aware handler
  const newCouncilSigners = parseSigners("COUNCIL_SIGNERS");
  const newData = {
    totalSigners: BigInt(newCouncilSigners.length),
    signers: newCouncilSigners,
  };
  const newCouncilForeverStateCbor = datumHandler.encode(newData);

  const memberRedeemerCbor = createRedeemerMapCbor(newCouncilSigners);

  console.log("New council signers count:", newCouncilSigners.length);
  console.log(
    "  Unique payment hashes:",
    new Set(newCouncilSigners.map((s) => s.paymentHash)).size,
  );

  // Read threshold datum from council threshold UTxO
  console.log("\nReading council update threshold...");
  const thresholdState = parseInlineDatum(
    councilThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

  // MultisigThreshold is a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;
  const requiredSigners = Number(
    (BigInt(techAuthSigners.length) * techAuthNum + (techAuthDenom - 1n)) /
      techAuthDenom,
  );
  const councilRequiredSigners = Number(
    (BigInt(currentCouncilSigners.length) * councilNum + (councilDenom - 1n)) /
      councilDenom,
  );

  console.log(
    `\nRequired tech auth signers: ${requiredSigners}/${techAuthSigners.length}`,
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

  const txBuilder = blaze
    .newTransaction()
    .addInput(userUtxo)
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
    .addWithdrawal(logicRewardAccount, 0n, memberRedeemerCbor)
    .provideScript(logicScript)
    .setChangeAddress(changeAddress)
    .setMetadata(createTxMetadata("change-council"))
    .setFeePadding(50000n);

  // Add mitigation logic withdrawal if present in UpgradeState
  if (mitigationLogicScript && mitigationLogicRewardAccount) {
    console.log("  Adding mitigation logic withdrawal...");
    txBuilder
      .addWithdrawal(mitigationLogicRewardAccount, 0n, memberRedeemerCbor)
      .provideScript(mitigationLogicScript);
  }

  const { tx } = await completeTx(txBuilder, {
    commandName: "change-council",
    provider,
    networkId,
    knownUtxos: [
      councilForeverUtxo,
      councilThresholdUtxo,
      techAuthForeverUtxo,
      councilTwoStageUtxo,
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
      "Change Council Transaction",
    );
  } else {
    writeTransactionFile(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      "Change Council Transaction",
    );
  }

  console.log("\nTransaction ID:", tx.getId());
}

const commandModule: CommandModule<GlobalOptions, ChangeCouncilOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
