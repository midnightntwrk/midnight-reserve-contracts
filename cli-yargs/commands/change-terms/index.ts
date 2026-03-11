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
import {
  validateTxHash,
  validateTxIndex,
  thresholdToRequiredSigners,
} from "../../lib/validation";
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
  createNativeMultisigScript,
  createRewardAccount,
  signAndWriteTx,
  findUtxoWithMainAsset,
  findUtxoByTxRef,
  parseInlineDatum,
} from "../../lib/transaction";
import { completeTx } from "../../lib/complete-tx";
import { createTxMetadata } from "../../lib/metadata";
import { getDatumHandler } from "../../lib/datum-versions";
import * as Contracts from "../../../contract_blueprint";

interface ChangeTermsOptions extends GlobalOptions {
  "tx-hash": string;
  "tx-index": number;
  hash: string;
  url: string;
  sign: boolean;
  "output-file": string;
  "use-build": boolean;
}

export const command = "change-terms";
export const describe = "Change terms and conditions hash and URL";

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
    .option("hash", {
      type: "string",
      demandOption: true,
      description:
        "New terms and conditions hash (64 hex chars, 32 bytes SHA-256)",
    })
    .option("url", {
      type: "string",
      demandOption: true,
      description: "New terms and conditions URL (plain text)",
    })
    .option("sign", {
      type: "boolean",
      default: true,
      description:
        "Sign the transaction (requires TECH_AUTH_PRIVATE_KEYS and COUNCIL_PRIVATE_KEYS)",
    })
    .option("output-file", {
      type: "string",
      default: "change-terms-tx.json",
      description: "Output file name for the transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use build output instead of deployed blueprint",
    });
}

function validateHex(value: string, name: string, exactBytes?: number): void {
  if (!/^[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${name} must be a valid hex string with even length`);
  }
  if (exactBytes !== undefined && value.length !== exactBytes * 2) {
    throw new Error(
      `${name} must be exactly ${exactBytes} bytes (${exactBytes * 2} hex chars)`,
    );
  }
}

export async function handler(argv: ChangeTermsOptions) {
  const {
    network,
    output,
    sign,
    hash,
    url,
    "tx-hash": txHash,
    "tx-index": txIndex,
    "output-file": outputFile,
    "use-build": useBuild,
  } = argv;

  // Validate inputs before any processing
  validateTxHash(txHash);
  validateTxIndex(txIndex);
  validateHex(hash, "--hash", 32);

  // Convert plain-text URL to hex for on-chain bytes encoding
  const urlHex = Buffer.from(url).toString("hex");

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nChanging Terms and Conditions on ${network} network`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);
  console.log(`New hash: ${hash}`);
  console.log(`New URL: ${url}`);
  console.log(`  (hex: ${urlHex})`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress(network);
  const contracts = getContractInstances(network, useBuild);

  const termsForeverAddress = getContractAddress(
    network,
    contracts.termsAndConditionsForever.Script,
  );

  console.log(
    "\nTerms and Conditions Forever Address:",
    termsForeverAddress.toBech32(),
  );

  const providerType = argv.provider;
  const { blaze, provider } = await createBlaze(network, providerType);

  // Query all contract UTxOs in parallel
  const allUtxos = await getContractUtxos(
    provider,
    {
      termsForever: contracts.termsAndConditionsForever.Script,
      termsThreshold: contracts.termsAndConditionsThreshold.Script,
      councilForever: contracts.councilForever.Script,
      techAuthForever: contracts.techAuthForever.Script,
      termsTwoStage: contracts.termsAndConditionsTwoStage.Script,
      councilTwoStage: contracts.councilTwoStage.Script,
      techAuthTwoStage: contracts.techAuthTwoStage.Script,
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
    !allUtxos.termsTwoStage.length ||
    !allUtxos.councilTwoStage.length ||
    !allUtxos.techAuthTwoStage.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const termsForeverUtxo = allUtxos.termsForever[0];
  const termsThresholdUtxo = allUtxos.termsThreshold[0];
  const councilForeverUtxo = allUtxos.councilForever[0];
  const techAuthForeverUtxo = allUtxos.techAuthForever[0];
  const termsTwoStageUtxo = findUtxoWithMainAsset(allUtxos.termsTwoStage);
  const councilTwoStageUtxo = findUtxoWithMainAsset(allUtxos.councilTwoStage);
  const techAuthTwoStageUtxo = findUtxoWithMainAsset(allUtxos.techAuthTwoStage);

  if (!termsTwoStageUtxo) {
    throw new Error(
      'Could not find terms and conditions two-stage UTxO with "main" asset',
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

  // Parse terms two-stage upgrade state — source of truth for logic hash and logic_round
  console.log("\nReading terms and conditions two-stage upgrade state...");
  const twoStageDatum = termsTwoStageUtxo.output().datum()?.asInlineData();
  if (!twoStageDatum) {
    throw new Error("Terms and conditions two-stage UTxO missing inline datum");
  }

  const upgradeState = parseUpgradeState(twoStageDatum.toCbor());
  if (!upgradeState) {
    throw new Error(
      "Could not parse UpgradeState from terms and conditions two-stage datum",
    );
  }

  const { logicHash, mitigationLogicHash, logicRound } = upgradeState;
  console.log("  Logic hash:", logicHash);
  console.log("  Mitigation logic hash:", mitigationLogicHash || "(empty)");
  console.log("  Logic round:", logicRound);

  const logicScript = findScriptByHash(logicHash, network, useBuild);
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
      useBuild,
    );
    if (!mitigationLogicScript) {
      throw new Error(
        `Unknown mitigation logic script hash in UpgradeState: ${mitigationLogicHash}`,
      );
    }
  }

  // Version-aware datum handling — logicRound from two-stage state drives version selection
  console.log(
    "\nDecoding terms and conditions forever datum (version-aware)...",
  );
  const foreverDatum = termsForeverUtxo.output().datum()?.asInlineData();
  if (!foreverDatum) {
    throw new Error("Terms and conditions forever UTxO missing inline datum");
  }

  const datumHandler = getDatumHandler("terms-and-conditions", logicRound);
  const currentData = datumHandler.decode(foreverDatum);

  console.log("  Current hash:", currentData.hash);
  console.log(
    "  Current URL:",
    Buffer.from(currentData.link, "hex").toString("utf8"),
  );
  console.log(`    (hex: ${currentData.link})`);

  // Build new terms using version-aware handler (link stored as hex bytes on-chain)
  const newData = datumHandler.setTerms!(currentData, { hash, link: urlHex });
  const newTermsForeverStateCbor = datumHandler.encode(newData);

  console.log("\nNew terms and conditions:");
  console.log("  Hash:", hash);
  console.log("  URL:", url);
  console.log(`    (hex: ${urlHex})`);

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

  // Read threshold datum from terms threshold UTxO
  console.log("\nReading terms and conditions threshold...");
  const thresholdState = parseInlineDatum(
    termsThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

  // MultisigThreshold is a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;
  const techAuthRequiredSigners = thresholdToRequiredSigners(
    techAuthSigners.length,
    techAuthNum,
    techAuthDenom,
    "multisig threshold",
  );
  const councilRequiredSigners = thresholdToRequiredSigners(
    councilSigners.length,
    councilNum,
    councilDenom,
    "multisig threshold",
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

  // Wrap in LogicRedeemer::Normal(inner) for v2 logic scripts, plain for v1
  const innerRedeemer = PlutusData.newInteger(0n);
  const termsRedeemer =
    logicRound >= 1 && logicScript
      ? PlutusData.fromCore({
          constructor: 0n,
          fields: { items: [innerRedeemer.toCore()] },
        })
      : innerRedeemer;

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
        datum: newTermsForeverStateCbor.toCore(),
      }),
    )
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

  const { tx } = await completeTx(txBuilder, {
    commandName: "change-terms",
    provider,
    networkId,
    environment: network,
    knownUtxos: [
      termsForeverUtxo,
      termsThresholdUtxo,
      councilForeverUtxo,
      techAuthForeverUtxo,
      termsTwoStageUtxo,
      userUtxo,
    ],
  });

  signAndWriteTx(
    tx,
    outputPath,
    sign,
    "Change Terms and Conditions Transaction",
  );
}

const commandModule: CommandModule<GlobalOptions, ChangeTermsOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
