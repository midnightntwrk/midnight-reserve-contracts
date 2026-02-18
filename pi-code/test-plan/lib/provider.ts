import { Emulator } from "@blaze-cardano/emulator";
import { Blaze, HotWallet, ColdWallet, Core } from "@blaze-cardano/sdk";
import {
  TransactionUnspentOutput,
  TransactionId,
  PaymentAddress,
  Address,
  SLOT_CONFIG_NETWORK,
  hardCodedProtocolParams,
  Ed25519KeyHashHex,
} from "@blaze-cardano/core";
import { makeUplcEvaluator } from "@blaze-cardano/vm";
import type { TestMode, WalletConfig, Settings, AdditionalWallet } from "./types";
import { AnswersManager } from "./answers-manager";

import type { TxBuilder } from "@blaze-cardano/sdk";

export interface NetworkConfig {
  technical_authority_one_shot_hash: string;
  technical_authority_one_shot_index: number;
  council_one_shot_hash: string;
  council_one_shot_index: number;
  reserve_one_shot_hash: string;
  reserve_one_shot_index: number;
  ics_one_shot_hash: string;
  ics_one_shot_index: number;
  federated_operators_one_shot_hash: string;
  federated_operators_one_shot_index: number;
  main_gov_one_shot_hash: string;
  main_gov_one_shot_index: number;
  staging_gov_one_shot_hash: string;
  staging_gov_one_shot_index: number;
  main_council_update_one_shot_hash: string;
  main_council_update_one_shot_index: number;
  main_tech_auth_update_one_shot_hash: string;
  main_tech_auth_update_one_shot_index: number;
  main_federated_ops_update_one_shot_hash: string;
  main_federated_ops_update_one_shot_index: number;
  terms_and_conditions_one_shot_hash: string;
  terms_and_conditions_one_shot_index: number;
  terms_and_conditions_threshold_one_shot_hash: string;
  terms_and_conditions_threshold_one_shot_index: number;
  cnight_minting_one_shot_hash: string;
  cnight_minting_one_shot_index: number;
  cnight_policy: string;
}

/**
 * A registered signer maps a logical name (e.g. "council-auth-0") to a
 * specific credential of a specific wallet.  This lets journey code use
 * clean identifiers in `suggestedSigners` and lets the provider figure
 * out which VKey witnesses to attach.
 *
 * - walletId: which wallet owns this key (e.g. "deployer", "council-member-1")
 * - credential: which credential of that wallet ("payment" or "stake")
 * - keyHash: optional pre-resolved key hash (for external wallets where we
 *   can't derive it from a seed phrase)
 */
export interface SignerRegistration {
  walletId: string;
  credential: "payment" | "stake";
  keyHash?: string;
}

export interface TestProvider {
  getBlaze(walletId: string): Promise<Blaze>;
  setup(): Promise<void>;
  cleanup(): Promise<void>;
  reset(): Promise<void>; // Reset emulator state between journeys
  submitTransaction(walletId: string, txBuilder: TxBuilder, options?: { suggestedSigners?: string[]; forceControlledSigning?: boolean }): Promise<string>;
  getConfig(): NetworkConfig;

  /** Register a named signer that maps to a wallet credential. */
  registerSigner(id: string, walletId: string, credential: "payment" | "stake"): void;

  /**
   * Get the key hash for a registered signer (or return undefined).
   * Useful for building signer lists that include real wallet keys.
   */
  getSignerKeyHash(signerId: string): Promise<string | undefined>;

  /**
   * Get additional wallets available for this provider.
   * For emulator, returns built-in test wallets.
   * For testnet, returns wallets from settings.
   */
  getAdditionalWalletIds(): string[];
}

// Helper to synchronously load cnight_policy from aiken.toml
function loadCnightPolicyFromAikenToml(): string {
  const fs = require("fs");
  const path = require("path");
  const toml = require("toml");

  const aikenTomlPath = path.resolve(process.cwd(), "../aiken.toml");
  const tomlContent = fs.readFileSync(aikenTomlPath, "utf-8");
  const parsed = toml.parse(tomlContent);

  return parsed.config?.default?.cnight_policy?.bytes || "";
}

export class EmulatorProvider implements TestProvider {
  private emulator: Emulator;
  private blazeCache: Map<string, Blaze>;
  private config: NetworkConfig;
  private signerRegistry: Map<string, SignerRegistration> = new Map();
  private contractsRebuilt: boolean = false;

  constructor() {
    // Use custom protocol parameters to allow larger transactions (for traces)
    const customParams = {
      ...hardCodedProtocolParams,
      maxTxSize: 50000, // Increase from 16384 to 50000 bytes
    };

    this.emulator = new Emulator([], customParams);
    this.emulator.enableTracing(true); // Enable traces
    this.blazeCache = new Map();

    // Load cnight_policy from aiken.toml to ensure consistency with compiled contracts
    const cnightPolicy = loadCnightPolicyFromAikenToml();

    // Emulator uses hardcoded config that matches the UTxOs created in setup()
    this.config = {
      reserve_one_shot_hash: "0".repeat(63) + "1",
      reserve_one_shot_index: 1,
      council_one_shot_hash: "0".repeat(63) + "2",
      council_one_shot_index: 1,
      ics_one_shot_hash: "0".repeat(63) + "3",
      ics_one_shot_index: 1,
      technical_authority_one_shot_hash: "0".repeat(63) + "4",
      technical_authority_one_shot_index: 1,
      federated_operators_one_shot_hash: "0".repeat(63) + "5",
      federated_operators_one_shot_index: 1,
      main_gov_one_shot_hash: "0".repeat(63) + "6",
      main_gov_one_shot_index: 1,
      staging_gov_one_shot_hash: "0".repeat(63) + "7",
      staging_gov_one_shot_index: 1,
      main_council_update_one_shot_hash: "0".repeat(63) + "8",
      main_council_update_one_shot_index: 1,
      main_tech_auth_update_one_shot_hash: "0".repeat(63) + "9",
      main_tech_auth_update_one_shot_index: 1,
      main_federated_ops_update_one_shot_hash: "0".repeat(63) + "a",
      main_federated_ops_update_one_shot_index: 1,
      terms_and_conditions_one_shot_hash: "0".repeat(63) + "d",
      terms_and_conditions_one_shot_index: 1,
      terms_and_conditions_threshold_one_shot_hash: "0".repeat(62) + "0e",
      terms_and_conditions_threshold_one_shot_index: 1,
      cnight_minting_one_shot_hash: "0".repeat(62) + "10",
      cnight_minting_one_shot_index: 1,
      cnight_policy: cnightPolicy,
    };
  }

  getConfig(): NetworkConfig {
    return this.config;
  }

  async setup(): Promise<void> {
    // Ensure contracts are compiled with "default" config for emulator
    await this.ensureDefaultContracts();

    // Setup deployer wallet with funds
    await this.emulator.as("deployer", async (_, addr) => {
      const addressBech32 = addr.toBech32();

      // Add main wallet UTxO with plenty of ADA for building transactions
      this.emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId("0".repeat(64)),
          },
          {
            address: PaymentAddress(addressBech32),
            value: {
              coins: 1000_000_000n,
            },
          },
        ])
      );

      // Add cNIGHT tokens UTxO for reserve merge testing
      // The cnight_policy is loaded from aiken.toml in the constructor
      const cnightAssetName = "4e49474854"; // "NIGHT" in hex
      this.emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId("f".repeat(64)), // Unique txId for cNIGHT UTxO
          },
          {
            address: PaymentAddress(addressBech32),
            value: {
              coins: 10_000_000n, // 10 ADA
              assets: new Map([
                [this.config.cnight_policy + cnightAssetName, 1_000_000n], // 1M cNIGHT tokens
              ]),
            },
          },
        ])
      );

      // Add one-shot UTxOs for deployment
      // These have specific txIds/indices that are referenced in the config
      const oneShotConfigs = [
        { hash: "0".repeat(63) + "1", index: 1 }, // reserve
        { hash: "0".repeat(63) + "2", index: 1 }, // council
        { hash: "0".repeat(63) + "3", index: 1 }, // ics
        { hash: "0".repeat(63) + "4", index: 1 }, // technical_authority
        { hash: "0".repeat(63) + "5", index: 1 }, // federated_operators
        { hash: "0".repeat(63) + "6", index: 1 }, // main_gov
        { hash: "0".repeat(63) + "7", index: 1 }, // staging_gov
        { hash: "0".repeat(63) + "8", index: 1 }, // main_council_update
        { hash: "0".repeat(63) + "9", index: 1 }, // main_tech_auth_update
        { hash: "0".repeat(63) + "a", index: 1 }, // main_federated_ops_update
        { hash: "0".repeat(63) + "d", index: 1 }, // terms_and_conditions
        { hash: "0".repeat(62) + "0e", index: 1 }, // terms_and_conditions_threshold
        { hash: "0".repeat(62) + "10", index: 1 }, // cnight_minting
      ];

      for (const config of oneShotConfigs) {
        this.emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: config.index,
              txId: TransactionId(config.hash),
            },
            {
              address: PaymentAddress(addressBech32),
              value: {
                coins: 10_000_000n,
              },
            },
          ])
        );
      }
    });

    // Setup additional council member wallets for 3-of-5 multisig testing
    // These wallets will be used as council members alongside deployer
    const additionalWalletConfigs = [
      { id: "council-member-1", txIdSuffix: "c1" },
      { id: "council-member-2", txIdSuffix: "c2" },
      { id: "council-member-3", txIdSuffix: "c3" },
    ];
    for (const { id: walletId, txIdSuffix } of additionalWalletConfigs) {
      await this.emulator.as(walletId, async (_, addr) => {
        const addressBech32 = addr.toBech32();
        // Add funds for each council member (use valid hex txId)
        this.emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId("0".repeat(62) + txIdSuffix),
            },
            {
              address: PaymentAddress(addressBech32),
              value: {
                coins: 100_000_000n, // 100 ADA
              },
            },
          ])
        );
      });
    }
  }

  async cleanup(): Promise<void> {
    this.blazeCache.clear();
  }

  getAdditionalWalletIds(): string[] {
    // Return the IDs of additional wallets set up in the emulator
    return ["council-member-1", "council-member-2", "council-member-3"];
  }

  /**
   * Ensure contracts are compiled with "default" config for emulator mode.
   * This is needed because testnet runs may have compiled with a different config.
   */
  private async ensureDefaultContracts(): Promise<void> {
    if (this.contractsRebuilt) {
      return; // Already rebuilt for this session
    }

    const { existsSync, copyFileSync } = await import("fs");
    const { resolve } = await import("path");
    const projectRoot = resolve(process.cwd(), "..");

    // Check if contract_blueprint.ts matches the default config
    // by comparing with contract_blueprint_default.ts
    const defaultBlueprint = resolve(projectRoot, "contract_blueprint_default.ts");
    const activeBlueprint = resolve(projectRoot, "contract_blueprint.ts");

    if (existsSync(defaultBlueprint)) {
      // Copy the default blueprint to be the active one
      copyFileSync(defaultBlueprint, activeBlueprint);
      console.log("\n✓ Activated default contract blueprint for emulator mode\n");
    } else {
      // Need to rebuild with default config
      console.log("\n=== Rebuilding contracts with default config for emulator ===\n");
      const { rebuildContracts } = await import("./config-builder");
      await rebuildContracts("default");
      console.log("\n✓ Contracts rebuilt with default config\n");
    }

    this.contractsRebuilt = true;
  }

  async reset(): Promise<void> {
    // Recreate emulator with fresh state
    const customParams = {
      ...hardCodedProtocolParams,
      maxTxSize: 50000,
    };
    this.emulator = new Emulator([], customParams);
    this.emulator.enableTracing(true);
    this.blazeCache.clear();

    // Re-run setup to add initial UTxOs
    await this.setup();
  }

  async getBlaze(walletId: string): Promise<Blaze> {
    if (this.blazeCache.has(walletId)) {
      return this.blazeCache.get(walletId)!;
    }

    let blaze: Blaze | undefined;
    await this.emulator.as(walletId, async (b) => {
      blaze = b;
    });

    if (!blaze) {
      throw new Error(`Failed to get Blaze instance for ${walletId}`);
    }

    this.blazeCache.set(walletId, blaze);
    return blaze;
  }

  registerSigner(id: string, walletId: string, credential: "payment" | "stake"): void {
    this.signerRegistry.set(id, { walletId, credential });
  }

  async getSignerKeyHash(signerId: string): Promise<string | undefined> {
    const reg = this.signerRegistry.get(signerId);
    if (!reg) return undefined;

    // In the emulator, resolve from the wallet address
    let signerAddress: any;
    await this.emulator.as(reg.walletId, async (_, addr) => {
      signerAddress = addr;
    });
    if (!signerAddress) return undefined;

    const base = signerAddress.asBase();
    if (!base) return undefined;
    return reg.credential === "payment"
      ? base.getPaymentCredential().hash
      : base.getStakeCredential()?.hash;
  }

  async submitTransaction(
    walletId: string,
    txBuilder: TxBuilder,
    options?: { suggestedSigners?: string[]; forceControlledSigning?: boolean }
  ): Promise<string> {
    const blaze = await this.getBlaze(walletId);

    // Only use controlled signing when explicitly requested via forceControlledSigning.
    // This is used for negative tests where we intentionally omit certain signatures.
    // For positive tests, use expectValidTransaction which auto-signs correctly.
    if (options?.forceControlledSigning && options.suggestedSigners && options.suggestedSigners.length > 0) {
      return this.submitWithControlledSigning(walletId, txBuilder, options.suggestedSigners);
    }

    // Default: use the emulator's built-in signing and validation
    await this.emulator.expectValidTransaction(blaze, txBuilder);
    const tx = await txBuilder.complete();
    return tx.getId();
  }

  /**
   * Submit a transaction with controlled signing - only signs with specified credentials.
   * This enables negative tests where we intentionally omit certain signatures.
   */
  private async submitWithControlledSigning(
    walletId: string,
    txBuilder: TxBuilder,
    suggestedSigners: string[]
  ): Promise<string> {
    const { CborSet, VkeyWitness } = await import("@blaze-cardano/core");

    // Map signer IDs to their wallet/credential info
    interface SignerInfo {
      walletId: string;
      credential: "payment" | "stake";
    }
    const signersToApply: SignerInfo[] = [];
    for (const signerId of suggestedSigners) {
      const reg = this.signerRegistry.get(signerId);
      if (reg) {
        signersToApply.push({ walletId: reg.walletId, credential: reg.credential });
      } else {
        console.warn(`  ⚠ Unknown signer '${signerId}' in suggestedSigners`);
      }
    }

    // Group by wallet and determine if stake key signing is needed
    // Only include stake key if a "stake" credential is explicitly in the list
    const walletSigningMode = new Map<string, boolean>(); // walletId -> needsStakeKey
    for (const signer of signersToApply) {
      if (signer.credential === "stake") {
        walletSigningMode.set(signer.walletId, true);
      } else if (!walletSigningMode.has(signer.walletId)) {
        walletSigningMode.set(signer.walletId, false); // payment only
      }
    }

    console.log(`  [DEBUG] Controlled signing:`);
    for (const [wId, needsStake] of walletSigningMode) {
      console.log(`    Wallet '${wId}': needsStakeKey=${needsStake}`);
    }

    // Complete the transaction with the emulator's evaluator
    const params = this.emulator.params;
    const slotConfig = SLOT_CONFIG_NETWORK.Preprod;

    const tx = await txBuilder
      .useEvaluator(makeUplcEvaluator(params, 1.2, 1.2, slotConfig))
      .complete();

    // Sign with each wallet using the specified credential mode
    for (const [wId, needsStakeKey] of walletSigningMode) {
      await this.emulator.as(wId, async (walletBlaze, _) => {
        const wallet = walletBlaze.wallet as any;
        if (typeof wallet.signTransaction === "function") {
          // Sign with controlled stake key usage
          // signWithStakeKey=false means ONLY payment key signs
          const witnessSet = await wallet.signTransaction(tx, true, needsStakeKey);

          // Merge the new witnesses into the transaction
          const existingVkeys = tx.witnessSet().vkeys()?.toCore() ?? [];
          const newVkeys = witnessSet.vkeys();
          if (newVkeys) {
            const merged = CborSet.fromCore(
              [...newVkeys.toCore(), ...existingVkeys],
              VkeyWitness.fromCore
            );
            const ws = tx.witnessSet();
            ws.setVkeys(merged);
            tx.setWitnessSet(ws);
          }
        }
      });
    }

    // Debug: Print what VKey witnesses are in the transaction
    const vkeys = tx.witnessSet().vkeys();
    if (vkeys) {
      console.log(`  [DEBUG] Transaction has ${vkeys.size()} VKey witnesses`);
    } else {
      console.log(`  [DEBUG] Transaction has NO VKey witnesses`);
    }

    // IMPORTANT: The emulator doesn't validate native script signature requirements.
    // We need to manually validate them before submission for negative tests to work.
    await this.validateNativeScripts(tx);

    // Submit the signed transaction
    const txId = await this.emulator.submitTransaction(tx);
    return txId;
  }

  /**
   * Validate that native scripts in the transaction have their signature requirements satisfied.
   * The emulator doesn't validate native script signature requirements, so we do it here.
   * This is critical for negative tests that intentionally omit required signatures.
   */
  private async validateNativeScripts(tx: any): Promise<void> {
    const { Hash28ByteBase16 } = await import("@blaze-cardano/core");

    const witnessSet = tx.witnessSet();
    const nativeScripts = witnessSet.nativeScripts();

    if (!nativeScripts || nativeScripts.size() === 0) {
      return; // No native scripts to validate
    }

    // Collect VKey hashes that signed the transaction
    const vkeyHashes = new Set<string>();
    const vkeys = witnessSet.vkeys();
    if (vkeys) {
      for (const vkey of vkeys.values()) {
        // Get the public key and hash it
        const pubKeyHex = vkey.vkey();
        const { Ed25519PublicKey } = await import("@blaze-cardano/core");
        const pubKey = Ed25519PublicKey.fromHex(pubKeyHex);
        const keyHash = await pubKey.hash();
        vkeyHashes.add(keyHash.hex());
      }
    }

    console.log(`  [DEBUG] VKey hashes that signed: ${Array.from(vkeyHashes).join(", ") || "(none)"}`);

    // Validate each native script
    for (const script of nativeScripts.values()) {
      const scriptHash = script.hash();
      const isValid = this.validateNativeScript(script, vkeyHashes);

      if (!isValid) {
        console.log(`  [DEBUG] Native script ${scriptHash} validation FAILED`);
        throw new Error(
          `Native script validation failed: script ${scriptHash} requirements not satisfied. ` +
          `This transaction requires signatures that are not present in the witness set.`
        );
      }
      console.log(`  [DEBUG] Native script ${scriptHash} validation PASSED`);
    }
  }

  /**
   * Recursively validate a native script against available VKey signatures.
   * Returns true if the script's requirements are satisfied.
   */
  private validateNativeScript(script: any, vkeyHashes: Set<string>): boolean {
    // Native script types:
    // 0 = RequireSignature (sig)
    // 1 = RequireAllOf (all)
    // 2 = RequireAnyOf (any)
    // 3 = RequireNOf (n_of_k)
    // 4 = InvalidBefore (after)
    // 5 = InvalidAfter (before)

    const kind = script.kind();

    switch (kind) {
      case 0: { // RequireSignature
        const keyHash = script.asSignature()?.hex();
        if (!keyHash) return false;
        const hasSignature = vkeyHashes.has(keyHash);
        console.log(`    [DEBUG] RequireSignature(${keyHash}): ${hasSignature ? "SATISFIED" : "MISSING"}`);
        return hasSignature;
      }

      case 1: { // RequireAllOf
        const scripts = script.asAllOf()?.values() ?? [];
        for (const subScript of scripts) {
          if (!this.validateNativeScript(subScript, vkeyHashes)) {
            return false;
          }
        }
        return true;
      }

      case 2: { // RequireAnyOf
        const scripts = script.asAnyOf()?.values() ?? [];
        for (const subScript of scripts) {
          if (this.validateNativeScript(subScript, vkeyHashes)) {
            return true;
          }
        }
        return scripts.length === 0; // Empty AnyOf is trivially satisfied
      }

      case 3: { // RequireNOf (N-of-M multisig)
        const nOf = script.asNOf();
        if (!nOf) return false;
        const required = nOf.required();
        const scripts = nOf.scripts()?.values() ?? [];

        let satisfied = 0;
        for (const subScript of scripts) {
          if (this.validateNativeScript(subScript, vkeyHashes)) {
            satisfied++;
          }
        }

        console.log(`    [DEBUG] RequireNOf(${required} of ${scripts.length}): ${satisfied} satisfied`);
        return satisfied >= required;
      }

      case 4: // InvalidBefore (time-based, assume satisfied for now)
      case 5: // InvalidAfter (time-based, assume satisfied for now)
        return true;

      default:
        console.warn(`    [DEBUG] Unknown native script kind: ${kind}`);
        return false;
    }
  }
}

export class NetworkProvider implements TestProvider {
  private blazeInstance?: Blaze;
  private provider?: any;
  private wallet?: HotWallet | ColdWallet;
  private walletConfig?: WalletConfig;
  private apiKey?: string;
  private testRunId?: string;
  private contractsRebuilt: boolean = false;
  private config?: NetworkConfig;
  private settings?: Settings;
  private answersManager?: AnswersManager;
  private txSubmissionCount: number = 0;
  private resume: boolean;
  private signerRegistry: Map<string, SignerRegistration> = new Map();
  /** Additional wallets (seed-based become HotWallets, external are sign-by-prompt) */
  private additionalWallets: Map<string, AdditionalWallet> = new Map();
  private additionalHotWallets: Map<string, HotWallet> = new Map();

  constructor(
    private network: "preview" | "preprod" | "mainnet",
    walletConfig?: WalletConfig,
    apiKey?: string,
    testRunId?: string,
    settings?: Settings,
    resume: boolean = false,
  ) {
    this.walletConfig = walletConfig;
    this.apiKey = apiKey;
    this.testRunId = testRunId;
    this.settings = settings;
    this.resume = resume;

    // Load additional wallets from settings
    if (settings?.additionalWallets) {
      for (const [id, wallet] of Object.entries(settings.additionalWallets)) {
        this.additionalWallets.set(id, wallet);
      }
    }

    // Initialize answers manager if needed
    if (settings?.answersFile || settings?.recordAnswers) {
      this.answersManager = new AnswersManager(
        settings.answersFile,
        settings.recordAnswers
      );
    }
  }

  getConfig(): NetworkConfig {
    if (!this.config) {
      throw new Error("Config not loaded. Call setup() first.");
    }
    return this.config;
  }

  async setup(): Promise<void> {
    if (!this.apiKey) {
      throw new Error(`Blockfrost API key required for ${this.network} network`);
    }

    const { Blockfrost } = await import("@blaze-cardano/query");

    const networkNameMap: Record<string, string> = {
      preview: "cardano-preview",
      preprod: "cardano-preprod",
      mainnet: "cardano-mainnet",
    };

    this.provider = new Blockfrost({
      network: networkNameMap[this.network],
      projectId: this.apiKey,
    });

    // If testRunId is provided and we're on preview/preprod, rebuild contracts
    // (unless resuming a previous run — contracts are already built)
    if (this.testRunId && (this.network === "preview" || this.network === "preprod")) {
      if (this.resume) {
        await this.activateExistingBlueprint();
      } else {
        await this.rebuildContractsForTestRun();
      }
    }

    // Load config from aiken.toml (after rebuild if applicable,
    // so the test-run-specific config section exists)
    await this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const toml = await import("toml");

    const aikenTomlPath = resolve(process.cwd(), "../aiken.toml");
    const tomlContent = readFileSync(aikenTomlPath, "utf-8");
    const parsed = toml.parse(tomlContent);

    // Determine config section name
    let configSection: string;
    if (this.testRunId) {
      configSection = `preview_test_${this.testRunId}`;
    } else if (this.network === "preview") {
      configSection = "preview";
    } else if (this.network === "preprod") {
      configSection = "preprod";
    } else {
      configSection = "mainnet";
    }

    const config = parsed.config?.[configSection];
    if (!config) {
      throw new Error(`Config section '${configSection}' not found in aiken.toml`);
    }

    // Extract one-shot configs from the parsed TOML
    this.config = {
      technical_authority_one_shot_hash: config.technical_authority_one_shot_hash?.bytes || "",
      technical_authority_one_shot_index: Number(config.technical_authority_one_shot_index || 0),
      council_one_shot_hash: config.council_one_shot_hash?.bytes || "",
      council_one_shot_index: Number(config.council_one_shot_index || 0),
      reserve_one_shot_hash: config.reserve_one_shot_hash?.bytes || "",
      reserve_one_shot_index: Number(config.reserve_one_shot_index || 0),
      ics_one_shot_hash: config.ics_one_shot_hash?.bytes || "",
      ics_one_shot_index: Number(config.ics_one_shot_index || 0),
      federated_operators_one_shot_hash: config.federated_operators_one_shot_hash?.bytes || "",
      federated_operators_one_shot_index: Number(config.federated_operators_one_shot_index || 0),
      main_gov_one_shot_hash: config.main_gov_one_shot_hash?.bytes || "",
      main_gov_one_shot_index: Number(config.main_gov_one_shot_index || 0),
      staging_gov_one_shot_hash: config.staging_gov_one_shot_hash?.bytes || "",
      staging_gov_one_shot_index: Number(config.staging_gov_one_shot_index || 0),
      main_council_update_one_shot_hash: config.main_council_update_one_shot_hash?.bytes || "",
      main_council_update_one_shot_index: Number(config.main_council_update_one_shot_index || 0),
      main_tech_auth_update_one_shot_hash: config.main_tech_auth_update_one_shot_hash?.bytes || "",
      main_tech_auth_update_one_shot_index: Number(config.main_tech_auth_update_one_shot_index || 0),
      main_federated_ops_update_one_shot_hash: config.main_federated_ops_update_one_shot_hash?.bytes || "",
      main_federated_ops_update_one_shot_index: Number(config.main_federated_ops_update_one_shot_index || 0),
      terms_and_conditions_one_shot_hash: config.terms_and_conditions_one_shot_hash?.bytes || "",
      terms_and_conditions_one_shot_index: Number(config.terms_and_conditions_one_shot_index || 0),
      terms_and_conditions_threshold_one_shot_hash: config.terms_and_conditions_threshold_one_shot_hash?.bytes || "",
      terms_and_conditions_threshold_one_shot_index: Number(config.terms_and_conditions_threshold_one_shot_index || 0),
      cnight_minting_one_shot_hash: config.cnight_minting_one_shot_hash?.bytes || "",
      cnight_minting_one_shot_index: Number(config.cnight_minting_one_shot_index || 0),
      cnight_policy: config.cnight_policy?.bytes || "",
    };
  }

  private async rebuildContractsForTestRun(): Promise<void> {
    if (this.contractsRebuilt) {
      return; // Already rebuilt for this test run
    }

    const { configureOneShotUtxos, rebuildContracts } = await import("./config-builder");

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║  Test Run Contract Preparation                            ║");
    console.log("╚════════════════════════════════════════════════════════════╝");

    // Get a Blaze instance to query wallet UTxOs
    const blaze = await this.getBlaze("deployer");

    // Step 1: Configure one-shot UTxOs
    await configureOneShotUtxos(blaze, this.network, this.testRunId);

    // Step 2: Rebuild contracts (includes blueprint regeneration via 'just build')
    await rebuildContracts(this.network, this.testRunId);

    console.log("\n✓ Test run contracts prepared successfully");
    console.log("  Contracts have been rebuilt with selected UTxOs.\n");

    this.contractsRebuilt = true;
  }

  /**
   * For resume: activate the blueprint from a previous build without rebuilding.
   * Copies the existing contract_blueprint_<configName>.ts to contract_blueprint.ts.
   */
  private async activateExistingBlueprint(): Promise<void> {
    const { existsSync, copyFileSync } = await import("fs");
    const { resolve } = await import("path");

    const configName = `${this.network}_test_${this.testRunId}`;
    const projectRoot = resolve(process.cwd(), "..");
    const blueprintSrc = resolve(projectRoot, `contract_blueprint_${configName}.ts`);
    const blueprintDest = resolve(projectRoot, "contract_blueprint.ts");

    if (!existsSync(blueprintSrc)) {
      throw new Error(
        `Cannot resume: blueprint file not found: contract_blueprint_${configName}.ts\n` +
        `The previous build artifacts may have been cleaned up.`
      );
    }

    copyFileSync(blueprintSrc, blueprintDest);
    console.log(`\n✓ Resumed with existing blueprint for ${configName}\n`);
  }

  async cleanup(): Promise<void> {
    // Save recorded answers if recording was enabled
    if (this.answersManager) {
      this.answersManager.save();
    }
  }

  async reset(): Promise<void> {
    // On testnet, each journey consumes its one-shot UTxOs.
    // To run the next journey, we need to select new one-shots and rebuild contracts.
    if (this.testRunId && (this.network === "preview" || this.network === "preprod")) {
      console.log("\n🔄 Resetting for next journey: selecting new one-shot UTxOs and rebuilding contracts...\n");
      this.contractsRebuilt = false;
      await this.rebuildContractsForTestRun();
      await this.loadConfig();
    }
  }

  private async awaitTxConfirmation(
    blaze: Blaze,
    txHash: string,
    maxAttempts: number = 40,
    delayMs: number = 5000
  ): Promise<boolean> {
    const { TransactionInput } = await import("@blaze-cardano/core");

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const utxos = await blaze.provider.resolveUnspentOutputs([
          new TransactionInput(txHash, 0n),
        ]);
        if (utxos.length > 0) {
          return true;
        }
      } catch {
        // UTxO not yet available, continue waiting
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return false;
  }

  async getBlaze(walletId: string): Promise<Blaze> {
    if (this.blazeInstance) {
      return this.blazeInstance;
    }

    if (!this.provider) {
      throw new Error("Provider not initialized. Call setup() first.");
    }

    if (!this.walletConfig) {
      throw new Error("Wallet configuration required");
    }

    const networkId = this.network === "mainnet" ? 1 : 0;

    if (this.walletConfig.type === "seed") {
      // HotWallet - can sign transactions
      // Convert mnemonic to entropy, then to master key
      const entropy = Core.mnemonicToEntropy(
        this.walletConfig.seedPhrase,
        Core.wordlist,
      );
      const privateKey = Core.Bip32PrivateKey.fromBip39Entropy(
        Buffer.from(entropy),
        "",
      );
      this.wallet = await HotWallet.fromMasterkey(
        privateKey.hex(),
        this.provider,
        networkId,
      );
    } else {
      // ColdWallet - can only query, not sign
      const address = Address.fromBech32(this.walletConfig.address);
      this.wallet = new ColdWallet(address, networkId, this.provider);
    }

    this.blazeInstance = await Blaze.from(this.provider, this.wallet);
    return this.blazeInstance;
  }

  registerSigner(id: string, walletId: string, credential: "payment" | "stake"): void {
    this.signerRegistry.set(id, { walletId, credential });
  }

  async getSignerKeyHash(signerId: string): Promise<string | undefined> {
    const reg = this.signerRegistry.get(signerId);
    if (!reg) {
      console.log(`  [getSignerKeyHash] '${signerId}' not in registry (${this.signerRegistry.size} entries: ${Array.from(this.signerRegistry.keys()).join(", ")})`);
      return undefined;
    }
    try {
      const hash = await this.resolveSignerKeyHash(reg);
      if (!hash) {
        console.log(`  [getSignerKeyHash] '${signerId}' → resolved to undefined (walletId=${reg.walletId}, cred=${reg.credential})`);
      }
      return hash;
    } catch (e) {
      console.error(`  [getSignerKeyHash] '${signerId}' → error resolving: ${e}`);
      return undefined;
    }
  }

  getAdditionalWalletIds(): string[] {
    // Return IDs from settings' additionalWallets
    return Array.from(this.additionalWallets.keys());
  }

  /**
   * Get or create a HotWallet for an additional wallet by ID.
   * Returns undefined if the wallet is external (no seed phrase).
   */
  private async getAdditionalHotWallet(walletId: string): Promise<HotWallet | undefined> {
    if (this.additionalHotWallets.has(walletId)) {
      return this.additionalHotWallets.get(walletId)!;
    }

    const walletDef = this.additionalWallets.get(walletId);
    if (!walletDef || walletDef.type !== "seed") {
      return undefined;
    }

    if (!this.provider) {
      throw new Error("Provider not initialized. Call setup() first.");
    }

    const networkId = this.network === "mainnet" ? 1 : 0;
    const entropy = Core.mnemonicToEntropy(walletDef.seedPhrase, Core.wordlist);
    const privateKey = Core.Bip32PrivateKey.fromBip39Entropy(Buffer.from(entropy), "");
    const hw = await HotWallet.fromMasterkey(privateKey.hex(), this.provider, networkId);

    this.additionalHotWallets.set(walletId, hw);
    return hw;
  }

  /**
   * Resolve a signer's key hash.
   * - "deployer" → use the primary wallet's payment/stake credential
   * - additional seed wallet → derive from its HotWallet address
   * - additional external wallet → use the configured paymentKeyHash
   */
  private async resolveSignerKeyHash(reg: SignerRegistration): Promise<string | undefined> {
    if (reg.walletId === "deployer") {
      const blaze = await this.getBlaze("deployer");
      const address = await blaze.wallet.getChangeAddress();
      const base = address.asBase();
      if (!base) return undefined;
      return reg.credential === "payment"
        ? base.getPaymentCredential().hash
        : base.getStakeCredential()?.hash;
    }

    // Additional seed wallet
    const hw = await this.getAdditionalHotWallet(reg.walletId);
    if (hw) {
      const address = await hw.getChangeAddress();
      const base = address.asBase();
      if (!base) return undefined;
      return reg.credential === "payment"
        ? base.getPaymentCredential().hash
        : base.getStakeCredential()?.hash;
    }

    // Additional external wallet — only has paymentKeyHash
    const walletDef = this.additionalWallets.get(reg.walletId);
    if (walletDef?.type === "external" && reg.credential === "payment") {
      return walletDef.paymentKeyHash;
    }

    return undefined;
  }

  /**
   * Print transaction CBOR for review before submission.
   */
  private printTxReview(tx: any): void {
    console.log("\n┌─────────────────────────────────────────────┐");
    console.log("│           Transaction CBOR                  │");
    console.log("└─────────────────────────────────────────────┘");
    console.log(tx.toCbor());
    console.log("");
  }

  /**
   * Sign a transaction with a specific wallet.
   * - "deployer" → primary HotWallet (with optional stake key)
   * - additional seed wallet → its HotWallet
   * - additional external wallet → prompt user for witness bytes
   */
  private async signWithWallet(
    tx: any,
    walletId: string,
    credential: "payment" | "stake",
  ): Promise<void> {
    const { CborSet, VkeyWitness } = await import("@blaze-cardano/core");

    const mergeVkeys = (ws: any) => {
      const existingVkeys = tx.witnessSet().vkeys()?.toCore() ?? [];
      const newVkeys = ws.vkeys();
      if (newVkeys) {
        const merged = CborSet.fromCore(
          [...newVkeys.toCore(), ...existingVkeys],
          VkeyWitness.fromCore,
        );
        const witnessSet = tx.witnessSet();
        witnessSet.setVkeys(merged);
        tx.setWitnessSet(witnessSet);
      }
    };

    if (walletId === "deployer") {
      if (!(this.wallet instanceof HotWallet)) {
        throw new Error("Deployer wallet is not a HotWallet — cannot sign");
      }
      const needsStake = credential === "stake";
      const ws = await this.wallet.signTransaction(tx, true, needsStake);
      mergeVkeys(ws);
      return;
    }

    // Additional seed wallet
    const hw = await this.getAdditionalHotWallet(walletId);
    if (hw) {
      const needsStake = credential === "stake";
      const ws = await hw.signTransaction(tx, true, needsStake);
      mergeVkeys(ws);
      return;
    }

    // External wallet — prompt user
    const walletDef = this.additionalWallets.get(walletId);
    if (walletDef?.type === "external") {
      const txHex = tx.toCbor();
      const { input } = await import("@inquirer/prompts");
      console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
      console.log(`║  External signature required                                ║`);
      console.log(`╚══════════════════════════════════════════════════════════════╝`);
      console.log(`  Wallet: ${walletId} (${credential} key)`);
      console.log(`  Key hash: ${walletDef.paymentKeyHash}`);
      console.log(`  Tx CBOR:\n${txHex}\n`);

      const witnessHex = await input({
        message: "Paste the VKey witness CBOR (hex):",
      });

      if (witnessHex.trim()) {
        const { HexBlob, VkeyWitness: VW } = await import("@blaze-cardano/core");
        const witness = VW.fromCbor(HexBlob(witnessHex.trim()));
        const existingVkeys = tx.witnessSet().vkeys()?.toCore() ?? [];
        const merged = CborSet.fromCore(
          [witness.toCore(), ...existingVkeys],
          VkeyWitness.fromCore,
        );
        const witnessSet = tx.witnessSet();
        witnessSet.setVkeys(merged);
        tx.setWitnessSet(witnessSet);
      }
      return;
    }

    throw new Error(`Unknown wallet '${walletId}' — not deployer, not in additionalWallets`);
  }

  async submitTransaction(
    walletId: string,
    txBuilder: TxBuilder,
    options?: { suggestedSigners?: string[] }
  ): Promise<string> {
    if (!this.walletConfig) {
      throw new Error("Wallet configuration required");
    }

    const blaze = await this.getBlaze(walletId);

    // Resolve suggested signers:
    // 1. Determine which wallets/credentials need to sign
    // 2. Add their key hashes as required signers (for fee estimation)
    // 3. After completing, collect signatures from each wallet
    interface ResolvedSigner { signerId: string; reg: SignerRegistration; keyHash: string }
    const resolvedSigners: ResolvedSigner[] = [];

    if (options?.suggestedSigners && options.suggestedSigners.length > 0) {
      const resolvedNames: string[] = [];
      for (const signerId of options.suggestedSigners) {
        const reg = this.signerRegistry.get(signerId);
        if (reg) {
          const keyHash = await this.resolveSignerKeyHash(reg);
          if (keyHash) {
            resolvedSigners.push({ signerId, reg, keyHash });
            resolvedNames.push(`${signerId} (${reg.credential} of ${reg.walletId})`);
            // Add as required signer so fee calculation accounts for VKey witness
            txBuilder.addRequiredSigner(Ed25519KeyHashHex(keyHash));
          } else {
            console.warn(`  ⚠ Could not resolve key hash for signer '${signerId}'`);
            resolvedNames.push(`${signerId} (unresolved)`);
          }
        } else {
          resolvedNames.push(signerId);
        }
      }
      console.log(`\n  Signers: ${resolvedNames.join(', ')}`);
    }

    // Use local UPLC evaluator instead of Blockfrost
    const params = await blaze.provider.getParameters();
    const slotConfig =
      blaze.provider.network === Core.NetworkId.Mainnet
        ? SLOT_CONFIG_NETWORK.Mainnet
        : SLOT_CONFIG_NETWORK.Preprod;

    console.log("\n[DEBUG] Using local UPLC evaluator for transaction evaluation");

    // Complete the transaction (builds it with proper fees, balancing, etc.)
    const tx = await txBuilder
      .useEvaluator(makeUplcEvaluator(params, 1.2, 1.2, slotConfig))
      .complete();

    if (this.walletConfig.type === "seed") {
      // Collect signatures from all required wallets.
      // De-duplicate by walletId — if multiple signers map to the same wallet,
      // we only need to sign once (with the most permissive credential).
      const walletsToSign = new Map<string, "payment" | "stake">();
      for (const { reg } of resolvedSigners) {
        const existing = walletsToSign.get(reg.walletId);
        // "stake" implies both payment+stake signing, so it's more permissive
        if (!existing || reg.credential === "stake") {
          walletsToSign.set(reg.walletId, reg.credential);
        }
      }

      // If no explicit signers, sign with the deployer (default behaviour)
      if (walletsToSign.size === 0) {
        walletsToSign.set("deployer", "payment");
      }

      // Sign with each wallet
      for (const [wId, cred] of walletsToSign) {
        await this.signWithWallet(tx, wId, cred);
      }
      const signedTx = tx;

      // --- Pre-submit transaction review ---
      this.printTxReview(signedTx);

      // Handle confirmation based on mode
      let shouldSubmit = true;
      this.txSubmissionCount++;
      const answerKey = `tx_confirmation_${this.txSubmissionCount}`;

      if (this.settings?.nonInteractive) {
        // Non-interactive mode: use pre-recorded answer or auto-confirm
        if (this.answersManager?.hasAnswer(answerKey)) {
          shouldSubmit = this.answersManager.getAnswer(answerKey);
          console.log(`\n[Non-interactive] Using recorded answer: ${shouldSubmit ? "submit" : "skip"}`);
        } else {
          // Default to true in non-interactive mode if no answer recorded
          shouldSubmit = true;
          console.log(`\n[Non-interactive] Auto-confirming transaction submission`);
        }
      } else {
        // Interactive mode: prompt user
        const { confirm } = await import("@inquirer/prompts");
        shouldSubmit = await confirm({
          message: `Submit transaction to ${this.network}?`,
          default: true,
        });

        // Record answer if recording is enabled
        if (this.answersManager) {
          this.answersManager.recordAnswer(answerKey, shouldSubmit);
        }
      }

      if (!shouldSubmit) {
        console.log("\n❌ Transaction submission cancelled");
        throw new Error("Transaction submission cancelled");
      }

      // Submit the signed transaction
      const txHash = await blaze.submitTransaction(signedTx);
      console.log(`✓ Transaction submitted: ${txHash}`);

      // Wait for confirmation on testnet before proceeding
      // Subsequent transactions depend on outputs from this one
      console.log("  Waiting for confirmation...");
      const confirmed = await this.awaitTxConfirmation(blaze, txHash);
      if (confirmed) {
        console.log("  ✓ Transaction confirmed\n");
      } else {
        console.log("  ⚠ Confirmation timeout - proceeding anyway\n");
      }

      return txHash;
    } else {
      // Print CBOR for manual signing
      const txCbor = tx.toCbor();
      console.log("\n" + "=".repeat(60));
      console.log("Transaction CBOR (for manual signing):");
      console.log("=".repeat(60));
      console.log(txCbor);
      console.log("=".repeat(60));
      console.log("\nPlease sign and submit this transaction externally.");

      // Return the transaction ID
      return tx.getId();
    }
  }
}

export function createProvider(
  mode: TestMode,
  walletConfig?: WalletConfig,
  apiKey?: string,
  testRunId?: string,
  settings?: Settings,
  resume: boolean = false,
): TestProvider {
  switch (mode) {
    case "emulator":
      return new EmulatorProvider();
    case "testnet":
      return new NetworkProvider("preview", walletConfig, apiKey, testRunId, settings, resume);
    case "mainnet":
      return new NetworkProvider("mainnet", walletConfig, apiKey, testRunId, settings, resume);
  }
}
