import { Emulator } from "@blaze-cardano/emulator";
import { Blaze, HotWallet, ColdWallet, Core } from "@blaze-cardano/sdk";
import {
  TransactionUnspentOutput,
  TransactionId,
  PaymentAddress,
  Address,
  SLOT_CONFIG_NETWORK,
  hardCodedProtocolParams,
} from "@blaze-cardano/core";
import { makeUplcEvaluator } from "@blaze-cardano/vm";
import type { TestMode, WalletConfig, Settings } from "./types";
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
  cnight_policy: string;
}

export interface TestProvider {
  getBlaze(walletId: string): Promise<Blaze>;
  setup(): Promise<void>;
  cleanup(): Promise<void>;
  reset(): Promise<void>; // Reset emulator state between journeys
  submitTransaction(walletId: string, txBuilder: TxBuilder, options?: { suggestedSigners?: string[] }): Promise<string>;
  getConfig(): NetworkConfig;
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
      cnight_policy: cnightPolicy,
    };
  }

  getConfig(): NetworkConfig {
    return this.config;
  }

  async setup(): Promise<void> {
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
  }

  async cleanup(): Promise<void> {
    this.blazeCache.clear();
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

  async submitTransaction(
    walletId: string,
    txBuilder: TxBuilder,
    options?: { suggestedSigners?: string[] }
  ): Promise<string> {
    const blaze = await this.getBlaze(walletId);

    // If suggested signers are provided, add them as required signers
    // This helps the emulator know which wallets to use for signatures
    if (options?.suggestedSigners) {
      for (const signerId of options.suggestedSigners) {
        let signerAddress: any;
        await this.emulator.as(signerId, async (_, addr) => {
          signerAddress = addr;
        });

        if (signerAddress) {
          const paymentCredential = signerAddress.asBase()?.getPaymentCredential();
          if (paymentCredential) {
            txBuilder.addRequiredSigner(paymentCredential.hash);
          }
        }
      }
    }

    await this.emulator.expectValidTransaction(blaze, txBuilder);
    const tx = await txBuilder.complete();
    return tx.getId();
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

  constructor(
    private network: "preview" | "preprod" | "mainnet",
    walletConfig?: WalletConfig,
    apiKey?: string,
    testRunId?: string,
    settings?: Settings,
  ) {
    this.walletConfig = walletConfig;
    this.apiKey = apiKey;
    this.testRunId = testRunId;
    this.settings = settings;

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

    // Load config from aiken.toml
    await this.loadConfig();

    // If testRunId is provided and we're on preview/preprod, rebuild contracts
    if (this.testRunId && (this.network === "preview" || this.network === "preprod")) {
      await this.rebuildContractsForTestRun();
      // Reload config after rebuild since we created a new config section
      await this.loadConfig();
    }
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

  async cleanup(): Promise<void> {
    // Save recorded answers if recording was enabled
    if (this.answersManager) {
      this.answersManager.save();
    }
  }

  async reset(): Promise<void> {
    // For network providers, reset doesn't need to do anything
    // Each journey will use fresh UTxOs from the wallet
    // Note: On testnet, contracts would need to be redeployed per journey
    // which would require rebuilding with new one-shot UTxOs
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

  async submitTransaction(
    walletId: string,
    txBuilder: TxBuilder,
    options?: { suggestedSigners?: string[] }
  ): Promise<string> {
    if (!this.walletConfig) {
      throw new Error("Wallet configuration required");
    }

    // Log suggested signers if provided (for mainnet, these would need to be gathered separately)
    if (options?.suggestedSigners && options.suggestedSigners.length > 0) {
      console.log(`\n⚠ Transaction requires signatures from: ${options.suggestedSigners.join(', ')}`);
      console.log(`   The native scripts in the transaction will validate these signatures.`);
    }

    const blaze = await this.getBlaze(walletId);

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
      // Sign the transaction
      const signedTx = await blaze.signTransaction(tx);

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
      console.log("✓ Transaction submitted\n");
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
): TestProvider {
  switch (mode) {
    case "emulator":
      return new EmulatorProvider();
    case "testnet":
      return new NetworkProvider("preview", walletConfig, apiKey, testRunId, settings);
    case "mainnet":
      return new NetworkProvider("mainnet", walletConfig, apiKey, testRunId, settings);
  }
}
