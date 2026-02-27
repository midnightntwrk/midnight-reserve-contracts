import type {
  JourneyDefinition,
  JourneyContext,
  TestResult,
} from "../lib/types";
import {
  initTestResult,
  completeTestResult,
  getTestSetup,
  buildAuthNativeScripts,
  getContractUtxos,
  createSigner,
} from "../lib/test-helpers";
import {
  AssetId,
  AssetName,
  PaymentAddress,
  PolicyId,
  PlutusData,
  TransactionOutput,
  addressFromValidator,
  toHex,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  RewardAccount,
  NetworkId,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";

/**
 * Journey 9: FederatedOps & Terms and Conditions
 *
 * Tests deployment and state updates for two contract groups that haven't
 * been exercised by existing journeys:
 *
 * 1. FederatedOps: Stores federated operator data (sidechain keys).
 *    - Uses the same forever/two-stage/logic architecture as Council/TechAuth
 *    - State updates require dual multisig (tech_auth + council)
 *    - Threshold governed by main_federated_ops_update_threshold
 *
 * 2. Terms and Conditions: Stores T&C document hash + link.
 *    - Uses Versioned<TermsAndConditions> datum: [[hash, link], logic_round]
 *    - Hash must be exactly 32 bytes
 *    - Logic_round must be 0 on initial deployment
 *    - Threshold governed by terms_and_conditions_threshold
 */
export const fedopsAndTermsJourney: JourneyDefinition = {
  id: "fedops-and-terms",
  name: "FederatedOps & Terms and Conditions",
  description: "Deploy and operate FederatedOps and T&C contracts",
  reuseContracts: false,
  steps: [
    // ========================================================================
    // PHASE 0: SETUP
    // ========================================================================
    {
      id: "setup-deploy-governance",
      name: "Phase 0: Deploy governance contracts",
      description: "Deploy Council, TechAuth, Thresholds",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("setup-deploy-governance", this.name);

        try {
          const { deployGovernanceContracts } = await import("../lib/test-helpers");
          const { councilTxHash, techAuthTxHash, thresholdsTxHash, registerTxHash } =
            await deployGovernanceContracts(ctx);

          console.log(`  \u2713 Council: ${councilTxHash.substring(0, 16)}...`);
          console.log(`  \u2713 TechAuth: ${techAuthTxHash.substring(0, 16)}...`);
          console.log(`  \u2713 Thresholds: ${thresholdsTxHash.substring(0, 16)}...`);
          console.log(`  \u2713 Stake registration: ${registerTxHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "Governance contracts deployed");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },

    // ========================================================================
    // PHASE 1: FEDERATED OPS
    // ========================================================================
    {
      id: "deploy-federated-ops",
      name: "Phase 1.1: Deploy FederatedOps contracts",
      description: "Mint forever NFT + two-stage NFTs with initial FederatedOps state",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("deploy-federated-ops", this.name);

        try {
          const Contracts = await import("../../contract_blueprint");
          const { contracts, blaze, config } = await getTestSetup(ctx);

          const fedOps = await contracts.getFederatedOps();
          const govAuth = await contracts.getGovAuth();
          const address = await blaze.wallet.getChangeAddress();

          // Find the FedOps one-shot UTxO
          const utxosSet = await blaze.provider.getUnspentOutputs(address);
          const deployerUtxos = Array.from(utxosSet);

          const fedOpsOneShotUtxo = deployerUtxos.find((utxo) => {
            const txId = utxo.input().transactionId();
            const txIdStr = typeof txId === "string" ? txId : txId.toString();
            return (
              txIdStr === config.federated_operators_one_shot_hash &&
              utxo.input().index() === BigInt(config.federated_operators_one_shot_index)
            );
          });

          if (!fedOpsOneShotUtxo) {
            throw new Error("FederatedOps one-shot UTxO not found");
          }

          console.log("  Deploying FederatedOps contracts...");

          // Addresses
          const fedOpsForeverAddress = addressFromValidator(0, fedOps.forever.Script);
          const fedOpsTwoStageAddress = addressFromValidator(0, fedOps.twoStage.Script);

          // UpgradeState: [logic, mitigation_logic, auth, mitigation_auth, round, logic_round]
          const upgradeState: typeof Contracts.UpgradeState = [
            fedOps.logic.Script.hash(),
            "",
            govAuth.Script.hash(),
            "",
            0n,
            0n,
          ];

          // FederatedOps initial datum: [data, appendix, logic_round]
          // data = opaque PlutusData (using empty constructor)
          // appendix = empty operators list
          // logic_round = 0
          const fedOpsDatum: typeof Contracts.FederatedOps = [
            PlutusData.newInteger(0n),
            [],
            0n,
          ];

          // Build signers for the redeemer (same as council pattern - deployer's payment hash)
          const paymentHash = address.asBase()?.getPaymentCredential().hash!;
          const signers = createSigner(paymentHash, true);

          const mainAssetName = AssetName(toHex(new TextEncoder().encode("main")));
          const stagingAssetName = AssetName(toHex(new TextEncoder().encode("staging")));

          const txBuilder = blaze
            .newTransaction()
            .addInput(fedOpsOneShotUtxo)
            // Mint forever NFT
            .addMint(
              PolicyId(fedOps.forever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, signers)
            )
            // Mint two-stage NFTs (main + staging)
            .addMint(
              PolicyId(fedOps.twoStage.Script.hash()),
              new Map([
                [mainAssetName, 1n],
                [stagingAssetName, 1n],
              ]),
              PlutusData.newInteger(0n)
            )
            .provideScript(fedOps.forever.Script)
            .provideScript(fedOps.twoStage.Script)
            // Output 0: Two-stage main
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(fedOpsTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(fedOps.twoStage.Script.hash() + toHex(new TextEncoder().encode("main"))), 1n],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
              })
            )
            // Output 1: Two-stage staging
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(fedOpsTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(fedOps.twoStage.Script.hash() + toHex(new TextEncoder().encode("staging"))), 1n],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
              })
            )
            // Output 2: Forever
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(fedOpsForeverAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([[AssetId(fedOps.forever.Script.hash()), 1n]]),
                },
                datum: serialize(Contracts.FederatedOps, fedOpsDatum).toCore(),
              })
            );

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 FederatedOps deployed: ${txHash.substring(0, 16)}...`);
          console.log(`    Forever: ${fedOps.forever.Script.hash().substring(0, 16)}...`);
          console.log(`    TwoStage: ${fedOps.twoStage.Script.hash().substring(0, 16)}...`);
          console.log(`    Logic: ${fedOps.logic.Script.hash().substring(0, 16)}...`);

          ctx.journeyState.deployments["fedOps"] = {
            componentName: "fedOps",
            txHash,
            outputIndex: 2,
            metadata: { mainOutputIndex: 0, stagingOutputIndex: 1, foreverOutputIndex: 2 },
          };

          return completeTestResult(result, "passed", "FederatedOps contracts deployed.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "register-fedops-logic",
      name: "Phase 1.2: Register FedOps logic stake credential",
      description: "Register the withdrawal credential for FedOps logic validator",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("register-fedops-logic", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const fedOps = await contracts.getFederatedOps();

          console.log("  Registering FedOps logic stake credential...");

          const fedOpsLogicHash = fedOps.logic.Script.hash();
          const txBuilder = blaze
            .newTransaction()
            .addRegisterStake(Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: Hash28ByteBase16(fedOpsLogicHash),
            }));

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 FedOps logic registered: ${txHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "FedOps logic stake credential registered.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "update-federated-ops-state",
      name: "Phase 1.3: Update FederatedOps state",
      description: "Spend forever UTxO with dual multisig auth to update operator data",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("update-federated-ops-state", this.name);

        try {
          const Contracts = await import("../../contract_blueprint");
          const { contracts, blaze } = await getTestSetup(ctx);

          console.log("  Updating FederatedOps state via multisig...");

          const fedOps = await contracts.getFederatedOps();
          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const thresholdsContracts = await contracts.getThresholds();

          // Get UTxOs
          const utxos = await getContractUtxos(ctx, {
            fedOpsForever: fedOps.forever.Script,
            fedOpsTwoStage: fedOps.twoStage.Script,
            councilForever: council.forever.Script,
            techAuthForever: techAuth.forever.Script,
            fedOpsUpdateThreshold: thresholdsContracts.mainFederatedOpsUpdate.Script,
          }, 0);

          // Find specific UTxOs by NFT
          const fedOpsForeverUtxo = utxos.fedOpsForever.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(fedOps.forever.Script.hash())) ?? 0n) === 1n
          );
          const mainAssetId = AssetId(fedOps.twoStage.Script.hash() + toHex(new TextEncoder().encode("main")));
          const fedOpsTwoStageMainUtxo = utxos.fedOpsTwoStage.find(utxo =>
            (utxo.output().amount().multiasset()?.get(mainAssetId) ?? 0n) === 1n
          );
          const councilForeverUtxo = utxos.councilForever.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(council.forever.Script.hash())) ?? 0n) === 1n
          );
          const techAuthForeverUtxo = utxos.techAuthForever.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(techAuth.forever.Script.hash())) ?? 0n) === 1n
          );
          const fedOpsThresholdUtxo = utxos.fedOpsUpdateThreshold.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(thresholdsContracts.mainFederatedOpsUpdate.Script.hash())) ?? 0n) === 1n
          );

          if (!fedOpsForeverUtxo || !fedOpsTwoStageMainUtxo || !councilForeverUtxo || !techAuthForeverUtxo || !fedOpsThresholdUtxo) {
            const missing = [];
            if (!fedOpsForeverUtxo) missing.push("fedOpsForever");
            if (!fedOpsTwoStageMainUtxo) missing.push("fedOpsTwoStageMain");
            if (!councilForeverUtxo) missing.push("councilForever");
            if (!techAuthForeverUtxo) missing.push("techAuthForever");
            if (!fedOpsThresholdUtxo) missing.push("fedOpsThreshold");
            throw new Error(`Required UTxOs not found: ${missing.join(", ")}`);
          }

          // Build auth native scripts
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);

          // Build new FederatedOps datum with updated data
          const newFedOpsDatum: typeof Contracts.FederatedOps = [
            PlutusData.newInteger(1n), // updated opaque data
            [], // still empty operators (update the data field only)
            0n, // logic_round stays at 0 (forever contract doesn't increment)
          ];

          // FedOps logic withdrawal
          const fedOpsLogicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(fedOps.logic.Script.hash()),
          }, NetworkId.Testnet);

          const fedOpsForeverAddress = addressFromValidator(0, fedOps.forever.Script);

          const txBuilder = blaze
            .newTransaction()
            // Spend the forever UTxO
            .addInput(fedOpsForeverUtxo, PlutusData.newInteger(0n))
            // Reference inputs for auth checks
            .addReferenceInput(fedOpsTwoStageMainUtxo) // forever needs this for logic hash
            .addReferenceInput(councilForeverUtxo)      // logic needs this for council signers
            .addReferenceInput(techAuthForeverUtxo)     // logic needs this for tech auth signers
            .addReferenceInput(fedOpsThresholdUtxo)     // logic needs this for threshold fractions
            // Multisig mints
            .addMint(PolicyId(councilNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(techAuthNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            // Logic withdrawal (authorizes the forever spend)
            .addWithdrawal(fedOpsLogicRewardAccount, 0n, PlutusData.newInteger(0n))
            // Output: updated forever UTxO
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(fedOpsForeverAddress.toBech32()),
                value: {
                  coins: fedOpsForeverUtxo.output().amount().coin(),
                  assets: fedOpsForeverUtxo.output().amount().multiasset() ?? new Map(),
                },
                datum: serialize(Contracts.FederatedOps, newFedOpsDatum).toCore(),
              })
            )
            // Provide scripts
            .provideScript(fedOps.forever.Script) // for spending
            .provideScript(fedOps.logic.Script)   // for withdrawal
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 FederatedOps state updated: ${txHash.substring(0, 16)}...`);
          console.log(`    Update required dual multisig (council + tech auth)`);
          console.log(`    Threshold: main_federated_ops_update_threshold`);

          return completeTestResult(result, "passed", "FederatedOps state updated with multisig auth.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },

    // ========================================================================
    // PHASE 2: TERMS AND CONDITIONS
    // ========================================================================
    {
      id: "deploy-terms-and-conditions",
      name: "Phase 2.1: Deploy Terms and Conditions contracts",
      description: "Mint forever NFT + two-stage NFTs with initial T&C state",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("deploy-terms-and-conditions", this.name);

        try {
          const Contracts = await import("../../contract_blueprint");
          const { contracts, blaze, config } = await getTestSetup(ctx);

          const tc = await contracts.getTermsAndConditions();
          const govAuth = await contracts.getGovAuth();
          const address = await blaze.wallet.getChangeAddress();

          // Find the T&C one-shot UTxO
          const utxosSet = await blaze.provider.getUnspentOutputs(address);
          const deployerUtxos = Array.from(utxosSet);

          const tcOneShotUtxo = deployerUtxos.find((utxo) => {
            const txId = utxo.input().transactionId();
            const txIdStr = typeof txId === "string" ? txId : txId.toString();
            return (
              txIdStr === config.terms_and_conditions_one_shot_hash &&
              utxo.input().index() === BigInt(config.terms_and_conditions_one_shot_index)
            );
          });

          if (!tcOneShotUtxo) {
            throw new Error("T&C one-shot UTxO not found");
          }

          console.log("  Deploying Terms and Conditions contracts...");

          const tcForeverAddress = addressFromValidator(0, tc.forever.Script);
          const tcTwoStageAddress = addressFromValidator(0, tc.twoStage.Script);

          // UpgradeState for two-stage
          const upgradeState: typeof Contracts.UpgradeState = [
            tc.logic.Script.hash(),
            "",
            govAuth.Script.hash(),
            "",
            0n,
            0n,
          ];

          // Initial T&C datum: Versioned<TermsAndConditions>
          // TermsAndConditions = [hash (32 bytes), link]
          // Versioned = [data, logic_round]
          const initialHash = "a".repeat(64); // 32-byte hash (64 hex chars)
          const initialLink = toHex(new TextEncoder().encode("https://example.com/terms"));

          const tcDatum: typeof Contracts.VersionedTermsAndConditions = [
            [initialHash, initialLink],
            0n,
          ];

          // Redeemer for forever minting (not checked by validate_terms_structure)
          const paymentHash = address.asBase()?.getPaymentCredential().hash!;
          const signers = createSigner(paymentHash, true);

          const mainAssetName = AssetName(toHex(new TextEncoder().encode("main")));
          const stagingAssetName = AssetName(toHex(new TextEncoder().encode("staging")));

          const txBuilder = blaze
            .newTransaction()
            .addInput(tcOneShotUtxo)
            // Mint forever NFT
            .addMint(
              PolicyId(tc.forever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, signers)
            )
            // Mint two-stage NFTs
            .addMint(
              PolicyId(tc.twoStage.Script.hash()),
              new Map([
                [mainAssetName, 1n],
                [stagingAssetName, 1n],
              ]),
              PlutusData.newInteger(0n)
            )
            .provideScript(tc.forever.Script)
            .provideScript(tc.twoStage.Script)
            // Output 0: Two-stage main
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(tcTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(tc.twoStage.Script.hash() + toHex(new TextEncoder().encode("main"))), 1n],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
              })
            )
            // Output 1: Two-stage staging
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(tcTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(tc.twoStage.Script.hash() + toHex(new TextEncoder().encode("staging"))), 1n],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
              })
            )
            // Output 2: Forever
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(tcForeverAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([[AssetId(tc.forever.Script.hash()), 1n]]),
                },
                datum: serialize(Contracts.VersionedTermsAndConditions, tcDatum).toCore(),
              })
            );

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 T&C deployed: ${txHash.substring(0, 16)}...`);
          console.log(`    Forever: ${tc.forever.Script.hash().substring(0, 16)}...`);
          console.log(`    TwoStage: ${tc.twoStage.Script.hash().substring(0, 16)}...`);
          console.log(`    Logic: ${tc.logic.Script.hash().substring(0, 16)}...`);

          ctx.journeyState.deployments["termsAndConditions"] = {
            componentName: "termsAndConditions",
            txHash,
            outputIndex: 2,
            metadata: { mainOutputIndex: 0, stagingOutputIndex: 1, foreverOutputIndex: 2 },
          };

          return completeTestResult(result, "passed", "Terms and Conditions contracts deployed.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "deploy-tc-threshold",
      name: "Phase 2.2: Deploy T&C threshold NFT",
      description: "Mint the terms_and_conditions_threshold NFT (separate from main thresholds)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("deploy-tc-threshold", this.name);

        try {
          const Contracts = await import("../../contract_blueprint");
          const { contracts, blaze, config } = await getTestSetup(ctx);

          const thresholdsContracts = await contracts.getThresholds();
          const address = await blaze.wallet.getChangeAddress();

          console.log("  Deploying T&C threshold NFT...");

          // Find T&C threshold one-shot UTxO
          const utxosSet = await blaze.provider.getUnspentOutputs(address);
          const deployerUtxos = Array.from(utxosSet);

          const tcThresholdOneShotUtxo = deployerUtxos.find((utxo) => {
            const txId = utxo.input().transactionId();
            const txIdStr = typeof txId === "string" ? txId : txId.toString();
            return (
              txIdStr === config.terms_and_conditions_threshold_one_shot_hash &&
              utxo.input().index() === BigInt(config.terms_and_conditions_threshold_one_shot_index)
            );
          });

          if (!tcThresholdOneShotUtxo) {
            throw new Error("T&C threshold one-shot UTxO not found");
          }

          const thresholdScript = thresholdsContracts.termsAndConditions.Script;
          const thresholdAddress = addressFromValidator(0, thresholdScript);

          // Initial threshold: [1, 2, 1, 2] (same as other thresholds)
          const initialThreshold: typeof Contracts.MultisigThreshold = [1n, 2n, 1n, 2n];

          const txBuilder = blaze
            .newTransaction()
            .addInput(tcThresholdOneShotUtxo)
            .addMint(
              PolicyId(thresholdScript.hash()),
              new Map([[AssetName(""), 1n]]),
              PlutusData.newInteger(0n)
            )
            .provideScript(thresholdScript)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(thresholdAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([[AssetId(thresholdScript.hash()), 1n]]),
                },
                datum: serialize(Contracts.MultisigThreshold, initialThreshold).toCore(),
              })
            );

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 T&C threshold deployed: ${txHash.substring(0, 16)}...`);
          console.log(`    Hash: ${thresholdScript.hash().substring(0, 16)}...`);

          ctx.journeyState.deployments["tcThreshold"] = {
            componentName: "tcThreshold",
            txHash,
            outputIndex: 0,
          };

          return completeTestResult(result, "passed", "T&C threshold NFT deployed.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "register-tc-logic",
      name: "Phase 2.3: Register T&C logic stake credential",
      description: "Register the withdrawal credential for T&C logic validator",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("register-tc-logic", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const tc = await contracts.getTermsAndConditions();

          console.log("  Registering T&C logic stake credential...");

          const tcLogicHash = tc.logic.Script.hash();
          const txBuilder = blaze
            .newTransaction()
            .addRegisterStake(Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: Hash28ByteBase16(tcLogicHash),
            }));

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 T&C logic registered: ${txHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "T&C logic stake credential registered.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "update-terms-and-conditions",
      name: "Phase 2.4: Update Terms and Conditions hash",
      description: "Spend forever UTxO with dual multisig auth to update T&C document hash",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("update-terms-and-conditions", this.name);

        try {
          const Contracts = await import("../../contract_blueprint");
          const { contracts, blaze } = await getTestSetup(ctx);

          console.log("  Updating T&C document hash via multisig...");

          const tc = await contracts.getTermsAndConditions();
          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const thresholdsContracts = await contracts.getThresholds();

          // Get UTxOs
          const utxos = await getContractUtxos(ctx, {
            tcForever: tc.forever.Script,
            tcTwoStage: tc.twoStage.Script,
            councilForever: council.forever.Script,
            techAuthForever: techAuth.forever.Script,
            tcThreshold: thresholdsContracts.termsAndConditions.Script,
          }, 0);

          // Find specific UTxOs
          const tcForeverUtxo = utxos.tcForever.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(tc.forever.Script.hash())) ?? 0n) === 1n
          );
          const mainAssetId = AssetId(tc.twoStage.Script.hash() + toHex(new TextEncoder().encode("main")));
          const tcTwoStageMainUtxo = utxos.tcTwoStage.find(utxo =>
            (utxo.output().amount().multiasset()?.get(mainAssetId) ?? 0n) === 1n
          );
          const councilForeverUtxo = utxos.councilForever.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(council.forever.Script.hash())) ?? 0n) === 1n
          );
          const techAuthForeverUtxo = utxos.techAuthForever.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(techAuth.forever.Script.hash())) ?? 0n) === 1n
          );
          const tcThresholdUtxo = utxos.tcThreshold.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(thresholdsContracts.termsAndConditions.Script.hash())) ?? 0n) === 1n
          );

          if (!tcForeverUtxo || !tcTwoStageMainUtxo || !councilForeverUtxo || !techAuthForeverUtxo || !tcThresholdUtxo) {
            const missing = [];
            if (!tcForeverUtxo) missing.push("tcForever");
            if (!tcTwoStageMainUtxo) missing.push("tcTwoStageMain");
            if (!councilForeverUtxo) missing.push("councilForever");
            if (!techAuthForeverUtxo) missing.push("techAuthForever");
            if (!tcThresholdUtxo) missing.push("tcThreshold");
            throw new Error(`Required UTxOs not found: ${missing.join(", ")}`);
          }

          // Build auth native scripts
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);

          // Build new T&C datum with updated hash
          const newHash = "b".repeat(64); // New 32-byte hash
          const newLink = toHex(new TextEncoder().encode("https://example.com/terms/v2"));

          const newTcDatum: typeof Contracts.VersionedTermsAndConditions = [
            [newHash, newLink],
            0n, // logic_round stays 0 (forever contract preserves this)
          ];

          // T&C logic withdrawal
          const tcLogicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(tc.logic.Script.hash()),
          }, NetworkId.Testnet);

          const tcForeverAddress = addressFromValidator(0, tc.forever.Script);

          const txBuilder = blaze
            .newTransaction()
            // Spend the forever UTxO
            .addInput(tcForeverUtxo, PlutusData.newInteger(0n))
            // Reference inputs
            .addReferenceInput(tcTwoStageMainUtxo)    // forever needs this for logic hash
            .addReferenceInput(councilForeverUtxo)     // logic needs council signers
            .addReferenceInput(techAuthForeverUtxo)    // logic needs tech auth signers
            .addReferenceInput(tcThresholdUtxo)        // logic needs threshold fractions
            // Multisig mints
            .addMint(PolicyId(councilNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(techAuthNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            // Logic withdrawal
            .addWithdrawal(tcLogicRewardAccount, 0n, PlutusData.newInteger(0n))
            // Output: updated forever UTxO
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(tcForeverAddress.toBech32()),
                value: {
                  coins: tcForeverUtxo.output().amount().coin(),
                  assets: tcForeverUtxo.output().amount().multiasset() ?? new Map(),
                },
                datum: serialize(Contracts.VersionedTermsAndConditions, newTcDatum).toCore(),
              })
            )
            // Provide scripts
            .provideScript(tc.forever.Script)  // for spending
            .provideScript(tc.logic.Script)    // for withdrawal
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 T&C hash updated: ${txHash.substring(0, 16)}...`);
          console.log(`    Old hash: ${"a".repeat(16)}...`);
          console.log(`    New hash: ${"b".repeat(16)}...`);
          console.log(`    Update required dual multisig (council + tech auth)`);
          console.log(`    Threshold: terms_and_conditions_threshold`);

          return completeTestResult(result, "passed", "T&C document hash updated with multisig auth.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
  ],
};
