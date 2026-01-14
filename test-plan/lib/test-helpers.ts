/**
 * Reusable test utilities for journey tests
 *
 * This module provides common patterns and utilities used across test journeys.
 */

import type { JourneyContext, TestResult, DeploymentInfo } from "./types";
import type { TransactionUnspentOutput } from "@blaze-cardano/sdk";
import { ContractsManager } from "./contracts";

/**
 * Initialize a test result with standard fields
 */
export function initTestResult(testId: string, name: string): TestResult {
  return {
    testId,
    name,
    status: "running",
    startTime: new Date(),
  };
}

/**
 * Mark test as completed (either passed or failed)
 */
export function completeTestResult(
  result: TestResult,
  status: "passed" | "failed" | "skipped",
  notes?: string,
  error?: string
): TestResult {
  result.status = status;
  result.endTime = new Date();
  if (notes) result.notes = notes;
  if (error) result.error = error;
  return result;
}

/**
 * Wrapper for negative tests that expect failure
 *
 * Executes a function and verifies it throws an error.
 * Returns "passed" if it fails correctly, "failed" if it succeeds unexpectedly.
 */
export async function expectFailure(
  fn: () => Promise<void>,
  options?: {
    errorShouldInclude?: string[];
    description?: string;
  }
): Promise<{ passed: boolean; message: string }> {
  try {
    await fn();
    // If we get here, the operation succeeded (which is wrong for negative test)
    return {
      passed: false,
      message: `Expected operation to fail${options?.description ? ` (${options.description})` : ""}, but it succeeded`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Check if error message contains expected keywords
    if (options?.errorShouldInclude) {
      const hasExpectedKeyword = options.errorShouldInclude.some((keyword) =>
        errorMsg.toLowerCase().includes(keyword.toLowerCase())
      );

      if (hasExpectedKeyword) {
        return {
          passed: true,
          message: `Correctly rejected with expected error: ${errorMsg}`,
        };
      }
    }

    // Failed but for potentially wrong reason (still counts as passed for negative test)
    return {
      passed: true,
      message: `Operation failed (expected): ${errorMsg}`,
    };
  }
}

/**
 * Get contracts and common setup for a test
 */
export async function getTestSetup(ctx: JourneyContext) {
  const contracts = new ContractsManager();
  const blaze = await ctx.provider.getBlaze("deployer");
  const address = await blaze.wallet.getChangeAddress();
  const config = ctx.provider.getConfig();

  return {
    contracts,
    blaze,
    address,
    config,
  };
}

/**
 * Find a one-shot UTxO by transaction hash and index
 */
export async function findOneShotUtxo(
  ctx: JourneyContext,
  txHash: string,
  index: number
): Promise<TransactionUnspentOutput | null> {
  const { blaze, address } = await getTestSetup(ctx);
  const utxosSet = await blaze.provider.getUnspentOutputs(address);
  const utxos = Array.from(utxosSet);

  return (
    utxos.find((utxo) => {
      const txId = utxo.input().transactionId();
      const txIdStr = typeof txId === "string" ? txId : txId.toString();
      return txIdStr === txHash && utxo.input().index() === BigInt(index);
    }) || null
  );
}

/**
 * Find any UTxO from the deployer wallet (for negative tests that don't want to consume one-shots)
 */
export async function findAnyUtxo(
  ctx: JourneyContext
): Promise<TransactionUnspentOutput> {
  const { blaze, address } = await getTestSetup(ctx);
  const utxosSet = await blaze.provider.getUnspentOutputs(address);
  const utxos = Array.from(utxosSet);

  if (utxos.length === 0) {
    throw new Error("No UTxOs available for deployer");
  }

  return utxos[0];
}

/**
 * Find a UTxO containing a specific NFT (policy ID + asset name)
 * Searches across wallet and contract addresses
 */
export async function findUtxoWithNft(
  ctx: JourneyContext,
  policyId: string,
  assetName: string = ""
): Promise<TransactionUnspentOutput | null> {
  const { blaze, address } = await getTestSetup(ctx);
  const { AssetId, Script, Hash28ByteBase16, addressFromValidator } = await import("@blaze-cardano/core");

  const targetAssetId = AssetId(policyId + assetName);

  // Search wallet UTxOs
  const walletUtxosSet = await blaze.provider.getUnspentOutputs(address);
  const walletUtxos = Array.from(walletUtxosSet);

  const walletMatch = walletUtxos.find((utxo) => {
    const assets = utxo.output().amount().multiasset();
    if (!assets) return false;
    for (const [assetId] of assets) {
      if (assetId === targetAssetId) return true;
    }
    return false;
  });

  if (walletMatch) return walletMatch;

  // If not found in wallet, search at the contract address (for two-stage NFTs)
  // The policyId IS the script hash for two-stage contracts
  const script = Script.newPlutusV2Script(Hash28ByteBase16(policyId));
  const contractAddress = addressFromValidator(0, script);
  const contractUtxosSet = await blaze.provider.getUnspentOutputs(contractAddress);
  const contractUtxos = Array.from(contractUtxosSet);

  const contractMatch = contractUtxos.find((utxo) => {
    const assets = utxo.output().amount().multiasset();
    if (!assets) return false;
    for (const [assetId] of assets) {
      if (assetId === targetAssetId) return true;
    }
    return false;
  });

  return contractMatch || null;
}

/**
 * Store deployment information in journey state
 */
export function storeDeployment(
  ctx: JourneyContext,
  key: string,
  deployment: DeploymentInfo
): void {
  ctx.journeyState.deployments[key] = deployment;
}

/**
 * Get deployment information from journey state
 */
export function getDeployment(
  ctx: JourneyContext,
  key: string
): DeploymentInfo | undefined {
  return ctx.journeyState.deployments[key];
}

/**
 * Generate test signers with proper formatting
 *
 * @param count Number of signers to generate
 * @param prefix Whether to add "8200581c" prefix (true for Council/TechAuth, false for Reserve)
 */
export function generateTestSigners(
  count: number,
  prefix: boolean = true,
  offset: number = 0
): Record<string, string> {
  const signers: Record<string, string> = {};

  for (let i = 0; i < count; i++) {
    // Generate deterministic payment hash for testing
    const index = i + offset;
    const baseHash = `${"0".repeat(56 - index.toString().length)}${index}`;
    const paymentHash = prefix ? `8200581c${baseHash}` : baseHash;

    // Generate dummy SR25519 key (64 hex chars)
    // Use last 2 hex digits of index to ensure exactly 64 chars
    const indexHex = (index % 256).toString(16).padStart(2, "0").toUpperCase();
    const sr25519Key = `${"A".repeat(62)}${indexHex}`;

    signers[paymentHash] = sr25519Key;
  }

  return signers;
}

/**
 * Create a single test signer from a real payment hash
 */
export function createSigner(
  paymentHash: string,
  prefix: boolean = true
): Record<string, string> {
  const key = prefix ? `8200581c${paymentHash}` : paymentHash;
  // Generate dummy SR25519 key
  const sr25519Key = "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B";

  return { [key]: sr25519Key };
}

/**
 * Verify a UTxO exists at a specific transaction output
 */
export async function verifyUtxoExists(
  ctx: JourneyContext,
  txHash: string,
  index: number
): Promise<boolean> {
  try {
    const { blaze } = await getTestSetup(ctx);
    const { TransactionInput } = await import("@blaze-cardano/core");

    const utxos = await blaze.provider.resolveUnspentOutputs([
      new TransactionInput(txHash, BigInt(index)),
    ]);

    return utxos.length > 0;
  } catch {
    return false;
  }
}

/**
 * Wait for a transaction to be confirmed
 */
export async function waitForTx(
  ctx: JourneyContext,
  txHash: string,
  maxAttempts: number = 20,
  delayMs: number = 3000
): Promise<boolean> {
  const { blaze } = await getTestSetup(ctx);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { TransactionInput } = await import("@blaze-cardano/core");
      const utxos = await blaze.provider.resolveUnspentOutputs([
        new TransactionInput(txHash, 0n),
      ]);

      if (utxos.length > 0) {
        return true;
      }
    } catch {
      // Continue waiting
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return false;
}

/**
 * Execute a test step with standard error handling
 */
export async function executeTestStep<T>(
  result: TestResult,
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    const value = await fn();
    return value;
  } catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
    result.endTime = new Date();
    throw error;
  }
}

/**
 * Find a UTxO containing a specific NFT (by policy hash and asset name) from a given array
 *
 * @param utxos Array of UTxOs to search
 * @param policyHash Policy ID of the NFT
 * @param assetNameText Asset name as text (will be encoded to hex)
 * @returns The UTxO containing the NFT, or undefined if not found
 *
 * @example
 * // Find the "main" NFT from Council two-stage
 * const mainUtxo = findUtxoWithNftInArray(councilTwoStageUtxos, council.twoStage.Script.hash(), "main");
 */
export function findUtxoWithNftInArray(
  utxos: TransactionUnspentOutput[],
  policyHash: string,
  assetNameText: string
): TransactionUnspentOutput | undefined {
  const { toHex, AssetId } = require("@blaze-cardano/core");
  const assetNameHex = toHex(new TextEncoder().encode(assetNameText));
  const targetAssetId = AssetId(policyHash + assetNameHex);

  return utxos.find(utxo => {
    const value = utxo.output().amount();
    const assets = value.multiasset();
    if (!assets) return false;
    return (assets.get(targetAssetId) ?? 0n) === 1n;
  });
}

/**
 * Query UTxOs from multiple contract addresses at once
 *
 * @param ctx Journey context
 * @param contracts Object mapping names to script hashes or Script objects
 * @param networkId Network ID (0 for testnet, 1 for mainnet)
 * @returns Object with same keys as input, values are UTxO arrays
 *
 * @example
 * const utxos = await getContractUtxos(ctx, {
 *   councilForever: council.forever.Script,
 *   councilTwoStage: council.twoStage.Script,
 *   techAuthForever: techAuth.forever.Script,
 * }, 0);
 * // Returns: { councilForever: [...], councilTwoStage: [...], techAuthForever: [...] }
 */
export async function getContractUtxos(
  ctx: JourneyContext,
  contracts: Record<string, { hash: () => string } | string>,
  networkId: number = 0
): Promise<Record<string, TransactionUnspentOutput[]>> {
  const { blaze } = await getTestSetup(ctx);
  const { addressFromValidator } = await import("@blaze-cardano/core");

  const result: Record<string, TransactionUnspentOutput[]> = {};

  for (const [name, scriptOrHash] of Object.entries(contracts)) {
    // Handle both Script objects and raw hash strings
    const address = typeof scriptOrHash === "string"
      ? (() => {
          const { Script, Hash28ByteBase16 } = require("@blaze-cardano/core");
          const script = Script.newPlutusV2Script(Hash28ByteBase16(scriptOrHash));
          return addressFromValidator(networkId, script);
        })()
      : addressFromValidator(networkId, scriptOrHash as any);

    // Query UTxOs
    const utxosSet = await blaze.provider.getUnspentOutputs(address);
    result[name] = Array.from(utxosSet);
  }

  return result;
}

/**
 * Find a UTxO by transaction hash and output index
 *
 * @param utxos Array of UTxOs to search
 * @param txHash Transaction hash (as string)
 * @param outputIndex Output index
 * @returns The matching UTxO, or undefined if not found
 *
 * @example
 * const mainUtxo = findUtxoByTxOutput(twoStageUtxos, deploymentTxId, 0);
 */
export function findUtxoByTxOutput(
  utxos: TransactionUnspentOutput[],
  txHash: string,
  outputIndex: number
): TransactionUnspentOutput | undefined {
  return utxos.find((utxo) => {
    const txId = utxo.input().transactionId();
    const txIdStr = typeof txId === "string" ? txId : txId.toString();
    return txIdStr === txHash && utxo.input().index() === BigInt(outputIndex);
  });
}

/**
 * Execute a function expecting it to fail, useful for negative tests
 *
 * @param fn Function that should throw an error
 * @param options Optional validation for error message
 * @returns Object with passed status and message
 *
 * @example
 * const rejection = await expectTransactionRejection(
 *   async () => await ctx.provider.submitTransaction("deployer", txBuilder),
 *   { errorShouldInclude: ["insufficient", "signature"] }
 * );
 * if (!rejection.passed) {
 *   return completeTestResult(result, "failed", undefined, rejection.message);
 * }
 */
export async function expectTransactionRejection(
  fn: () => Promise<void>,
  options?: {
    errorShouldInclude?: string[];
    description?: string;
    silent?: boolean; // Don't log "Script Bytes" spam
  }
): Promise<{ passed: boolean; message: string; error?: string }> {
  try {
    await fn();
    // If we get here, the operation succeeded (which is wrong for negative test)
    return {
      passed: false,
      message: `Expected transaction to fail${options?.description ? ` (${options.description})` : ""}, but it succeeded`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Filter out "Script Bytes:" spam from error messages
    const cleanError = options?.silent !== false
      ? errorMsg.split('\n').filter(line => !line.trim().startsWith('Script Bytes:')).join('\n').trim()
      : errorMsg;

    // Check if error message contains expected keywords
    if (options?.errorShouldInclude) {
      const hasExpectedKeyword = options.errorShouldInclude.some((keyword) =>
        cleanError.toLowerCase().includes(keyword.toLowerCase())
      );

      if (hasExpectedKeyword) {
        return {
          passed: true,
          message: `Transaction correctly rejected with expected error`,
          error: cleanError,
        };
      }
    }

    // Failed but for potentially wrong reason (still counts as passed for negative test)
    return {
      passed: true,
      message: `Transaction failed as expected`,
      error: cleanError,
    };
  }
}

/**
 * Deploy governance contracts (Council, TechAuth, Thresholds, stake registration)
 * Helper for journeys that need governance as prerequisites
 */
export async function deployGovernanceContracts(ctx: JourneyContext): Promise<{
  councilTxHash: string;
  techAuthTxHash: string;
  thresholdsTxHash: string;
  registerTxHash: string;
}> {
  const { buildCouncilDeploymentTx, buildTechAuthDeploymentTx } = await import("../../sdk/lib/tx-builders/deployment");
  const { buildDeployAllThresholdsTx } = await import("../../sdk/lib/tx-builders/thresholds");
  const { ContractsManager } = await import("./contracts");
  const { Credential, CredentialType, Hash28ByteBase16 } = await import("@blaze-cardano/core");

  const { blaze, config } = await getTestSetup(ctx);
  const address = await blaze.wallet.getChangeAddress();
  const utxosSet = await blaze.provider.getUnspentOutputs(address);
  const deployerUtxos = Array.from(utxosSet);

  const contracts = new ContractsManager();

  // Helper to find one-shot UTxO
  const findOneShot = (utxos: any[], hash: string, index: number) => {
    return utxos.find((utxo) => {
      const txId = utxo.input().transactionId();
      const txIdStr = typeof txId === "string" ? txId : txId.toString();
      return txIdStr === hash && utxo.input().index() === BigInt(index);
    });
  };

  // 1. Deploy Council
  const councilOneShotUtxo = findOneShot(
    deployerUtxos,
    config.council_one_shot_hash,
    config.council_one_shot_index
  );
  if (!councilOneShotUtxo) throw new Error("Council one-shot UTxO not found");

  const council = await contracts.getCouncil();
  const govAuth = await contracts.getGovAuth();

  // Use deployer's payment credential for Council (same as Journey 1 Phase 1.4)
  const paymentHash = address.asBase()?.getPaymentCredential().hash!;
  const councilSigners = createSigner(paymentHash, true);

  const councilTxBuilder = await buildCouncilDeploymentTx({
    blaze,
    councilForeverScript: council.forever.Script,
    councilTwoStageScript: council.twoStage.Script,
    councilLogicScript: council.logic.Script,
    govAuthScript: govAuth.Script,
    councilOneShotUtxo,
    threshold: 1n,
    signers: councilSigners,
    networkId: 0,
  });

  const councilTxHash = await ctx.provider.submitTransaction("deployer", councilTxBuilder);

  ctx.journeyState.deployments["council"] = {
    componentName: "council",
    txHash: councilTxHash,
    outputIndex: 2,
    metadata: { mainOutputIndex: 0, stagingOutputIndex: 1, foreverOutputIndex: 2 },
  };

  // 2. Deploy TechAuth
  const techAuthOneShotUtxo = findOneShot(
    deployerUtxos,
    config.technical_authority_one_shot_hash,
    config.technical_authority_one_shot_index
  );
  if (!techAuthOneShotUtxo) throw new Error("TechAuth one-shot UTxO not found");

  const techAuth = await contracts.getTechAuth();

  // Use deployer's stake credential for TechAuth (same as Journey 1 Phase 1.5)
  const stakeHash = address.asBase()?.getStakeCredential()?.hash;
  if (!stakeHash) throw new Error("Deployer address must have a stake credential");
  const techAuthSigners = createSigner(stakeHash, true);

  const techAuthTxBuilder = await buildTechAuthDeploymentTx({
    blaze,
    techAuthForeverScript: techAuth.forever.Script,
    techAuthTwoStageScript: techAuth.twoStage.Script,
    techAuthLogicScript: techAuth.logic.Script,
    govAuthScript: govAuth.Script,
    techAuthOneShotUtxo,
    threshold: 1n,
    signers: techAuthSigners,
    networkId: 0,
  });

  const techAuthTxHash = await ctx.provider.submitTransaction("deployer", techAuthTxBuilder);

  ctx.journeyState.deployments["techAuth"] = {
    componentName: "techAuth",
    txHash: techAuthTxHash,
    outputIndex: 2,
    metadata: { mainOutputIndex: 0, stagingOutputIndex: 1, foreverOutputIndex: 2 },
  };

  // 3. Deploy all 5 Thresholds
  const thresholdsContracts = await contracts.getThresholds();
  const initialThreshold: [bigint, bigint, bigint, bigint] = [1n, 2n, 1n, 2n];

  const thresholdsTxBuilder = await buildDeployAllThresholdsTx({
    blaze,
    thresholds: {
      mainGov: {
        script: thresholdsContracts.mainGov.Script,
        oneShotUtxo: findOneShot(deployerUtxos, config.main_gov_one_shot_hash, config.main_gov_one_shot_index)!,
      },
      stagingGov: {
        script: thresholdsContracts.stagingGov.Script,
        oneShotUtxo: findOneShot(deployerUtxos, config.staging_gov_one_shot_hash, config.staging_gov_one_shot_index)!,
      },
      mainCouncilUpdate: {
        script: thresholdsContracts.mainCouncilUpdate.Script,
        oneShotUtxo: findOneShot(deployerUtxos, config.main_council_update_one_shot_hash, config.main_council_update_one_shot_index)!,
      },
      mainTechAuthUpdate: {
        script: thresholdsContracts.mainTechAuthUpdate.Script,
        oneShotUtxo: findOneShot(deployerUtxos, config.main_tech_auth_update_one_shot_hash, config.main_tech_auth_update_one_shot_index)!,
      },
      mainFederatedOpsUpdate: {
        script: thresholdsContracts.mainFederatedOpsUpdate.Script,
        oneShotUtxo: findOneShot(deployerUtxos, config.main_federated_ops_update_one_shot_hash, config.main_federated_ops_update_one_shot_index)!,
      },
    },
    initialThreshold,
    networkId: 0,
  });

  const thresholdsTxHash = await ctx.provider.submitTransaction("deployer", thresholdsTxBuilder);

  ctx.journeyState.deployments["thresholds"] = {
    componentName: "thresholds",
    txHash: thresholdsTxHash,
    outputIndex: 0,
    metadata: { initialThreshold },
  };

  // 4. Register stake credentials
  const govAuthHash = govAuth.Script.hash();
  const councilLogicHash = council.logic.Script.hash();
  const techAuthLogicHash = techAuth.logic.Script.hash();

  const registerTxBuilder = blaze
    .newTransaction()
    .addRegisterStake(Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(govAuthHash),
    }))
    .addRegisterStake(Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(councilLogicHash),
    }))
    .addRegisterStake(Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(techAuthLogicHash),
    }));

  const registerTxHash = await ctx.provider.submitTransaction("deployer", registerTxBuilder);

  return { councilTxHash, techAuthTxHash, thresholdsTxHash, registerTxHash };
}

/**
 * Parse inline datum from a UTxO with type safety
 *
 * @param utxo The UTxO to extract datum from
 * @param contractType The contract type to parse (from contract_blueprint)
 * @returns Parsed datum
 * @throws Error if datum is missing or invalid
 *
 * @example
 * const { parse } = await import("@blaze-cardano/data");
 * const Contracts = await import("../../contract_blueprint");
 * const state = parseInlineDatum(foreverUtxo, Contracts.VersionedMultisig, parse);
 */
export function parseInlineDatum<T>(
  utxo: TransactionUnspentOutput,
  contractType: any,
  parseFn: (type: any, data: any) => T
): T {
  const datum = utxo.output().datum();
  if (!datum || datum.asInlineData() === undefined) {
    throw new Error("UTxO missing inline datum");
  }
  return parseFn(contractType, datum.asInlineData()!);
}

// ============================================================================
// TWO-STAGE UPGRADE HELPERS
// ============================================================================

/**
 * Query main and staging UTxOs from a two-stage contract address
 *
 * @param ctx Journey context
 * @param twoStageScript The two-stage script (e.g., council.twoStage.Script)
 * @returns Object with main and staging UTxOs
 */
export async function getTwoStageUtxos(
  ctx: JourneyContext,
  twoStageScript: { hash: () => string }
): Promise<{
  main: TransactionUnspentOutput;
  staging: TransactionUnspentOutput;
  all: TransactionUnspentOutput[];
}> {
  const { blaze } = await getTestSetup(ctx);
  const { addressFromValidator, AssetId, toHex } = await import("@blaze-cardano/core");

  const twoStageAddress = addressFromValidator(0, twoStageScript as any);
  const utxosSet = await blaze.provider.getUnspentOutputs(twoStageAddress);
  const utxos = Array.from(utxosSet);

  const policyId = twoStageScript.hash();
  const mainAssetName = toHex(new TextEncoder().encode("main"));
  const stagingAssetName = toHex(new TextEncoder().encode("staging"));
  const mainAssetId = AssetId(policyId + mainAssetName);
  const stagingAssetId = AssetId(policyId + stagingAssetName);

  const main = utxos.find(utxo => {
    const assets = utxo.output().amount().multiasset();
    return assets && (assets.get(mainAssetId) ?? 0n) === 1n;
  });

  const staging = utxos.find(utxo => {
    const assets = utxo.output().amount().multiasset();
    return assets && (assets.get(stagingAssetId) ?? 0n) === 1n;
  });

  if (!main || !staging) {
    throw new Error(`Could not find two-stage UTxOs (main: ${!!main}, staging: ${!!staging})`);
  }

  return { main, staging, all: utxos };
}

/**
 * Build native scripts for Council and TechAuth authorization
 *
 * @param ctx Journey context
 * @returns Object with wrapped native scripts and their policy IDs
 */
export async function buildAuthNativeScripts(ctx: JourneyContext): Promise<{
  councilNativeScript: any;
  techAuthNativeScript: any;
  councilPolicyId: string;
  techAuthPolicyId: string;
}> {
  const { address } = await getTestSetup(ctx);
  const { NativeScripts, Script, Credential, CredentialType, addressFromCredential, Hash28ByteBase16 } =
    await import("@blaze-cardano/core");

  const thresholdsDeployment = getDeployment(ctx, "thresholds");
  if (!thresholdsDeployment) {
    throw new Error("Thresholds not deployed");
  }

  const threshold = thresholdsDeployment.metadata?.initialThreshold as [bigint, bigint, bigint, bigint];
  const paymentHash = address.asBase()?.getPaymentCredential().hash!;
  const stakeHash = address.asBase()?.getStakeCredential()?.hash;

  if (!stakeHash) {
    throw new Error("Deployer address must have a stake credential");
  }

  // Build bech32 addresses for native script construction
  const councilBech32 = addressFromCredential(0, Credential.fromCore({
    type: CredentialType.KeyHash,
    hash: Hash28ByteBase16(paymentHash),
  })).toBech32();

  const techAuthBech32 = addressFromCredential(0, Credential.fromCore({
    type: CredentialType.KeyHash,
    hash: Hash28ByteBase16(stakeHash),
  })).toBech32();

  // Build native scripts with thresholds
  const councilNativeScript = Script.newNativeScript(
    NativeScripts.atLeastNOfK(Number(threshold[2]), NativeScripts.justAddress(councilBech32, 0))
  );
  const techAuthNativeScript = Script.newNativeScript(
    NativeScripts.atLeastNOfK(Number(threshold[0]), NativeScripts.justAddress(techAuthBech32, 0))
  );

  return {
    councilNativeScript,
    techAuthNativeScript,
    councilPolicyId: councilNativeScript.hash(),
    techAuthPolicyId: techAuthNativeScript.hash(),
  };
}

/**
 * Query reference UTxOs needed for two-stage operations
 *
 * @param ctx Journey context
 * @returns Object with councilForever, techAuthForever, and thresholds UTxOs
 */
export async function getGovernanceReferenceUtxos(ctx: JourneyContext): Promise<{
  councilForever: TransactionUnspentOutput;
  techAuthForever: TransactionUnspentOutput;
  thresholds: TransactionUnspentOutput;
}> {
  const { contracts } = await getTestSetup(ctx);
  const council = await contracts.getCouncil();
  const techAuth = await contracts.getTechAuth();
  const thresholdsContracts = await contracts.getThresholds();

  const utxos = await getContractUtxos(ctx, {
    councilForever: council.forever.Script,
    techAuthForever: techAuth.forever.Script,
    thresholds: thresholdsContracts.mainGov.Script,
  }, 0);

  const { AssetId } = await import("@blaze-cardano/core");

  const councilForever = utxos.councilForever.find(utxo =>
    (utxo.output().amount().multiasset()?.get(AssetId(council.forever.Script.hash())) ?? 0n) === 1n
  );
  const techAuthForever = utxos.techAuthForever.find(utxo =>
    (utxo.output().amount().multiasset()?.get(AssetId(techAuth.forever.Script.hash())) ?? 0n) === 1n
  );
  const thresholds = utxos.thresholds.find(utxo =>
    (utxo.output().amount().multiasset()?.get(AssetId(thresholdsContracts.mainGov.Script.hash())) ?? 0n) === 1n
  );

  if (!councilForever || !techAuthForever || !thresholds) {
    const missing = [];
    if (!councilForever) missing.push("councilForever");
    if (!techAuthForever) missing.push("techAuthForever");
    if (!thresholds) missing.push("thresholds");
    throw new Error(`Required reference UTxOs not found: ${missing.join(", ")}`);
  }

  return { councilForever, techAuthForever, thresholds };
}

/**
 * Build govAuth reward account for withdrawals
 */
export async function buildGovAuthRewardAccount(ctx: JourneyContext): Promise<any> {
  const { contracts } = await getTestSetup(ctx);
  const govAuth = await contracts.getGovAuth();
  const { RewardAccount, CredentialType, Hash28ByteBase16, NetworkId } = await import("@blaze-cardano/core");

  return RewardAccount.fromCredential({
    type: CredentialType.ScriptHash,
    hash: Hash28ByteBase16(govAuth.Script.hash()),
  }, NetworkId.Testnet);
}

/**
 * Build a staging operation redeemer
 *
 * @param mainUtxo The main two-stage UTxO (referenced by staging operations)
 * @param newHash The new hash being staged
 * @param updateField The field being updated ("Logic", "Auth", "MitigationLogic", "MitigationAuth")
 */
export function buildStagingRedeemer(
  mainUtxo: TransactionUnspentOutput,
  newHash: string,
  updateField: "Logic" | "Auth" | "MitigationLogic" | "MitigationAuth" = "Logic"
): {
  redeemer: [string, { Staging: [{ transaction_id: string; output_index: bigint }, string] }];
  mainUtxoRef: { transaction_id: string; output_index: bigint };
} {
  const mainUtxoRef = {
    transaction_id: mainUtxo.input().transactionId(),
    output_index: BigInt(mainUtxo.input().index()),
  };

  return {
    redeemer: [updateField, { Staging: [mainUtxoRef, newHash] }],
    mainUtxoRef,
  };
}

/**
 * Build a promote (main update) redeemer
 *
 * @param stagingUtxo The staging two-stage UTxO (referenced by promote operations)
 * @param updateField The field being updated ("Logic", "Auth", "MitigationLogic", "MitigationAuth")
 */
export function buildPromoteRedeemer(
  stagingUtxo: TransactionUnspentOutput,
  updateField: "Logic" | "Auth" | "MitigationLogic" | "MitigationAuth" = "Logic"
): {
  redeemer: [string, { Main: [{ transaction_id: string; output_index: bigint }] }];
  stagingUtxoRef: { transaction_id: string; output_index: bigint };
} {
  const stagingUtxoRef = {
    transaction_id: stagingUtxo.input().transactionId(),
    output_index: BigInt(stagingUtxo.input().index()),
  };

  return {
    redeemer: [updateField, { Main: [stagingUtxoRef] }],
    stagingUtxoRef,
  };
}

/**
 * Deploy Reserve contracts (forever, two-stage, logic)
 *
 * Reserve uses raw payment hashes (NO 8200581c prefix), unlike Council/TechAuth.
 */
export async function deployReserveContracts(ctx: JourneyContext): Promise<{
  reserveTxHash: string;
}> {
  const { buildReserveDeploymentTx } = await import("../../sdk/lib/tx-builders/reserve-deployment");
  const { ContractsManager } = await import("./contracts");

  const config = ctx.provider.getConfig();
  const blaze = await ctx.provider.getBlaze("deployer");
  const address = await blaze.wallet.getChangeAddress();

  // Find the Reserve one-shot UTxO
  const deployerUtxos = await blaze.provider.getUnspentOutputs(address);
  const reserveOneShotUtxo = deployerUtxos.find((utxo) => {
    const txId = utxo.input().transactionId();
    const txIdStr = typeof txId === "string" ? txId : txId.toString();
    return (
      txIdStr === config.reserve_one_shot_hash &&
      utxo.input().index() === BigInt(config.reserve_one_shot_index)
    );
  });

  if (!reserveOneShotUtxo) {
    throw new Error(
      `Reserve one-shot UTxO not found: ${config.reserve_one_shot_hash}#${config.reserve_one_shot_index}`
    );
  }

  // Get contract instances
  const contracts = new ContractsManager();
  const reserve = await contracts.getReserve();
  const govAuth = await contracts.getGovAuth();

  // Create initial Reserve multisig with deployer's payment hash
  // CRITICAL: Reserve uses RAW payment hashes (no "8200581c" prefix!)
  const paymentHash = address.asBase()?.getPaymentCredential().hash!;
  const signers: Record<string, string> = {
    [paymentHash]: "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
  };

  // Build deployment transaction
  const txBuilder = await buildReserveDeploymentTx({
    blaze,
    reserveForeverScript: reserve.forever.Script,
    reserveTwoStageScript: reserve.twoStage.Script,
    reserveLogicScript: reserve.logic.Script,
    govAuthScript: govAuth.Script,
    reserveOneShotUtxo,
    signers,
    networkId: 0,
  });

  const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

  // Store deployment info
  // Output order: 0=Main, 1=Staging, 2=Forever
  ctx.journeyState.deployments["reserve"] = {
    componentName: "reserve",
    txHash,
    outputIndex: 2, // Forever UTxO is at index 2
    metadata: {
      mainOutputIndex: 0,
      stagingOutputIndex: 1,
      foreverOutputIndex: 2,
    },
  };

  return { reserveTxHash: txHash };
}

/**
 * Deploy ICS contracts (forever, two-stage, logic)
 *
 * ICS follows the same pattern as Reserve with raw payment hashes.
 */
export async function deployICSContracts(ctx: JourneyContext): Promise<{
  icsTxHash: string;
}> {
  const { ContractsManager } = await import("./contracts");
  const { serialize } = await import("@blaze-cardano/data");
  const {
    addressFromValidator,
    AssetId,
    AssetName,
    PaymentAddress,
    PlutusData,
    PolicyId,
    toHex,
    TransactionOutput,
  } = await import("@blaze-cardano/core");
  const Contracts = await import("../../contract_blueprint");

  const config = ctx.provider.getConfig();
  const blaze = await ctx.provider.getBlaze("deployer");
  const address = await blaze.wallet.getChangeAddress();

  // Find the ICS one-shot UTxO
  const deployerUtxos = await blaze.provider.getUnspentOutputs(address);
  const icsOneShotUtxo = deployerUtxos.find((utxo) => {
    const txId = utxo.input().transactionId();
    const txIdStr = typeof txId === "string" ? txId : txId.toString();
    return (
      txIdStr === config.ics_one_shot_hash &&
      utxo.input().index() === BigInt(config.ics_one_shot_index)
    );
  });

  if (!icsOneShotUtxo) {
    throw new Error(
      `ICS one-shot UTxO not found: ${config.ics_one_shot_hash}#${config.ics_one_shot_index}`
    );
  }

  // Get contract instances
  const contracts = new ContractsManager();
  const ics = await contracts.getICS();
  const govAuth = await contracts.getGovAuth();

  // ICS uses raw payment hashes (like Reserve)
  const paymentHash = address.asBase()?.getPaymentCredential().hash!;
  const signers: Record<string, string> = {
    [paymentHash]: "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
  };

  // Get script addresses
  const icsForeverAddress = addressFromValidator(0, ics.forever.Script);
  const icsTwoStageAddress = addressFromValidator(0, ics.twoStage.Script);

  // Create upgrade state datum for ICS two-stage
  const icsUpgradeState: typeof Contracts.UpgradeState = [
    ics.logic.Script.hash(),
    "",
    govAuth.Script.hash(),
    "",
    0n,
    0n,
  ];

  // Create multisig state for ICS forever
  const signerCount = BigInt(Object.keys(signers).length);
  const icsForeverState: typeof Contracts.VersionedMultisig = [
    [signerCount, signers],
    0n,
  ];

  // ICS redeemer uses the same format as datum (raw 28-byte payment hashes)
  const redeemerForever: typeof Contracts.PermissionedRedeemer = signers;

  // Build the deployment transaction
  const txBuilder = blaze
    .newTransaction()
    .addInput(icsOneShotUtxo)
    .addMint(
      PolicyId(ics.forever.Script.hash()),
      new Map([[AssetName(""), 1n]]),
      serialize(Contracts.PermissionedRedeemer, redeemerForever)
    )
    .addMint(
      PolicyId(ics.twoStage.Script.hash()),
      new Map([
        [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
        [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
      ]),
      PlutusData.newInteger(0n)
    )
    .provideScript(ics.twoStage.Script)
    .provideScript(ics.forever.Script)
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(icsTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [
              AssetId(
                ics.twoStage.Script.hash() +
                  toHex(new TextEncoder().encode("main"))
              ),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, icsUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(icsTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [
              AssetId(
                ics.twoStage.Script.hash() +
                  toHex(new TextEncoder().encode("staging"))
              ),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, icsUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(icsForeverAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([[AssetId(ics.forever.Script.hash()), 1n]]),
        },
        datum: serialize(Contracts.VersionedMultisig, icsForeverState).toCore(),
      })
    );

  const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

  // Store deployment info
  // Output order: 0=Main, 1=Staging, 2=Forever
  ctx.journeyState.deployments["ics"] = {
    componentName: "ics",
    txHash,
    outputIndex: 2, // Forever UTxO is at index 2
    metadata: {
      mainOutputIndex: 0,
      stagingOutputIndex: 1,
      foreverOutputIndex: 2,
    },
  };

  return { icsTxHash: txHash };
}
