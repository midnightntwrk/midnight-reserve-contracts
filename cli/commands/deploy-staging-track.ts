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

import type { TransactionOutput as TxOutput } from "../lib/types";
import { getNetworkId } from "../lib/types";
import { loadAikenConfig, getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import { getProtocolParameters, calculateMinUtxo } from "../lib/protocol";
import { getContractInstances } from "../lib/contracts";
import {
  parseSignersWithCount,
  createMultisigStateFromMap,
} from "../lib/signers";
import { createFederatedOpsDatum } from "../lib/candidates";
import {
  writeJsonFile,
  createDeploymentOutput,
  printSuccess,
  printError,
  printInfo,
  printTransactionSummary,
  ensureDirectory,
  TX_TYPE_CONWAY,
} from "../utils/output";
import { createOneShotUtxo } from "../utils/transaction";
import * as Contracts from "../../contract_blueprint";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";

/** Valid component names for staging track deployment */
export const VALID_STAGING_TRACK_COMPONENTS = [
  "council",
  "tech-auth",
  "federated-ops",
  "reserve",
  "ics",
  "terms-and-conditions",
] as const;

export type StagingTrackComponent =
  (typeof VALID_STAGING_TRACK_COMPONENTS)[number];

/** Validate staging track components */
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

export interface DeployStagingTrackOptions {
  network: string;
  output: string;
  provider: "blockfrost" | "maestro" | "emulator" | "kupmios";
  dryRun: boolean;
  utxoAmount: bigint;
  /** One-shot transaction hash for staging track deployments */
  oneShotHash: string;
  /** Starting index for one-shot UTxOs */
  oneShotStartIndex: number;
  /** Components to deploy (default: all staging forever validators) */
  components: string[];
  /** Deploy a single transaction by name */
  name?: string;
  /** Use freshly built blueprint instead of deployed scripts */
  useBuild?: boolean;
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

/**
 * Deploy staging track validators.
 *
 * Staging forever validators delegate to MAIN forever contracts (not their own two-stage).
 * They read logic hashes from the "staging" NFT on the main two-stage contracts.
 *
 * Each staging forever validator needs:
 * 1. A one-shot UTxO to consume (ensures NFT uniqueness)
 * 2. Mint its NFT (policy ID = script hash)
 * 3. Output with the NFT and appropriate datum
 */
export async function deployStagingTrack(
  options: DeployStagingTrackOptions,
): Promise<void> {
  const {
    network,
    output,
    utxoAmount,
    oneShotHash,
    oneShotStartIndex,
    components,
    name,
    useBuild,
  } = options;

  // Validate components if provided
  if (components && components.length > 0) {
    validateStagingTrackComponents(components);
  }

  console.log(`===========================================`);
  console.log(
    `Generating staging track deployment transactions for ${network}`,
  );
  console.log(`===========================================`);
  console.log(`UTxO Amount: ${utxoAmount} lovelace`);
  console.log(`One-shot Hash: ${oneShotHash}`);
  console.log(`One-shot Start Index: ${oneShotStartIndex}`);

  const config = loadAikenConfig(network);
  const contracts = getContractInstances(network, useBuild);
  const networkId = getNetworkId(network);
  const deployerAddr = getDeployerAddress();

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

  const { blaze } = await createBlaze(network, options.provider);

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
    const oneShotUtxo = createOneShotUtxo(
      params.oneShotHash,
      params.oneShotIndex,
      deployerAddr,
      utxoAmount,
    );

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

    return await txBuilder.complete();
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
  let currentIndex = oneShotStartIndex;
  const allTransactionDefs = [
    {
      name: "council-staging-forever-deployment",
      component: "council",
      generator: () => {
        const params: StagingForeverDeployParams = {
          name: "council-staging-forever",
          displayName: "Council Staging Forever",
          oneShotHash,
          oneShotIndex: currentIndex++,
          stagingForeverContract: contracts.councilStagingForever,
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
          oneShotHash,
          oneShotIndex: currentIndex++,
          stagingForeverContract: contracts.techAuthStagingForever,
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
          oneShotHash,
          oneShotIndex: currentIndex++,
          stagingForeverContract: contracts.federatedOpsStagingForever,
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
          oneShotHash,
          oneShotIndex: currentIndex++,
          stagingForeverContract: contracts.reserveStagingForever,
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
          oneShotHash,
          oneShotIndex: currentIndex++,
          stagingForeverContract: contracts.icsStagingForever,
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
          oneShotHash,
          oneShotIndex: currentIndex++,
          stagingForeverContract: contracts.termsAndConditionsStagingForever,
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

  if (name) {
    if (components.length > 0 && !components.includes("all")) {
      printInfo(`Warning: --name overrides --components. Using --name=${name}`);
    }
    const matched = allTransactionDefs.find((t) => t.name === name);
    if (!matched) {
      const validNames = allTransactionDefs.map((t) => t.name).join(", ");
      throw new Error(
        `Transaction '${name}' not found. Valid names: ${validNames}`,
      );
    }
    transactions = [matched];
    printInfo(`Targeting single transaction: ${name}`);
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
  for (const [txName, outputs] of allScriptOutputs) {
    console.log(`\n${txName}:`);
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
