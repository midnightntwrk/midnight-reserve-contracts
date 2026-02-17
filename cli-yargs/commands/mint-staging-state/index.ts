import type { Argv, CommandModule } from "yargs";
import {
  addressFromValidator,
  Address,
  AssetId,
  AssetName,
  PaymentAddress,
  PlutusData,
  PolicyId,
  Script,
  TransactionId,
  TransactionInput,
  TransactionOutput,
} from "@blaze-cardano/core";
import { resolve } from "path";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";

import type { GlobalOptions } from "../../lib/global-options";
import type { NetworkConfig } from "../../lib/types";
import { getNetworkId, getConfigSection } from "../../lib/types";
import { loadAikenConfig, getDeployerAddress } from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import { getProtocolParameters, calculateMinUtxo } from "../../lib/protocol";
import {
  type ContractInstances,
  getContractInstances,
  loadContractModule,
} from "../../lib/contracts";
import { validateTwoStageValidator } from "../../lib/validation";
import { parsePrivateKeys } from "../../lib/signers";
import { signTransaction, attachWitnesses } from "../../lib/transaction";
import {
  writeTransactionFile,
  printSuccess,
  ensureDirectory,
} from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";
import { createTxMetadata } from "../../lib/metadata";

/** Map validator name to v2 logic class name patterns */
const V2_LOGIC_CLASS_PATTERNS: Record<string, string[]> = {
  "federated-ops": [
    "PermissionedV2FederatedOpsLogicV2Else",
    "PermissionedFederatedOpsLogicV2Else",
  ],
  "tech-auth": [
    "PermissionedV2TechAuthLogicV2Else",
    "PermissionedTechAuthLogicV2Else",
  ],
  council: [
    "PermissionedV2CouncilLogicV2Else",
    "PermissionedCouncilLogicV2Else",
  ],
  reserve: ["ReserveV2ReserveLogicV2Else", "ReserveReserveLogicV2Else"],
  ics: [
    "IlliquidCirculationSupplyV2IcsLogicV2Else",
    "IlliquidCirculationSupplyIcsLogicV2Else",
  ],
  "terms-and-conditions": [
    "TermsAndConditionsV2TermsAndConditionsLogicV2Else",
    "TermsAndConditionsTermsAndConditionsLogicV2Else",
  ],
};

function getLogicV2OneShotRef(
  validatorName: string,
  config: NetworkConfig,
): { hash: string; index: number } {
  switch (validatorName) {
    case "tech-auth":
      return {
        hash: config.technical_authority_logic_v2_one_shot_hash,
        index: config.technical_authority_logic_v2_one_shot_index,
      };
    case "council":
      return {
        hash: config.council_logic_v2_one_shot_hash,
        index: config.council_logic_v2_one_shot_index,
      };
    case "reserve":
      return {
        hash: config.reserve_logic_v2_one_shot_hash,
        index: config.reserve_logic_v2_one_shot_index,
      };
    case "ics":
      return {
        hash: config.ics_logic_v2_one_shot_hash,
        index: config.ics_logic_v2_one_shot_index,
      };
    case "federated-ops":
      return {
        hash: config.federated_operators_logic_v2_one_shot_hash,
        index: config.federated_operators_logic_v2_one_shot_index,
      };
    case "terms-and-conditions":
      return {
        hash: config.terms_and_conditions_logic_v2_one_shot_hash,
        index: config.terms_and_conditions_logic_v2_one_shot_index,
      };
    default:
      throw new Error(`Unknown validator: ${validatorName}`);
  }
}

function getStagingForeverHash(
  validatorName: string,
  contracts: ContractInstances,
): string {
  let contract: { Script: Script } | undefined;
  switch (validatorName) {
    case "tech-auth":
      contract = contracts.techAuthStagingForever;
      break;
    case "council":
      contract = contracts.councilStagingForever;
      break;
    case "reserve":
      contract = contracts.reserveStagingForever;
      break;
    case "ics":
      contract = contracts.icsStagingForever;
      break;
    case "federated-ops":
      contract = contracts.federatedOpsStagingForever;
      break;
    case "terms-and-conditions":
      contract = contracts.termsAndConditionsStagingForever;
      break;
    default:
      throw new Error(`Unknown validator: ${validatorName}`);
  }
  if (!contract) {
    throw new Error(
      `Staging forever contract not found for ${validatorName}. ` +
        `Ensure the blueprint includes staging forever validators.`,
    );
  }
  return contract.Script.hash();
}

function getV2LogicScript(
  validatorName: string,
  network: string,
  useBuild: boolean,
): { Script: Script } {
  const patterns = V2_LOGIC_CLASS_PATTERNS[validatorName];
  if (!patterns) {
    throw new Error(`Unknown validator: ${validatorName}`);
  }

  const configSection = getConfigSection(network);
  const module = loadContractModule(configSection, useBuild);

  for (const className of patterns) {
    const ContractClass = module[className] as
      | (new () => { Script: Script })
      | undefined;
    if (ContractClass) {
      return new ContractClass();
    }
  }

  throw new Error(
    `V2 logic contract not found for ${validatorName}. ` +
      `Checked class names: ${patterns.join(", ")}`,
  );
}

interface MintStagingStateOptions extends GlobalOptions {
  validator: string;
  sign: boolean;
  "output-file": string;
  "use-build": boolean;
}

export const command = "mint-staging-state";
export const describe = "Mint StagingState NFT for a v2 logic contract";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("validator", {
      alias: "v",
      type: "string",
      demandOption: true,
      description:
        "Validator to mint StagingState NFT for (tech-auth, council, reserve, ics, federated-ops, terms-and-conditions)",
    })
    .option("sign", {
      type: "boolean",
      default: true,
      description: "Sign the transaction (requires TECH_AUTH_PRIVATE_KEYS)",
    })
    .option("output-file", {
      type: "string",
      default: "mint-staging-state-tx.json",
      description: "Output file name for the transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use freshly built blueprint instead of deployed scripts",
    });
}

export async function handler(argv: MintStagingStateOptions) {
  const {
    network,
    output,
    validator,
    sign,
    "output-file": outputFile,
    "use-build": useBuild,
  } = argv;

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  // Validate validator name
  validateTwoStageValidator(validator);

  console.log(`\nMinting StagingState NFT for ${validator} on ${network}`);

  // Validate signing env vars early to avoid wasting a Blockfrost round-trip
  if (sign) {
    if (!process.env.TECH_AUTH_PRIVATE_KEYS) {
      throw new Error(
        "TECH_AUTH_PRIVATE_KEYS environment variable is required when --sign is enabled",
      );
    }
  }

  const config = loadAikenConfig(network);
  const contracts = getContractInstances(network, useBuild);
  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();

  // Get v2 logic script (this is the minting policy)
  const v2LogicContract = getV2LogicScript(validator, network, useBuild);
  const v2LogicScript = v2LogicContract.Script;
  const v2LogicHash = v2LogicScript.hash();

  console.log(`V2 logic script hash (policy ID): ${v2LogicHash}`);

  // Get one-shot UTxO reference
  const oneShotRef = getLogicV2OneShotRef(validator, config);
  console.log(`One-shot UTxO: ${oneShotRef.hash}#${oneShotRef.index}`);

  // Get staging forever hash for datum
  const stagingForeverHash = getStagingForeverHash(validator, contracts);
  console.log(`Staging forever hash: ${stagingForeverHash}`);

  // Get cnight_test_policy from config
  const cnightTestPolicy = config.cnight_policy;
  console.log(`CNIGHT test policy: ${cnightTestPolicy}`);

  const { blaze, provider } = await createBlaze(network, argv.provider);

  // Fetch protocol parameters for min UTxO calculation
  const protocolParams = await getProtocolParameters(provider);

  // Resolve the one-shot UTxO
  const oneShotInput = TransactionInput.fromCore({
    txId: TransactionId(oneShotRef.hash),
    index: oneShotRef.index,
  });
  const resolvedUtxos = await provider.resolveUnspentOutputs([oneShotInput]);
  if (resolvedUtxos.length === 0) {
    throw new Error(
      `One-shot UTxO not found: ${oneShotRef.hash}#${oneShotRef.index}. ` +
        `Ensure the UTxO exists and has not been spent.`,
    );
  }
  const oneShotUtxo = resolvedUtxos[0];
  console.log(
    `One-shot UTxO resolved: ${oneShotUtxo.output().amount().coin()} lovelace`,
  );

  // Build StagingState datum: @list type = [cnight_test_policy, forever_script_hash]
  const stagingStateDatum = PlutusData.fromCore({
    items: [
      PlutusData.newBytes(Buffer.from(cnightTestPolicy, "hex")).toCore(),
      PlutusData.newBytes(Buffer.from(stagingForeverHash, "hex")).toCore(),
    ],
  });

  // Get v2 logic script address
  const v2ScriptAddress = addressFromValidator(networkId, v2LogicScript);

  // NFT asset ID: policy = v2 logic hash, name = empty
  const nftAssetId = AssetId(v2LogicHash);

  // Build output with dynamic min UTxO
  const v2Output = TransactionOutput.fromCore({
    address: PaymentAddress(v2ScriptAddress.toBech32()),
    value: {
      coins: 0n,
      assets: new Map([[nftAssetId, 1n]]),
    },
    datum: stagingStateDatum.toCore(),
  });
  v2Output.amount().setCoin(calculateMinUtxo(protocolParams, v2Output));

  console.log(`Min UTxO for output: ${v2Output.amount().coin()} lovelace`);

  // Query collateral UTxO if configured
  let collateralUtxo: TransactionUnspentOutput | undefined;
  if (config.collateral_utxo_hash) {
    const collateralInput = TransactionInput.fromCore({
      txId: TransactionId(config.collateral_utxo_hash),
      index: config.collateral_utxo_index,
    });
    const resolved = await provider.resolveUnspentOutputs([collateralInput]);
    if (resolved.length > 0) {
      collateralUtxo = resolved[0];
      console.log(
        `Using collateral: ${config.collateral_utxo_hash}#${config.collateral_utxo_index}`,
      );
    }
  }

  const changeAddress = Address.fromBech32(deployerAddress);

  let txBuilder = blaze
    .newTransaction()
    .addInput(oneShotUtxo)
    .addMint(
      PolicyId(v2LogicHash),
      new Map([[AssetName(""), 1n]]),
      PlutusData.newInteger(0n),
    )
    .provideScript(v2LogicScript)
    .addOutput(v2Output)
    .setChangeAddress(changeAddress)
    .setMetadata(createTxMetadata("mint-staging-state"))
    .setFeePadding(50000n);

  if (collateralUtxo) {
    txBuilder = txBuilder.provideCollateral([collateralUtxo]);
  }

  const knownUtxos = [oneShotUtxo];
  if (collateralUtxo) knownUtxos.push(collateralUtxo);

  const { tx } = await completeTx(txBuilder, {
    commandName: "mint-staging-state",
    provider,
    networkId,
    environment: network,
    knownUtxos,
  });

  ensureDirectory(deploymentDir);

  if (sign) {
    const techAuthKeys = parsePrivateKeys("TECH_AUTH_PRIVATE_KEYS");
    if (techAuthKeys.length === 0) {
      throw new Error(
        "TECH_AUTH_PRIVATE_KEYS resolved to zero keys — cannot sign",
      );
    }

    console.log(
      `\nSigning with ${techAuthKeys.length} tech auth private keys...`,
    );
    const signatures = signTransaction(tx.getId(), techAuthKeys);
    console.log(`  Created ${signatures.length} signatures`);

    const signedTx = attachWitnesses(tx.toCbor(), signatures);
    writeTransactionFile(
      outputPath,
      signedTx.toCbor(),
      tx.getId(),
      true,
      "Mint StagingState NFT Transaction",
    );
    printSuccess(`Signed transaction written to ${outputPath}`);
  } else {
    writeTransactionFile(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      "Mint StagingState NFT Transaction",
    );
    printSuccess(`Transaction written to ${outputPath}`);
  }

  console.log("\nTransaction ID:", tx.getId());
  console.log("\nStagingState NFT details:");
  console.log(`  Policy ID: ${v2LogicHash}`);
  console.log(`  Asset Name: (empty)`);
  console.log(`  Output Address: ${v2ScriptAddress.toBech32()}`);
  console.log(`  Datum: StagingState`);
  console.log(`    cnight_test_policy: ${cnightTestPolicy}`);
  console.log(`    forever_script_hash: ${stagingForeverHash}`);
}

const commandModule: CommandModule<GlobalOptions, MintStagingStateOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
