import type { Argv, CommandModule } from "yargs";
import {
  addressFromValidator,
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
import { serialize } from "@blaze-cardano/data";
import { calculateRequiredCollateral } from "@blaze-cardano/tx";
import { resolve } from "path";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";

import type { GlobalOptions } from "../../lib/global-options";
import type { TransactionOutput as TxOutput } from "../../lib/types";
import { getNetworkId } from "../../lib/types";
import { loadAikenConfig, getDeployUtxoAmount } from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import { getProtocolParameters, calculateMinUtxo } from "../../lib/protocol";
import { getContractInstances } from "../../lib/contracts";
import {
  parseSignersWithCount,
  createMultisigStateFromMap,
} from "../../lib/signers";
import { createFederatedOpsDatum } from "../../lib/candidates";
import {
  writeJsonFile,
  createDeploymentOutput,
  printSuccess,
  printError,
  printInfo,
  printTransactionSummary,
  ensureDirectory,
  TX_TYPE_CONWAY,
} from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";
import * as Contracts from "../../../contract_blueprint";

/** Valid component names for staging track deployment */
const VALID_STAGING_TRACK_COMPONENTS = [
  "council",
  "tech-auth",
  "federated-ops",
  "reserve",
  "ics",
  "terms-and-conditions",
] as const;

type StagingTrackComponent = (typeof VALID_STAGING_TRACK_COMPONENTS)[number];

function validateStagingTrackComponents(components: string[]): string[] {
  const invalid = components.filter(
    (c) => !VALID_STAGING_TRACK_COMPONENTS.includes(c as StagingTrackComponent),
  );
  if (invalid.length > 0) {
    throw new Error(
      `Invalid staging track component(s): ${invalid.join(", ")}. ` +
        `Valid options: ${VALID_STAGING_TRACK_COMPONENTS.join(", ")}`,
    );
  }
  return components;
}

interface StagingForeverDeployParams {
  name: string;
  displayName: string;
  oneShotHash: string;
  oneShotIndex: number;
  stagingForeverContract: { Script: Script };
  datumBuilder: () => PlutusData;
  redeemerBuilder: () => PlutusData;
}

interface ScriptOutputInfo {
  address: string;
  policyId?: string;
  assetName?: string;
}

interface DeployStagingTrackOptions extends GlobalOptions {
  "utxo-amount"?: string;
  components?: string;
  name?: string;
  "use-build": boolean;
}

export const command = "deploy-staging-track";
export const describe = "Deploy staging track forever validators";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("utxo-amount", {
      type: "string",
      description:
        "Lovelace amount per UTxO (default: from DEPLOY_UTXO_AMOUNT env or 20000000)",
    })
    .option("components", {
      type: "string",
      description:
        "Comma-separated list of staging track components to deploy (or 'all')",
    })
    .option("name", {
      type: "string",
      description: "Deploy a single named transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use freshly built blueprint instead of deployed scripts",
    });
}

export async function handler(argv: DeployStagingTrackOptions) {
  const { network, output } = argv;
  const useBuild = argv["use-build"];
  const txName = argv.name;

  const utxoAmount = argv["utxo-amount"]
    ? BigInt(argv["utxo-amount"])
    : getDeployUtxoAmount();
  if (utxoAmount <= 0n) {
    throw new Error(`--utxo-amount must be positive, got ${utxoAmount}`);
  }
  const components = argv.components ? argv.components.split(",") : [];

  // Validate components if provided
  if (components.length > 0) {
    if (components.includes("all") && components.length > 1) {
      throw new Error(
        `--components 'all' cannot be combined with other component names`,
      );
    }
    if (!components.includes("all")) {
      validateStagingTrackComponents(components);
    }
  }

  console.log(`===========================================`);
  console.log(
    `Generating staging track deployment transactions for ${network}`,
  );
  console.log(`===========================================`);
  console.log(`UTxO Amount: ${utxoAmount} lovelace`);

  const config = loadAikenConfig(network);
  const contracts = getContractInstances(network, useBuild);
  const networkId = getNetworkId(network);

  // Parse signers for multisig contracts (council, tech-auth)
  const { totalSigners: techAuthTotalSigners, signers: techAuthSigners } =
    parseSignersWithCount("TECH_AUTH_SIGNERS");
  const { totalSigners: councilTotalSigners, signers: councilSigners } =
    parseSignersWithCount("COUNCIL_SIGNERS");

  console.log(`\nTotal tech auth signers: ${techAuthTotalSigners}`);
  console.log(
    `Number of tech auth signer pairs: ${Object.keys(techAuthSigners).length}`,
  );
  console.log(`Total council signers: ${councilTotalSigners}`);
  console.log(
    `Number of council signer pairs: ${Object.keys(councilSigners).length}`,
  );

  const { blaze } = await createBlaze(network, argv.provider);

  // Fetch protocol parameters for min UTxO calculation and collateral validation
  const protocolParams = await getProtocolParameters(blaze.provider);

  // Query collateral UTxO
  let collateralUtxo: TransactionUnspentOutput | undefined;
  if (config.collateral_utxo_hash) {
    const collateralInput = TransactionInput.fromCore({
      txId: TransactionId(config.collateral_utxo_hash),
      index: config.collateral_utxo_index,
    });
    const resolved = await blaze.provider.resolveUnspentOutputs([
      collateralInput,
    ]);
    if (resolved.length > 0) {
      collateralUtxo = resolved[0];
      console.log(
        `\nUsing collateral UTxO: ${config.collateral_utxo_hash}#${config.collateral_utxo_index} with ${collateralUtxo.output().amount().coin()} lovelace`,
      );

      // Validate collateral is sufficient
      const estimatedMaxFee = 5_000_000n;
      const requiredCollateral = calculateRequiredCollateral(
        estimatedMaxFee,
        protocolParams.collateralPercentage,
      );
      const availableCollateral = collateralUtxo.output().amount().coin();

      if (availableCollateral < requiredCollateral) {
        throw new Error(
          `Collateral UTxO has ${availableCollateral} lovelace but requires at least ${requiredCollateral} lovelace`,
        );
      }
      console.log(
        `Collateral validation passed: ${availableCollateral} lovelace >= ${requiredCollateral} lovelace required`,
      );
    } else {
      throw new Error(
        `Collateral UTxO not found: ${config.collateral_utxo_hash}#${config.collateral_utxo_index}. Ensure the UTxO exists and has not been spent.`,
      );
    }
  }

  /**
   * Generate a staging forever deployment transaction.
   * Each staging forever validator mints its own NFT and creates an output with datum.
   */
  async function generateStagingForeverDeployment(
    params: StagingForeverDeployParams,
  ) {
    const oneShotInput = TransactionInput.fromCore({
      txId: TransactionId(params.oneShotHash),
      index: params.oneShotIndex,
    });
    const resolvedUtxos = await blaze.provider.resolveUnspentOutputs([
      oneShotInput,
    ]);
    if (resolvedUtxos.length === 0) {
      throw new Error(
        `One-shot UTxO not found on chain: ${params.oneShotHash}#${params.oneShotIndex}. ` +
          `Ensure the UTxO exists and has not been spent.`,
      );
    }
    const oneShotUtxo = resolvedUtxos[0];

    const foreverAddress = addressFromValidator(
      networkId,
      params.stagingForeverContract.Script,
    );

    const datum = params.datumBuilder();
    const redeemer = params.redeemerBuilder();

    // Create output with dynamic min UTxO calculation
    const foreverOutput = TransactionOutput.fromCore({
      address: PaymentAddress(foreverAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([
          [AssetId(params.stagingForeverContract.Script.hash()), 1n],
        ]),
      },
      datum: datum.toCore(),
    });
    foreverOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, foreverOutput));

    let txBuilder = blaze
      .newTransaction()
      .addInput(oneShotUtxo)
      .addMint(
        PolicyId(params.stagingForeverContract.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        redeemer,
      )
      .provideScript(params.stagingForeverContract.Script)
      .addOutput(foreverOutput);

    if (collateralUtxo) {
      txBuilder = txBuilder.provideCollateral([collateralUtxo]);
    }

    const knownUtxos = [oneShotUtxo];
    if (collateralUtxo) knownUtxos.push(collateralUtxo);

    const { tx } = await completeTx(txBuilder, {
      commandName: `deploy-staging-track/${params.name}`,
      provider: blaze.provider,
      networkId,
      environment: network,
      knownUtxos,
    });
    return tx;
  }

  // Build versioned multisig state for council/tech-auth
  const councilState = createMultisigStateFromMap(
    councilTotalSigners,
    councilSigners,
  );
  const techAuthState = createMultisigStateFromMap(
    techAuthTotalSigners,
    techAuthSigners,
  );

  // Build federated ops datum
  const federatedOpsDatum = createFederatedOpsDatum(
    "PERMISSIONED_CANDIDATES",
    1n,
  );

  // Simple datum for reserve/ics (Pair(0, 0))
  const simpleVersionedDatum = PlutusData.fromCore({
    constructor: 0n,
    fields: {
      items: [
        PlutusData.newInteger(0n).toCore(),
        PlutusData.newInteger(0n).toCore(),
      ],
    },
  });

  // Initial terms and conditions datum
  const termsAndConditionsDatum: Contracts.VersionedTermsAndConditions = [
    ["0000000000000000000000000000000000000000000000000000000000000000", ""],
    0n,
  ];

  // Define all staging forever deployments
  const allTransactionDefs = [
    {
      name: "council-staging-forever-deployment",
      component: "council",
      generator: () => {
        const params: StagingForeverDeployParams = {
          name: "council-staging-forever",
          displayName: "Council Staging Forever",
          oneShotHash: config.council_staging_one_shot_hash,
          oneShotIndex: config.council_staging_one_shot_index,
          stagingForeverContract: contracts.councilStagingForever!,
          datumBuilder: () =>
            serialize(Contracts.VersionedMultisig, councilState),
          redeemerBuilder: () =>
            serialize(Contracts.PermissionedRedeemer, councilSigners),
        };
        return generateStagingForeverDeployment(params);
      },
    },
    {
      name: "tech-auth-staging-forever-deployment",
      component: "tech-auth",
      generator: () => {
        const params: StagingForeverDeployParams = {
          name: "tech-auth-staging-forever",
          displayName: "Tech Auth Staging Forever",
          oneShotHash: config.technical_authority_staging_one_shot_hash,
          oneShotIndex: config.technical_authority_staging_one_shot_index,
          stagingForeverContract: contracts.techAuthStagingForever!,
          datumBuilder: () =>
            serialize(Contracts.VersionedMultisig, techAuthState),
          redeemerBuilder: () =>
            serialize(Contracts.PermissionedRedeemer, techAuthSigners),
        };
        return generateStagingForeverDeployment(params);
      },
    },
    {
      name: "federated-ops-staging-forever-deployment",
      component: "federated-ops",
      generator: () => {
        const params: StagingForeverDeployParams = {
          name: "federated-ops-staging-forever",
          displayName: "Federated Ops Staging Forever",
          oneShotHash: config.federated_operators_staging_one_shot_hash,
          oneShotIndex: config.federated_operators_staging_one_shot_index,
          stagingForeverContract: contracts.federatedOpsStagingForever!,
          datumBuilder: () =>
            serialize(Contracts.FederatedOps, federatedOpsDatum),
          redeemerBuilder: () => PlutusData.newInteger(0n),
        };
        return generateStagingForeverDeployment(params);
      },
    },
    {
      name: "reserve-staging-forever-deployment",
      component: "reserve",
      generator: () => {
        const params: StagingForeverDeployParams = {
          name: "reserve-staging-forever",
          displayName: "Reserve Staging Forever",
          oneShotHash: config.reserve_staging_one_shot_hash,
          oneShotIndex: config.reserve_staging_one_shot_index,
          stagingForeverContract: contracts.reserveStagingForever!,
          datumBuilder: () => simpleVersionedDatum,
          redeemerBuilder: () => PlutusData.newInteger(0n),
        };
        return generateStagingForeverDeployment(params);
      },
    },
    {
      name: "ics-staging-forever-deployment",
      component: "ics",
      generator: () => {
        const params: StagingForeverDeployParams = {
          name: "ics-staging-forever",
          displayName: "ICS Staging Forever",
          oneShotHash: config.ics_staging_one_shot_hash,
          oneShotIndex: config.ics_staging_one_shot_index,
          stagingForeverContract: contracts.icsStagingForever!,
          datumBuilder: () => simpleVersionedDatum,
          redeemerBuilder: () => PlutusData.newInteger(0n),
        };
        return generateStagingForeverDeployment(params);
      },
    },
    {
      name: "terms-and-conditions-staging-forever-deployment",
      component: "terms-and-conditions",
      generator: () => {
        const params: StagingForeverDeployParams = {
          name: "terms-and-conditions-staging-forever",
          displayName: "Terms and Conditions Staging Forever",
          oneShotHash: config.terms_and_conditions_staging_one_shot_hash,
          oneShotIndex: config.terms_and_conditions_staging_one_shot_index,
          stagingForeverContract: contracts.termsAndConditionsStagingForever!,
          datumBuilder: () =>
            serialize(
              Contracts.VersionedTermsAndConditions,
              termsAndConditionsDatum,
            ),
          redeemerBuilder: () => PlutusData.newInteger(0n),
        };
        return generateStagingForeverDeployment(params);
      },
    },
  ];

  // Filter transactions based on --name or --components options
  let transactions = allTransactionDefs;

  if (txName) {
    if (components.length > 0 && !components.includes("all")) {
      printInfo(
        `Warning: --name overrides --components. Using --name=${txName}`,
      );
    }
    const matched = allTransactionDefs.find((t) => t.name === txName);
    if (!matched) {
      const validNames = allTransactionDefs.map((t) => t.name).join(", ");
      throw new Error(
        `Transaction '${txName}' not found. Valid names: ${validNames}`,
      );
    }
    transactions = [matched];
    printInfo(`Targeting single transaction: ${txName}`);
  } else if (components.length > 0 && !components.includes("all")) {
    transactions = allTransactionDefs.filter((t) =>
      components.includes(t.component),
    );
  }

  const allTransactions: TxOutput[] = [];
  const allScriptOutputs: Map<string, ScriptOutputInfo[]> = new Map();

  for (const { name, generator } of transactions) {
    try {
      const tx = await generator();
      allTransactions.push({
        type: TX_TYPE_CONWAY,
        description: name,
        cborHex: tx.toCbor(),
        txHash: tx.getId(),
        signed: false,
      });

      const scriptOutputs: ScriptOutputInfo[] = [];
      const txBody = tx.body();
      const outputs = txBody.outputs();

      for (let i = 0; i < outputs.length; i++) {
        const outputData = outputs[i];
        const address = outputData.address();
        const addressBech32 = address.toBech32();

        const isScriptAddress =
          addressBech32.includes("addr_test1w") ||
          addressBech32.includes("addr1w") ||
          addressBech32.startsWith("addr_test1z") ||
          addressBech32.startsWith("addr1z");

        if (isScriptAddress || outputData.amount().multiasset()) {
          const outputInfo: ScriptOutputInfo = {
            address: addressBech32,
          };

          const multiasset = outputData.amount().multiasset();
          if (multiasset) {
            for (const [assetId] of multiasset) {
              const policyId = assetId.slice(0, 56);
              const assetNameHex = assetId.slice(56);
              outputInfo.policyId = policyId;
              if (assetNameHex) {
                try {
                  const bytes = new Uint8Array(
                    assetNameHex
                      .match(/.{1,2}/g)!
                      .map((byte: string) => parseInt(byte, 16)),
                  );
                  const decoded = new TextDecoder().decode(bytes);
                  if (/^[\x20-\x7E]*$/.test(decoded)) {
                    outputInfo.assetName = decoded || "(empty)";
                  } else {
                    outputInfo.assetName = assetNameHex;
                  }
                } catch {
                  outputInfo.assetName = assetNameHex || "(empty)";
                }
              } else {
                outputInfo.assetName = "(empty)";
              }
              break;
            }
          }

          scriptOutputs.push(outputInfo);
        }
      }

      if (scriptOutputs.length > 0) {
        allScriptOutputs.set(name, scriptOutputs);
      }
    } catch (error) {
      printError(`Error generating ${name}: ${error}`);
      throw error;
    }
  }

  const deploymentDir = resolve(output, network);
  ensureDirectory(deploymentDir);

  const outputFile = resolve(
    deploymentDir,
    "staging-track-deployment-transactions.json",
  );

  const deploymentOutput = createDeploymentOutput(
    network,
    { utxoAmount },
    allTransactions,
  );

  writeJsonFile(outputFile, deploymentOutput);

  console.log(`===========================================`);
  printSuccess(
    `Generated ${transactions.length} staging track deployment transactions`,
  );
  console.log(`Output file: ${outputFile}`);
  console.log(`===========================================`);

  printTransactionSummary(allTransactions);

  console.log(`\nScript Outputs:`);
  console.log(`===========================================`);
  for (const [outputTxName, outputs] of allScriptOutputs) {
    console.log(`\n${outputTxName}:`);
    for (const outputData of outputs) {
      console.log(`  Address: ${outputData.address}`);
      if (outputData.policyId) {
        console.log(`  Policy ID: ${outputData.policyId}`);
        if (outputData.assetName) {
          console.log(`  Asset Name: ${outputData.assetName}`);
        }
      }
      console.log(``);
    }
  }
}

const commandModule: CommandModule<GlobalOptions, DeployStagingTrackOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
