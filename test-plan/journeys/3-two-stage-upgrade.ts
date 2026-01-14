import type {
  JourneyDefinition,
  JourneyContext,
  TestResult,
} from "../lib/types";
import {
  initTestResult,
  completeTestResult,
  getTestSetup,
  getDeployment,
  storeDeployment,
  findUtxoByTxOutput,
  getContractUtxos,
  findUtxoWithNft,
  parseInlineDatum,
  getTwoStageUtxos,
  buildAuthNativeScripts,
  getGovernanceReferenceUtxos,
  buildGovAuthRewardAccount,
  buildStagingRedeemer,
  buildPromoteRedeemer,
  expectTransactionRejection,
} from "../lib/test-helpers";
import {
  AssetId,
  toHex,
  PaymentAddress,
  TransactionOutput,
  PolicyId,
  AssetName,
  RewardAccount,
  CredentialType,
  Hash28ByteBase16,
  NetworkId,
} from "@blaze-cardano/core";
import { serialize, parse } from "@blaze-cardano/data";

/**
 * Journey 3: Two-Stage Upgrade Lifecycle
 *
 * This journey tests the complete two-stage upgrade system flow:
 * staging → testing in isolation → promoting → downgrading
 *
 * ARCHITECTURE NOTES FOR AI AGENTS:
 *
 * The two-stage upgrade system is the core upgrade mechanism:
 *
 * 1. Two-Stage Contract Structure
 *    - Holds TWO UpgradeState UTxOs: "main" and "staging"
 *    - Each has NFT with respective asset name
 *    - UpgradeState: [logic_hash, mitigation_logic_hash, auth_hash, mitigation_auth_hash, round, logic_round]
 *
 * 2. Upgrade Flow
 *    Stage:   Update staging UTxO with new logic_hash
 *    Test:    Operations on staging use new logic
 *    Promote: Copy staging → main (atomically)
 *
 * 3. Isolation
 *    - Staging and main are COMPLETELY isolated
 *    - Operations reference either staging or main NFT
 *    - Cannot mix (staging operation cannot use main logic)
 *
 * 4. Authorization
 *    - Stage operation: requires staging_gov_auth
 *    - Promote operation: requires main_gov_auth
 *    - Both validate Council + TechAuth multisig
 *
 * 5. Redeemer Structure
 *    - TwoStageRedeemer: [UpdateField, WhichStage]
 *    - UpdateField can be: UpdateLogic, UpdateAuth, UpdateMitigationLogic, UpdateMitigationAuth
 *    - WhichStage: references the OTHER stage's UTxO
 *      - For staging update: references main UTxO
 *      - For promote: references staging UTxO
 *
 * 6. NFT Constraints
 *    - NFTs must stay at two-stage address
 *    - Cannot accrue other tokens
 *    - Datum structure must be preserved
 *
 * DEPENDENCIES:
 * - Requires Journey 1 (Governance) completed
 * - Can test with Council, TechAuth, or Reserve two-stage
 * - This journey uses Council for consistency
 *
 * TEST PATTERNS:
 * - We'll test the upgrade lifecycle on Council
 * - Same patterns apply to TechAuth, Reserve, FedOps, etc.
 */
export const twoStageUpgradeJourney: JourneyDefinition = {
  id: "two-stage-upgrade",
  name: "Two-Stage Upgrade Lifecycle",
  description: "Test staging, isolation, promotion, and downgrade flows",
  reuseContracts: false, // Must deploy own governance due to emulator reset
  steps: [
    // ========================================================================
    // PHASE 0: SETUP
    // ========================================================================
    {
      id: "setup-deploy-governance",
      name: "Phase 0: Deploy governance contracts",
      description: "Deploy Council, TechAuth, Thresholds (prerequisites for two-stage upgrade testing)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("setup-deploy-governance", this.name);

        try {
          const { deployGovernanceContracts } = await import("../lib/test-helpers");
          const { councilTxHash, techAuthTxHash, thresholdsTxHash, registerTxHash } =
            await deployGovernanceContracts(ctx);

          console.log(`  ✓ Council: ${councilTxHash.substring(0, 16)}...`);
          console.log(`  ✓ TechAuth: ${techAuthTxHash.substring(0, 16)}...`);
          console.log(`  ✓ Thresholds: ${thresholdsTxHash.substring(0, 16)}...`);
          console.log(`  ✓ Stake registration: ${registerTxHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "Governance contracts deployed");
        } catch (error) {
          return completeTestResult(
            result,
            "failed",
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },

    // ========================================================================
    // PHASE 1: ABORT LOGIC UPGRADE PATTERN
    // ========================================================================
    {
      id: "stage-abort-logic",
      name: "Phase 1.1: Stage 'always fails' logic to Council staging",
      description: "Update Council staging UTxO with always-fails validator",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("stage-abort-logic", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Staging 'always fails' logic to Council staging...");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs using helpers
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current staging state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          console.log(`  Current staging logic: ${currentState[0].substring(0, 16)}...`);

          // Get always_fails validator hash
          const alwaysFails = await contracts.getAlwaysFails();
          const alwaysFailsHash = alwaysFails.Script.hash();

          // Build redeemer and new state
          const { redeemer } = buildStagingRedeemer(mainUtxo, alwaysFailsHash, "Logic");
          const newState: typeof Contracts.UpgradeState = [
            alwaysFailsHash, currentState[1], currentState[2],
            currentState[3], currentState[4], currentState[5] + 1n,
          ];

          // Build transaction
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
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Staged abort logic: ${txHash.substring(0, 16)}...`);

          // Store state for later phases
          ctx.journeyState.metadata = {
            ...ctx.journeyState.metadata,
            abortLogicHash: alwaysFailsHash,
            originalLogicHash: currentState[0],
          };

          return completeTestResult(result, "passed", "Abort logic staged to Council staging");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "test-staging-fails",
      name: "Phase 1.2: Verify Council staging operations fail",
      description: "Attempt staging operation, confirm it fails with abort logic",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("test-staging-fails", this.name);

        // SKIPPED: Current contract architecture doesn't support testing staging logic in isolation
        //
        // The forever contract (FC-4) is hardcoded to look for "main" NFT:
        //   is_singleton(input.output.value, two_stage_hash, "main")
        //
        // There's infrastructure in lib/logic/next_version.ak for staging testing via StagingState,
        // but these functions are prefixed "unused_" and not wired into the current validators.
        //
        // The StagingState type would allow:
        //   - Deploying a separate "staging forever" contract
        //   - Storing its hash in StagingState datum
        //   - Logic scripts branching to use staging vs main forever
        //
        // Until this is wired up, staging logic can only be tested by promoting to main.
        // Phase 2.4+ tests the full promote cycle.

        console.log("  ⚠️  SKIPPED: Contract architecture doesn't support staging logic isolation testing");
        console.log("     The forever contract (FC-4) always references 'main' NFT, not 'staging'");
        console.log("     Infrastructure exists in lib/logic/next_version.ak (StagingState) but is unused");
        console.log("     Staging logic can only be tested after promotion - see Phase 2.4+");

        return completeTestResult(
          result,
          "skipped",
          "CONTRACT ARCHITECTURE: Forever contracts always reference 'main' two-stage NFT. " +
          "Staging logic isolation requires StagingState infrastructure (in next_version.ak) to be wired up. " +
          "Awaiting response from contracts team. Staging logic is tested via promotion in Phase 2.4+."
        );
      },
    },
    {
      id: "test-main-still-works",
      name: "Phase 1.3: Verify Council main operations still work",
      description: "Confirm main logic unchanged and functional (isolation from staging)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("test-main-still-works", this.name);

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze, address } = await getTestSetup(ctx);
          const { TransactionId, TransactionInput, addressFromValidator } = await import("@blaze-cardano/core");

          console.log("  Verifying Council main operations still work after staging update...");
          console.log("  (This proves main is isolated from staging changes)");

          // Get contract instances
          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const thresholdsContracts = await contracts.getThresholds();
          const govAuth = await contracts.getGovAuth();

          // Query UTxOs from all relevant contracts
          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
          }, 0);

          // Find the main two-stage UTxO (NOT staging!)
          const mainAssetName = toHex(new TextEncoder().encode("main"));
          const mainAssetId = AssetId(council.twoStage.Script.hash() + mainAssetName);

          const councilTwoStageMainUtxo = utxos.councilTwoStage.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            if (!assets) return false;
            return (assets.get(mainAssetId) ?? 0n) === 1n;
          });

          // Find council forever UTxO (the one with the NFT)
          const councilForeverNftId = AssetId(council.forever.Script.hash());
          const councilForeverUtxo = utxos.councilForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            if (!assets) return false;
            return (assets.get(councilForeverNftId) ?? 0n) === 1n;
          });

          // Find techAuth forever UTxO
          const techAuthForeverNftId = AssetId(techAuth.forever.Script.hash());
          const techAuthForeverUtxo = utxos.techAuthForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            if (!assets) return false;
            return (assets.get(techAuthForeverNftId) ?? 0n) === 1n;
          });

          // Find threshold UTxO
          const thresholdNftId = AssetId(thresholdsContracts.mainCouncilUpdate.Script.hash());
          const councilUpdateThresholdUtxo = utxos.threshold.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            if (!assets) return false;
            return (assets.get(thresholdNftId) ?? 0n) === 1n;
          });

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            const missing = [];
            if (!councilForeverUtxo) missing.push("councilForever");
            if (!councilTwoStageMainUtxo) missing.push("councilTwoStageMain");
            if (!techAuthForeverUtxo) missing.push("techAuthForever");
            if (!councilUpdateThresholdUtxo) missing.push("councilUpdateThreshold");
            throw new Error(`Required UTxOs not found: ${missing.join(", ")}`);
          }

          console.log("  ✓ Found all required UTxOs (using MAIN two-stage, not staging)");

          // Read current Council state
          const currentCouncilState = await readVersionedMultisigState(councilForeverUtxo);
          const [[currentSignerCount, currentSigners], currentRound] = currentCouncilState;

          // Read threshold state
          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          // Use the SAME signers to prove the operation works without breaking authorization
          // If we used different signers, subsequent phases wouldn't be able to authorize
          // (we'd need keys for those random test hashes)
          const newSigners = currentSigners;

          console.log(`  Current Council: ${currentSignerCount} signers, round ${currentRound}`);
          console.log(`  Re-submitting same signers (proves operation works, preserves authorization)...`);

          // Build update transaction - this references MAIN two-stage UTxO
          // The forever contract (FC-4) will read logic_hash from MAIN (not staging)
          // Since main still has the original council_logic, this should succeed
          const txBuilder = await buildUpdateCouncilMembersTx({
            blaze,
            councilForeverScript: council.forever.Script,
            councilTwoStageScript: council.twoStage.Script,
            councilLogicScript: council.logic.Script,
            techAuthForeverScript: techAuth.forever.Script,
            govAuthScript: govAuth.Script,
            councilForeverUtxo,
            councilTwoStageMainUtxo,
            councilUpdateThresholdUtxo,
            techAuthForeverUtxo,
            newSigners,
            currentSigners,
            currentRound,
            councilThreshold: { numerator: councilNum, denominator: councilDenom },
            techAuthThreshold: { numerator: techAuthNum, denominator: techAuthDenom },
            networkId: 0,
          });

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

          console.log(`  ✓ Council members updated successfully! TxHash: ${txHash.substring(0, 16)}...`);
          console.log(`    This proves main operations are ISOLATED from staging changes`);
          console.log(`    (Staging has always_fails logic, but main still works)`);

          // Verify the update worked
          const [newCouncilForeverUtxo] = await blaze.provider.resolveUnspentOutputs([
            TransactionInput.fromCore({
              txId: TransactionId(txHash),
              index: 0, // Council forever UTxO should be first output
            }),
          ]);

          if (!newCouncilForeverUtxo) {
            throw new Error("New Council forever UTxO not found after update");
          }

          const newCouncilState = await readVersionedMultisigState(newCouncilForeverUtxo);
          const [[newSignerCount, updatedSigners], newRound] = newCouncilState;

          if (newRound !== currentRound) {
            throw new Error(`Round changed from ${currentRound} to ${newRound}! Member updates should not increment round.`);
          }

          result.txHash = txHash;
          return completeTestResult(
            result,
            "passed",
            `Main operations work despite staging having always_fails logic. ` +
            `Council operation succeeded (${currentSignerCount} signers, round ${currentRound}). ` +
            `This proves staging/main isolation.`
          );
        } catch (error) {
          return completeTestResult(
            result,
            "failed",
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },
    {
      id: "revert-staging-logic",
      name: "Phase 1.4: Revert Council staging to original logic",
      description: "Update staging back to working logic",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("revert-staging-logic", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Reverting Council staging to original logic...");

          const originalLogicHash = ctx.journeyState.metadata?.originalLogicHash;
          if (!originalLogicHash) {
            throw new Error("Original logic hash not found in metadata. Did Phase 1.1 run?");
          }

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs using helpers
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current state and build new state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          const { redeemer } = buildStagingRedeemer(mainUtxo, originalLogicHash, "Logic");
          const newState: typeof Contracts.UpgradeState = [
            originalLogicHash, currentState[1], currentState[2],
            currentState[3], currentState[4], currentState[5] + 1n,
          ];

          // Build transaction
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
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Reverted staging to original logic: ${txHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "Staging reverted to original council_logic.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-staging-restored",
      name: "Phase 1.5: Verify staging operations work again",
      description: "Confirm staging is functional after revert",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-staging-restored", this.name);

        // SKIPPED: Same architecture limitation as Phase 1.2
        // Forever contracts always reference "main" NFT, not "staging"
        // We cannot test staging logic in isolation without the StagingState infrastructure

        console.log("  ⚠️  SKIPPED: Same architecture limitation as Phase 1.2");
        console.log("     Forever contracts always reference 'main' NFT, cannot test staging in isolation");
        console.log("     The revert in Phase 1.4 was successful - staging has original logic");
        console.log("     But we cannot verify staging operations without StagingState infrastructure");

        return completeTestResult(
          result,
          "skipped",
          "CONTRACT ARCHITECTURE: Same limitation as Phase 1.2. " +
          "Cannot test staging logic in isolation. Phase 1.4 successfully reverted staging."
        );
      },
    },

    // ========================================================================
    // PHASE 2: SUCCESSFUL UPGRADE
    // ========================================================================
    {
      id: "stage-new-logic",
      name: "Phase 2.1: Stage new logic hash to Council staging",
      description: "Update staging with hypothetical new logic version",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("stage-new-logic", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Staging new logic (techAuth.logic) to Council staging...");

          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const govAuth = await contracts.getGovAuth();

          // Get "new" logic hash - using techAuth.logic as our test "new version"
          const newLogicHash = techAuth.logic.Script.hash();

          // Get UTxOs using helpers
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current state and build new state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          const originalLogicOnMain = ctx.journeyState.metadata?.originalLogicHash || currentState[0];
          const { redeemer } = buildStagingRedeemer(mainUtxo, newLogicHash, "Logic");
          const newState: typeof Contracts.UpgradeState = [
            newLogicHash, currentState[1], currentState[2],
            currentState[3], currentState[4], currentState[5] + 1n,
          ];

          // Build transaction
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
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Staged new logic: ${txHash.substring(0, 16)}...`);

          // Store for later phases
          ctx.journeyState.metadata = { ...ctx.journeyState.metadata, newLogicHash, originalLogicOnMain };

          return completeTestResult(result, "passed", `Staged techAuth.logic to Council staging.`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "test-new-logic-on-staging",
      name: "Phase 2.2: Test new logic applies to staging",
      description: "Verify staging operations use new logic",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("test-new-logic-on-staging", this.name);

        // SKIPPED: Same architecture limitation as Phase 1.2
        // Forever contracts always reference "main" NFT, not "staging"
        // We cannot test staging logic in isolation without StagingState infrastructure

        console.log("  ⚠️  SKIPPED: Same architecture limitation as Phase 1.2");
        console.log("     Forever contracts always reference 'main' NFT, cannot test staging in isolation");
        console.log("     New logic staged to staging, but can only be tested after promotion");
        console.log("     See Phase 2.5 for verification after promotion to main");

        return completeTestResult(
          result,
          "skipped",
          "CONTRACT ARCHITECTURE: Same limitation as Phase 1.2. " +
          "Forever contracts always reference 'main' two-stage NFT. " +
          "Staging logic will be tested after promotion in Phase 2.5."
        );
      },
    },
    {
      id: "verify-main-unchanged",
      name: "Phase 2.3: Verify main still uses old logic",
      description: "Confirm main logic not affected by staging changes",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-main-unchanged", this.name);

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze, address } = await getTestSetup(ctx);
          const { TransactionId, TransactionInput, addressFromValidator } = await import("@blaze-cardano/core");

          console.log("  Verifying main still uses original logic after staging update...");
          console.log("  (Staging has techAuth.logic, main should still have council_logic)");

          // Get contract instances
          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const thresholdsContracts = await contracts.getThresholds();
          const govAuth = await contracts.getGovAuth();

          // Query UTxOs from all relevant contracts
          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
          }, 0);

          // Find the main two-stage UTxO (NOT staging!)
          const mainAssetName = toHex(new TextEncoder().encode("main"));
          const mainAssetId = AssetId(council.twoStage.Script.hash() + mainAssetName);

          const councilTwoStageMainUtxo = utxos.councilTwoStage.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            if (!assets) return false;
            return (assets.get(mainAssetId) ?? 0n) === 1n;
          });

          // Find council forever UTxO (the one with the NFT)
          const councilForeverNftId = AssetId(council.forever.Script.hash());
          const councilForeverUtxo = utxos.councilForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            if (!assets) return false;
            return (assets.get(councilForeverNftId) ?? 0n) === 1n;
          });

          // Find techAuth forever UTxO
          const techAuthForeverNftId = AssetId(techAuth.forever.Script.hash());
          const techAuthForeverUtxo = utxos.techAuthForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            if (!assets) return false;
            return (assets.get(techAuthForeverNftId) ?? 0n) === 1n;
          });

          // Find threshold UTxO
          const thresholdNftId = AssetId(thresholdsContracts.mainCouncilUpdate.Script.hash());
          const councilUpdateThresholdUtxo = utxos.threshold.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            if (!assets) return false;
            return (assets.get(thresholdNftId) ?? 0n) === 1n;
          });

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            const missing = [];
            if (!councilForeverUtxo) missing.push("councilForever");
            if (!councilTwoStageMainUtxo) missing.push("councilTwoStageMain");
            if (!techAuthForeverUtxo) missing.push("techAuthForever");
            if (!councilUpdateThresholdUtxo) missing.push("councilUpdateThreshold");
            throw new Error(`Required UTxOs not found: ${missing.join(", ")}`);
          }

          console.log("  ✓ Found all required UTxOs (using MAIN two-stage, not staging)");

          // Read current Council state
          const currentCouncilState = await readVersionedMultisigState(councilForeverUtxo);
          const [[currentSignerCount, currentSigners], currentRound] = currentCouncilState;

          // Read threshold state
          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          // Use the SAME signers to prove the operation works without breaking authorization
          // If we used different signers, subsequent phases wouldn't be able to authorize
          const newSigners = currentSigners;

          console.log(`  Current Council: ${currentSignerCount} signers, round ${currentRound}`);
          console.log(`  Re-submitting same signers (proves operation works with original council_logic)...`);

          // Build update transaction - this references MAIN two-stage UTxO
          // The forever contract (FC-4) will read logic_hash from MAIN (which still has council_logic)
          // Since staging has new logic but main is unchanged, this should succeed
          const txBuilder = await buildUpdateCouncilMembersTx({
            blaze,
            councilForeverScript: council.forever.Script,
            councilTwoStageScript: council.twoStage.Script,
            councilLogicScript: council.logic.Script,
            techAuthForeverScript: techAuth.forever.Script,
            govAuthScript: govAuth.Script,
            councilForeverUtxo,
            councilTwoStageMainUtxo,
            councilUpdateThresholdUtxo,
            techAuthForeverUtxo,
            newSigners,
            currentSigners,
            currentRound,
            councilThreshold: { numerator: councilNum, denominator: councilDenom },
            techAuthThreshold: { numerator: techAuthNum, denominator: techAuthDenom },
            networkId: 0,
          });

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

          console.log(`  ✓ Council members updated successfully! TxHash: ${txHash.substring(0, 16)}...`);
          console.log(`    This proves main is ISOLATED from staging changes`);
          console.log(`    (Staging has techAuth.logic, but main still uses council_logic)`);

          result.txHash = txHash;
          return completeTestResult(
            result,
            "passed",
            `Main unchanged while staging has new logic. ` +
            `Council operation succeeded using original council_logic. ` +
            `This proves staging/main isolation before promotion.`
          );
        } catch (error) {
          return completeTestResult(
            result,
            "failed",
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },
    {
      id: "promote-to-main",
      name: "Phase 2.4: Promote staging to main",
      description: "Copy staging UpgradeState to main (complete upgrade)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("promote-to-main", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Promoting staging logic to main...");

          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs using helpers
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current states
          const mainState = parseInlineDatum(mainUtxo, Contracts.UpgradeState, parse);
          const stagingState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          const newLogicHash = techAuth.logic.Script.hash();

          // Build promote redeemer (references staging)
          const { redeemer } = buildPromoteRedeemer(stagingUtxo, "Logic");

          // Promotion copies logic AND logic_round from staging
          const newMainState: typeof Contracts.UpgradeState = [
            newLogicHash, mainState[1], mainState[2],
            mainState[3], mainState[4], stagingState[5],  // logic_round from STAGING
          ];

          // Build transaction - spend MAIN, reference STAGING
          const txBuilder = blaze
            .newTransaction()
            .addInput(mainUtxo, serialize(Contracts.TwoStageRedeemer, redeemer))
            .addReferenceInput(stagingUtxo)
            .addReferenceInput(refUtxos.councilForever)
            .addReferenceInput(refUtxos.techAuthForever)
            .addReferenceInput(refUtxos.thresholds)
            .addMint(PolicyId(councilNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(techAuthNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(mainUtxo.output().address().toBech32()),
                value: {
                  coins: mainUtxo.output().amount().coin(),
                  assets: mainUtxo.output().amount().multiasset() ?? new Map(),
                },
                datum: serialize(Contracts.UpgradeState, newMainState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, redeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Promotion successful! TxHash: ${txHash.substring(0, 16)}...`);

          ctx.journeyState.metadata = { ...ctx.journeyState.metadata, promotedLogicHash: newLogicHash };

          return completeTestResult(result, "passed", `Promotion successful! Main now has techAuth.logic.`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-main-uses-new-logic",
      name: "Phase 2.5: Verify main now uses new logic",
      description: "Confirm main operations use upgraded logic",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-main-uses-new-logic", this.name);

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze, address } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Verifying main now uses the promoted logic...");
          console.log("  (Negative test: operation with OLD logic should FAIL)");

          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const thresholdsContracts = await contracts.getThresholds();
          const govAuth = await contracts.getGovAuth();

          // First, verify the datum was updated
          const { addressFromValidator } = await import("@blaze-cardano/core");
          const councilTwoStageAddress = addressFromValidator(0, council.twoStage.Script);
          const twoStageUtxosSet = await blaze.provider.getUnspentOutputs(councilTwoStageAddress);
          const twoStageUtxos = Array.from(twoStageUtxosSet);

          const mainAssetName = toHex(new TextEncoder().encode("main"));
          const mainAssetId = AssetId(council.twoStage.Script.hash() + mainAssetName);

          const mainTwoStageUtxo = twoStageUtxos.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(mainAssetId) ?? 0n) === 1n;
          });

          if (!mainTwoStageUtxo) {
            throw new Error("Could not find Council main two-stage UTxO");
          }

          const mainState = parseInlineDatum(mainTwoStageUtxo, Contracts.UpgradeState, parse);
          const currentMainLogic = mainState[0];
          const techAuthLogicHash = techAuth.logic.Script.hash();
          const councilLogicHash = council.logic.Script.hash();

          console.log(`  Main's logic_hash: ${currentMainLogic.substring(0, 16)}...`);
          console.log(`  techAuth.logic hash: ${techAuthLogicHash.substring(0, 16)}...`);
          console.log(`  council.logic hash: ${councilLogicHash.substring(0, 16)}...`);

          // Verify datum shows new logic
          if (currentMainLogic !== techAuthLogicHash) {
            throw new Error(
              `Main's logic_hash doesn't match techAuth.logic! ` +
              `Expected: ${techAuthLogicHash}, Got: ${currentMainLogic}`
            );
          }
          console.log(`  ✓ Datum verification: Main has techAuth.logic hash`);

          // Now do negative test: try operation with OLD council.logic - should FAIL
          console.log(`  Testing that old council.logic is rejected...`);

          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
          }, 0);

          const councilTwoStageMainUtxo = utxos.councilTwoStage.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(mainAssetId) ?? 0n) === 1n;
          });

          const councilForeverNftId = AssetId(council.forever.Script.hash());
          const councilForeverUtxo = utxos.councilForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(councilForeverNftId) ?? 0n) === 1n;
          });

          const techAuthForeverNftId = AssetId(techAuth.forever.Script.hash());
          const techAuthForeverUtxo = utxos.techAuthForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(techAuthForeverNftId) ?? 0n) === 1n;
          });

          const thresholdNftId = AssetId(thresholdsContracts.mainCouncilUpdate.Script.hash());
          const councilUpdateThresholdUtxo = utxos.threshold.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(thresholdNftId) ?? 0n) === 1n;
          });

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            throw new Error("Required UTxOs not found for negative test");
          }

          const currentCouncilState = await readVersionedMultisigState(councilForeverUtxo);
          const [[currentSignerCount, currentSigners], currentRound] = currentCouncilState;

          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          // Try operation with OLD council.logic - this should FAIL
          const txBuilder = await buildUpdateCouncilMembersTx({
            blaze,
            councilForeverScript: council.forever.Script,
            councilTwoStageScript: council.twoStage.Script,
            councilLogicScript: council.logic.Script,  // OLD logic - should be rejected!
            techAuthForeverScript: techAuth.forever.Script,
            govAuthScript: govAuth.Script,
            councilForeverUtxo,
            councilTwoStageMainUtxo,
            councilUpdateThresholdUtxo,
            techAuthForeverUtxo,
            newSigners: currentSigners,
            currentSigners,
            currentRound,
            councilThreshold: { numerator: councilNum, denominator: councilDenom },
            techAuthThreshold: { numerator: techAuthNum, denominator: techAuthDenom },
            networkId: 0,
          });

          try {
            await ctx.provider.submitTransaction("deployer", txBuilder);
            // If we get here, the transaction succeeded - that's BAD
            throw new Error(
              "UNEXPECTED: Operation with old council.logic SUCCEEDED! " +
              "The new logic should have been enforced and rejected this."
            );
          } catch (submitError) {
            // Transaction failed - this is EXPECTED
            const errorMsg = submitError instanceof Error ? submitError.message : String(submitError);

            // Check it's actually a validation failure, not some other error
            if (errorMsg.includes("UNEXPECTED")) {
              throw submitError; // Re-throw our own error
            }

            console.log(`  ✓ Negative test passed: Old council.logic was REJECTED`);
            console.log(`    Error (expected): ${errorMsg.substring(0, 80)}...`);
            console.log(`    This PROVES main is enforcing the new logic hash`);
          }

          return completeTestResult(
            result,
            "passed",
            `Verified: Main enforces techAuth.logic. ` +
            `Datum shows new hash, and operation with old council.logic was rejected.`
          );
        } catch (error) {
          return completeTestResult(
            result,
            "failed",
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },

    // ========================================================================
    // PHASE 3: DOWNGRADE
    // ========================================================================
    {
      id: "stage-old-logic-for-downgrade",
      name: "Phase 3.1: Stage previous logic (downgrade preparation)",
      description: "Stage old logic hash back to staging",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("stage-old-logic-for-downgrade", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Staging old logic (council.logic) to staging for downgrade...");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();
          const oldLogicHash = council.logic.Script.hash();

          // Get UTxOs using helpers
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current state and build new state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          const { redeemer } = buildStagingRedeemer(mainUtxo, oldLogicHash, "Logic");
          const newState: typeof Contracts.UpgradeState = [
            oldLogicHash, currentState[1], currentState[2],
            currentState[3], currentState[4], currentState[5] + 1n,
          ];

          // Build transaction
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
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Staged old logic for downgrade: ${txHash.substring(0, 16)}...`);

          ctx.journeyState.metadata = { ...ctx.journeyState.metadata, stagedOldLogicHash: oldLogicHash };

          return completeTestResult(result, "passed", `Staged council.logic to staging for downgrade.`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-downgrade-isolation",
      name: "Phase 3.2: Verify staging has old logic, main has new",
      description: "Test both logics work in parallel",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-downgrade-isolation", this.name);

        // SKIPPED: Same architecture limitation as Phase 1.2 and 2.2
        // Forever contracts always reference "main" NFT, not "staging"
        // We cannot test staging logic in isolation

        console.log("  ⚠️  SKIPPED: Same architecture limitation as Phases 1.2 and 2.2");
        console.log("     Forever contracts always reference 'main' NFT, cannot test staging in isolation");
        console.log("     Staging has council.logic, main has techAuth.logic");
        console.log("     Downgrade will be tested via promotion in Phase 3.3");

        return completeTestResult(
          result,
          "skipped",
          "CONTRACT ARCHITECTURE: Same limitation as Phases 1.2/2.2. " +
          "Cannot test staging logic in isolation. Downgrade tested via promotion."
        );
      },
    },
    {
      id: "promote-downgrade",
      name: "Phase 3.3: Promote staging to main (complete downgrade)",
      description: "Copy staging (old logic) to main",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("promote-downgrade", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Promoting old logic (council.logic) from staging to main...");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();
          const oldLogicHash = council.logic.Script.hash();

          // Get UTxOs using helpers
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current states
          const mainState = parseInlineDatum(mainUtxo, Contracts.UpgradeState, parse);
          const stagingState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);

          // Build promote redeemer and new state
          const { redeemer } = buildPromoteRedeemer(stagingUtxo, "Logic");
          const newMainState: typeof Contracts.UpgradeState = [
            oldLogicHash, mainState[1], mainState[2],
            mainState[3], mainState[4], stagingState[5],  // logic_round from STAGING
          ];

          // Build transaction - spend MAIN, reference STAGING
          const txBuilder = blaze
            .newTransaction()
            .addInput(mainUtxo, serialize(Contracts.TwoStageRedeemer, redeemer))
            .addReferenceInput(stagingUtxo)
            .addReferenceInput(refUtxos.councilForever)
            .addReferenceInput(refUtxos.techAuthForever)
            .addReferenceInput(refUtxos.thresholds)
            .addMint(PolicyId(councilNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(techAuthNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(mainUtxo.output().address().toBech32()),
                value: {
                  coins: mainUtxo.output().amount().coin(),
                  assets: mainUtxo.output().amount().multiasset() ?? new Map(),
                },
                datum: serialize(Contracts.UpgradeState, newMainState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, redeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Downgrade promotion successful! TxHash: ${txHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", `Downgrade complete! Main now has council.logic.`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-downgrade-complete",
      name: "Phase 3.4: Verify main uses old logic after downgrade",
      description: "Confirm downgrade successful",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-downgrade-complete", this.name);

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze, address } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Verifying downgrade complete - main should use council.logic again...");

          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const thresholdsContracts = await contracts.getThresholds();
          const govAuth = await contracts.getGovAuth();

          // First verify datum
          const { addressFromValidator } = await import("@blaze-cardano/core");
          const councilTwoStageAddress = addressFromValidator(0, council.twoStage.Script);
          const twoStageUtxosSet = await blaze.provider.getUnspentOutputs(councilTwoStageAddress);
          const twoStageUtxos = Array.from(twoStageUtxosSet);

          const mainAssetName = toHex(new TextEncoder().encode("main"));
          const mainAssetId = AssetId(council.twoStage.Script.hash() + mainAssetName);

          const mainTwoStageUtxo = twoStageUtxos.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(mainAssetId) ?? 0n) === 1n;
          });

          if (!mainTwoStageUtxo) {
            throw new Error("Could not find Council main two-stage UTxO");
          }

          const mainState = parseInlineDatum(mainTwoStageUtxo, Contracts.UpgradeState, parse);
          const currentMainLogic = mainState[0];
          const councilLogicHash = council.logic.Script.hash();
          const techAuthLogicHash = techAuth.logic.Script.hash();

          console.log(`  Main's logic_hash: ${currentMainLogic.substring(0, 16)}...`);
          console.log(`  council.logic hash: ${councilLogicHash.substring(0, 16)}...`);
          console.log(`  techAuth.logic hash: ${techAuthLogicHash.substring(0, 16)}...`);

          // Verify datum shows old logic
          if (currentMainLogic !== councilLogicHash) {
            throw new Error(
              `Main's logic_hash doesn't match council.logic! ` +
              `Expected: ${councilLogicHash}, Got: ${currentMainLogic}`
            );
          }
          console.log(`  ✓ Datum verification: Main has council.logic hash`);

          // Now perform actual operation with council.logic - should succeed
          console.log(`  Testing Council operation with council.logic...`);

          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
          }, 0);

          const councilTwoStageMainUtxo = utxos.councilTwoStage.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(mainAssetId) ?? 0n) === 1n;
          });

          const councilForeverNftId = AssetId(council.forever.Script.hash());
          const councilForeverUtxo = utxos.councilForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(councilForeverNftId) ?? 0n) === 1n;
          });

          const techAuthForeverNftId = AssetId(techAuth.forever.Script.hash());
          const techAuthForeverUtxo = utxos.techAuthForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(techAuthForeverNftId) ?? 0n) === 1n;
          });

          const thresholdNftId = AssetId(thresholdsContracts.mainCouncilUpdate.Script.hash());
          const councilUpdateThresholdUtxo = utxos.threshold.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(thresholdNftId) ?? 0n) === 1n;
          });

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            throw new Error("Required UTxOs not found");
          }

          const currentCouncilState = await readVersionedMultisigState(councilForeverUtxo);
          const [[currentSignerCount, currentSigners], currentRound] = currentCouncilState;

          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          // Build transaction with council.logic (original logic) - should succeed after downgrade
          const txBuilder = await buildUpdateCouncilMembersTx({
            blaze,
            councilForeverScript: council.forever.Script,
            councilTwoStageScript: council.twoStage.Script,
            councilLogicScript: council.logic.Script,  // Original logic - should work now!
            techAuthForeverScript: techAuth.forever.Script,
            govAuthScript: govAuth.Script,
            councilForeverUtxo,
            councilTwoStageMainUtxo,
            councilUpdateThresholdUtxo,
            techAuthForeverUtxo,
            newSigners: currentSigners,
            currentSigners,
            currentRound,
            councilThreshold: { numerator: councilNum, denominator: councilDenom },
            techAuthThreshold: { numerator: techAuthNum, denominator: techAuthDenom },
            networkId: 0,
          });

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

          console.log(`  ✓ Council operation succeeded with council.logic! TxHash: ${txHash.substring(0, 16)}...`);
          console.log(`    DOWNGRADE VERIFIED: Main is back to original council.logic`);
          console.log(`    Full upgrade/downgrade cycle complete:`);
          console.log(`      - Original: council.logic`);
          console.log(`      - Upgrade: techAuth.logic`);
          console.log(`      - Downgrade: council.logic (restored)`);

          result.txHash = txHash;
          return completeTestResult(
            result,
            "passed",
            `Downgrade verified! Council operation succeeded with original council.logic. ` +
            `Full upgrade/downgrade lifecycle complete.`
          );
        } catch (error) {
          return completeTestResult(
            result,
            "failed",
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },

    // ========================================================================
    // PHASE 4: NFT CONSTRAINTS
    // ========================================================================
    {
      id: "negative-move-main-nft",
      name: "Phase 4.1: Attempt to move main NFT from two-stage contract",
      description: "Verify main NFT cannot leave two-stage address",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-move-main-nft", this.name);

        try {
          const { contracts, blaze, address } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Testing that NFT cannot be moved from two-stage contract...");
          console.log("  (Negative test: should FAIL)");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs using helpers
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current state and build redeemer
          const currentState = parseInlineDatum(mainUtxo, Contracts.UpgradeState, parse);
          const { redeemer } = buildStagingRedeemer(mainUtxo, council.logic.Script.hash(), "Logic");
          const newState: typeof Contracts.UpgradeState = [
            council.logic.Script.hash(), currentState[1], currentState[2],
            currentState[3], currentState[4], currentState[5] + 1n,
          ];

          // Build transaction that sends NFT to WALLET instead of contract (should fail)
          const walletAddress = address.toBech32();

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
                address: PaymentAddress(walletAddress),  // WRONG - should be contract address
                value: {
                  coins: stagingUtxo.output().amount().coin(),
                  assets: stagingUtxo.output().amount().multiasset() ?? new Map(),
                },
                datum: serialize(Contracts.UpgradeState, newState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, redeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", txBuilder); },
            { description: "moving NFT to wallet" }
          );

          if (!rejection.passed) {
            throw new Error(`UNEXPECTED: ${rejection.message}`);
          }

          console.log(`  ✓ Negative test passed: Moving NFT was REJECTED`);

          return completeTestResult(result, "passed", `NFT movement blocked. Contract enforces TS-6/TS-7.`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "negative-accrue-tokens",
      name: "Phase 4.2: Attempt to add garbage tokens to two-stage UTxO",
      description: "Verify cannot accrue random tokens (token dust attack prevention)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-accrue-tokens", this.name);

        try {
          const { contracts, blaze, address } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");
          const { NativeScripts, Script, Credential, CredentialType, addressFromCredential, Hash28ByteBase16 } =
            await import("@blaze-cardano/core");

          console.log("  Testing that two-stage UTxO cannot accrue garbage tokens...");
          console.log("  (Negative test: should FAIL)");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs using helpers
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current state and build redeemer
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          const { redeemer } = buildStagingRedeemer(mainUtxo, council.logic.Script.hash(), "Logic");
          const newState: typeof Contracts.UpgradeState = [
            council.logic.Script.hash(), currentState[1], currentState[2],
            currentState[3], currentState[4], currentState[5] + 1n,
          ];

          // Create garbage token with unique policy (using allOf instead of atLeastNOfK)
          const stakeHash = address.asBase()?.getStakeCredential()?.hash!;
          const techAuthBech32 = addressFromCredential(0, Credential.fromCore({
            type: CredentialType.KeyHash, hash: Hash28ByteBase16(stakeHash),
          })).toBech32();
          const garbageNativeScript = Script.newNativeScript(NativeScripts.allOf(NativeScripts.justAddress(techAuthBech32, 0)));
          const garbagePolicyId = garbageNativeScript.hash();
          const garbageAssetName = toHex(new TextEncoder().encode("garbage"));
          const garbageAssetId = AssetId(garbagePolicyId + garbageAssetName);

          // Add garbage token to existing assets
          const existingAssets = stagingUtxo.output().amount().multiasset() ?? new Map();
          const newAssets = new Map(existingAssets);
          newAssets.set(garbageAssetId, 1n);

          const txBuilder = blaze
            .newTransaction()
            .addInput(stagingUtxo, serialize(Contracts.TwoStageRedeemer, redeemer))
            .addReferenceInput(mainUtxo)
            .addReferenceInput(refUtxos.councilForever)
            .addReferenceInput(refUtxos.techAuthForever)
            .addReferenceInput(refUtxos.thresholds)
            .addMint(PolicyId(councilNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(techAuthNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(garbagePolicyId), new Map([[AssetName(garbageAssetName), 1n]]))
            .provideScript(garbageNativeScript)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(stagingUtxo.output().address().toBech32()),
                value: { coins: stagingUtxo.output().amount().coin(), assets: newAssets },
                datum: serialize(Contracts.UpgradeState, newState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, redeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", txBuilder); },
            { description: "adding garbage tokens" }
          );

          if (!rejection.passed) {
            throw new Error(`UNEXPECTED: ${rejection.message}`);
          }

          console.log(`  ✓ Negative test passed: Adding garbage tokens was REJECTED`);

          return completeTestResult(result, "passed", `Token dust attack blocked.`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "negative-change-datum-structure",
      name: "Phase 4.3: Attempt to change UpgradeState structure",
      description: "Verify datum structure must be preserved",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-change-datum-structure", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Testing that UpgradeState structure cannot be changed...");
          console.log("  (Negative test: should FAIL)");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs using helpers
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);

          // Build redeemer using helper
          const { redeemer } = buildStagingRedeemer(mainUtxo, council.logic.Script.hash(), "Logic");

          // Build a WRONG datum - use round + 1 instead of logic_round + 1
          // The contract expects logic_round to be incremented for Logic operations,
          // but we'll increment round instead (which should stay the same for Logic ops)
          console.log(`  Attempting to use wrong field update pattern...`);
          console.log(`  (Contract expects logic_round+1, we'll increment round instead)`);

          const wrongState: typeof Contracts.UpgradeState = [
            council.logic.Script.hash(),  // logic_hash: correct
            currentState[1],              // mitigation_logic_hash: correct
            currentState[2],              // auth_hash: correct
            currentState[3],              // mitigation_auth_hash: correct
            currentState[4] + 1n,         // round: WRONG - should stay same for Logic
            currentState[5],              // logic_round: WRONG - should be +1 for Logic
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
                datum: serialize(Contracts.UpgradeState, wrongState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, redeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", txBuilder); },
            { description: "wrong datum structure" }
          );

          if (!rejection.passed) {
            throw new Error(`UNEXPECTED: ${rejection.message}`);
          }

          console.log(`  ✓ Negative test passed: Wrong datum was REJECTED`);
          console.log(`    Contract enforces exact datum structure via TS-8`);

          return completeTestResult(
            result,
            "passed",
            `Datum structure enforced. Contract rejects outputs with incorrect field updates.`
          );
        } catch (error) {
          return completeTestResult(
            result,
            "failed",
            undefined,
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },
  ],
};
