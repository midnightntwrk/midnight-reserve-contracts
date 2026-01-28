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
  expectTransactionRejection,
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
 * Journey 10: cNIGHT Minting Control
 *
 * The cNIGHT minting system uses a three-script architecture:
 *
 * 1. cnight_mint_forever: Withdrawal validator that requires BOTH logic and
 *    mitigation_logic from the UpgradeState to be in withdrawals.
 *
 * 2. cnight_mint_two_stage_upgrade: Standard two-stage upgrade for the
 *    UpgradeState (logic, auth, mitigation_logic, mitigation_auth).
 *
 * 3. cnight_mint_logic: ALWAYS FAILS. This is the key security property.
 *    Since the forever contract requires logic to be a withdrawal, and logic
 *    always fails, the forever contract can NEVER be successfully authorized.
 *    This effectively locks cNIGHT minting until the logic is upgraded via
 *    the two-stage process.
 *
 * This journey:
 * - Deploys the cNIGHT minting control (two-stage with logic=always_fails)
 * - Verifies the lockdown property (forever authorization fails because logic fails)
 * - Proves the two-stage upgrade mechanism is the only path to enable minting
 */
export const cnightMintingControlJourney: JourneyDefinition = {
  id: "cnight-minting-control",
  name: "cNIGHT Minting Control",
  description: "Deploy and verify cNIGHT minting lockdown via always-fails logic",
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
    // PHASE 1: DEPLOY CNIGHT MINTING CONTROL
    // ========================================================================
    {
      id: "deploy-cnight-minting-control",
      name: "Phase 1.1: Deploy cNIGHT minting two-stage upgrade",
      description: "Mint main + staging NFTs with UpgradeState where logic = cnight_mint_logic (always fails)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("deploy-cnight-minting-control", this.name);

        try {
          const Contracts = await import("../../contract_blueprint");
          const { contracts, blaze, config } = await getTestSetup(ctx);

          const cnightMinting = await contracts.getCnightMinting();
          const govAuth = await contracts.getGovAuth();
          const address = await blaze.wallet.getChangeAddress();

          // Find the cNIGHT minting one-shot UTxO
          const utxosSet = await blaze.provider.getUnspentOutputs(address);
          const deployerUtxos = Array.from(utxosSet);

          const cnightOneShotUtxo = deployerUtxos.find((utxo) => {
            const txId = utxo.input().transactionId();
            const txIdStr = typeof txId === "string" ? txId : txId.toString();
            return (
              txIdStr === config.cnight_minting_one_shot_hash &&
              utxo.input().index() === BigInt(config.cnight_minting_one_shot_index)
            );
          });

          if (!cnightOneShotUtxo) {
            throw new Error("cNIGHT minting one-shot UTxO not found");
          }

          console.log("  Deploying cNIGHT minting two-stage upgrade...");
          console.log(`  Logic: ${cnightMinting.logic.Script.hash().substring(0, 16)}... (ALWAYS FAILS)`);
          console.log(`  Auth: ${govAuth.Script.hash().substring(0, 16)}... (gov_auth)`);

          const twoStageAddress = addressFromValidator(0, cnightMinting.twoStage.Script);

          // UpgradeState: [logic, mitigation_logic, auth, mitigation_auth, round, logic_round]
          // logic = cnight_mint_logic (always fails) - this is the lockdown mechanism
          const upgradeState: typeof Contracts.UpgradeState = [
            cnightMinting.logic.Script.hash(), // logic = always fails
            "",                                 // mitigation_logic = empty
            govAuth.Script.hash(),              // auth = gov_auth
            "",                                 // mitigation_auth = empty
            0n,                                 // round = 0
            0n,                                 // logic_round = 0
          ];

          const mainAssetName = AssetName(toHex(new TextEncoder().encode("main")));
          const stagingAssetName = AssetName(toHex(new TextEncoder().encode("staging")));

          const txBuilder = blaze
            .newTransaction()
            .addInput(cnightOneShotUtxo)
            .addMint(
              PolicyId(cnightMinting.twoStage.Script.hash()),
              new Map([
                [mainAssetName, 1n],
                [stagingAssetName, 1n],
              ]),
              PlutusData.newInteger(0n)
            )
            .provideScript(cnightMinting.twoStage.Script)
            // Output 0: main NFT
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(twoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(cnightMinting.twoStage.Script.hash() + toHex(new TextEncoder().encode("main"))), 1n],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
              })
            )
            // Output 1: staging NFT
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(twoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(cnightMinting.twoStage.Script.hash() + toHex(new TextEncoder().encode("staging"))), 1n],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
              })
            );

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 cNIGHT minting control deployed: ${txHash.substring(0, 16)}...`);
          console.log(`    TwoStage: ${cnightMinting.twoStage.Script.hash().substring(0, 16)}...`);
          console.log(`    Forever (withdrawal): ${cnightMinting.forever.Script.hash().substring(0, 16)}...`);

          ctx.journeyState.deployments["cnightMinting"] = {
            componentName: "cnightMinting",
            txHash,
            outputIndex: 0,
            metadata: { mainOutputIndex: 0, stagingOutputIndex: 1 },
          };

          return completeTestResult(result, "passed", "cNIGHT minting control deployed with always-fails logic.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "register-cnight-credentials",
      name: "Phase 1.2: Register cNIGHT minting stake credentials",
      description: "Register forever and logic withdrawal credentials",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("register-cnight-credentials", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const cnightMinting = await contracts.getCnightMinting();

          console.log("  Registering cNIGHT minting stake credentials...");

          const foreverHash = cnightMinting.forever.Script.hash();
          const logicHash = cnightMinting.logic.Script.hash();

          const txBuilder = blaze
            .newTransaction()
            .addRegisterStake(Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: Hash28ByteBase16(foreverHash),
            }))
            .addRegisterStake(Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: Hash28ByteBase16(logicHash),
            }));

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 Forever credential registered: ${foreverHash.substring(0, 16)}...`);
          console.log(`  \u2713 Logic credential registered: ${logicHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "cNIGHT minting credentials registered.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },

    // ========================================================================
    // PHASE 2: VERIFY MINTING LOCKDOWN
    // ========================================================================
    {
      id: "verify-minting-blocked",
      name: "Phase 2.1: Verify cNIGHT minting is blocked",
      description: "Attempt to withdraw from forever contract - should fail because logic always fails",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-minting-blocked", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);

          console.log("  Testing that cNIGHT minting is locked down...");
          console.log("  The forever contract requires logic (cnight_mint_logic) to be in withdrawals");
          console.log("  But cnight_mint_logic ALWAYS FAILS, so the forever withdrawal should fail");

          const cnightMinting = await contracts.getCnightMinting();

          // Get the two-stage main UTxO (needed as reference for the forever contract)
          const twoStageAddress = addressFromValidator(0, cnightMinting.twoStage.Script);
          const twoStageUtxosSet = await blaze.provider.getUnspentOutputs(twoStageAddress);
          const twoStageUtxos = Array.from(twoStageUtxosSet);

          const mainAssetId = AssetId(
            cnightMinting.twoStage.Script.hash() + toHex(new TextEncoder().encode("main"))
          );
          const twoStageMainUtxo = twoStageUtxos.find(utxo =>
            (utxo.output().amount().multiasset()?.get(mainAssetId) ?? 0n) === 1n
          );

          if (!twoStageMainUtxo) {
            throw new Error("cNIGHT two-stage main UTxO not found");
          }

          // Build reward accounts for withdrawals
          const foreverRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(cnightMinting.forever.Script.hash()),
          }, NetworkId.Testnet);

          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(cnightMinting.logic.Script.hash()),
          }, NetworkId.Testnet);

          // Attempt to withdraw from forever (which requires logic withdrawal)
          // This should FAIL because cnight_mint_logic always fails
          const rejection = await expectTransactionRejection(
            async () => {
              const txBuilder = blaze
                .newTransaction()
                .addReferenceInput(twoStageMainUtxo) // forever needs this
                // Withdraw from forever (requires logic in withdrawals)
                .addWithdrawal(foreverRewardAccount, 0n, PlutusData.newInteger(0n))
                // Also withdraw from logic (required by forever's validate_running)
                .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n))
                .provideScript(cnightMinting.forever.Script)
                .provideScript(cnightMinting.logic.Script);

              await ctx.provider.submitTransaction("deployer", txBuilder);
            },
            {
              errorShouldInclude: ["Validator returned false", "fail"],
              description: "cNIGHT logic always fails",
            }
          );

          if (!rejection.passed) {
            return completeTestResult(
              result,
              "failed",
              undefined,
              `cNIGHT forever withdrawal SUCCEEDED but should have been blocked! ${rejection.message}`
            );
          }

          console.log(`  \u2713 Forever withdrawal correctly blocked`);
          console.log(`    cnight_mint_logic always fails, preventing any minting authorization`);
          console.log(`    Minting can only be enabled via two-stage upgrade of the logic field`);

          return completeTestResult(
            result,
            "passed",
            "cNIGHT minting is locked: forever withdrawal blocked by always-fails logic."
          );
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-two-stage-still-operable",
      name: "Phase 2.2: Verify two-stage upgrade is still operable",
      description: "The two-stage upgrade mechanism should still work (it uses gov_auth, not logic)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-two-stage-still-operable", this.name);

        try {
          const Contracts = await import("../../contract_blueprint");
          const { contracts, blaze } = await getTestSetup(ctx);

          console.log("  Verifying two-stage upgrade can still stage changes...");
          console.log("  (The lockdown only affects the forever contract, not the upgrade mechanism)");

          const cnightMinting = await contracts.getCnightMinting();
          const govAuth = await contracts.getGovAuth();
          const { parse } = await import("@blaze-cardano/data");

          // Get two-stage UTxOs
          const twoStageAddress = addressFromValidator(0, cnightMinting.twoStage.Script);
          const twoStageUtxosSet = await blaze.provider.getUnspentOutputs(twoStageAddress);
          const twoStageUtxos = Array.from(twoStageUtxosSet);

          const mainAssetId = AssetId(
            cnightMinting.twoStage.Script.hash() + toHex(new TextEncoder().encode("main"))
          );
          const stagingAssetId = AssetId(
            cnightMinting.twoStage.Script.hash() + toHex(new TextEncoder().encode("staging"))
          );

          const mainUtxo = twoStageUtxos.find(utxo =>
            (utxo.output().amount().multiasset()?.get(mainAssetId) ?? 0n) === 1n
          );
          const stagingUtxo = twoStageUtxos.find(utxo =>
            (utxo.output().amount().multiasset()?.get(stagingAssetId) ?? 0n) === 1n
          );

          if (!mainUtxo || !stagingUtxo) {
            throw new Error("cNIGHT two-stage UTxOs not found");
          }

          // Get governance reference UTxOs
          const { getGovernanceReferenceUtxos, buildGovAuthRewardAccount } =
            await import("../lib/test-helpers");
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current staging state
          const { parseInlineDatum } = await import("../lib/test-helpers");
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);

          // Stage a new logic hash (use any valid 28-byte hash)
          // This proves the upgrade mechanism works even though minting is locked
          const alwaysFails = await contracts.getAlwaysFails();
          const newLogicHash = alwaysFails.Script.hash();

          const { buildStagingRedeemer } = await import("../lib/test-helpers");
          const { redeemer } = buildStagingRedeemer(mainUtxo, newLogicHash, "Logic");

          const newState: typeof Contracts.UpgradeState = [
            newLogicHash,
            currentState[1],
            currentState[2],
            currentState[3],
            currentState[4],
            currentState[5] + 1n, // Logic staging increments logic_round
          ];

          const txBuilder = blaze
            .newTransaction()
            .addInput(stagingUtxo, serialize(Contracts.TwoStageRedeemer, redeemer))
            .addReferenceInput(mainUtxo)
            .addReferenceInput(refUtxos.councilForever)
            .addReferenceInput(refUtxos.techAuthForever)
            .addReferenceInput(refUtxos.thresholds)
            .addMint(PolicyId(councilNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(techAuthNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(stagingUtxo.output().address().toBech32()),
                value: {
                  coins: stagingUtxo.output().amount().coin(),
                  assets: stagingUtxo.output().amount().multiasset() ?? new Map(),
                },
                datum: serialize(Contracts.UpgradeState, newState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, redeemer))
            .provideScript(cnightMinting.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  \u2713 Two-stage staging succeeded: ${txHash.substring(0, 16)}...`);
          console.log(`    Staged new logic hash to cNIGHT minting control`);
          console.log(`    This proves the upgrade path is functional`);
          console.log(`    (Production would stage a real minting logic here)`);

          return completeTestResult(
            result,
            "passed",
            "Two-stage upgrade operational despite minting lockdown."
          );
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
  ],
};
