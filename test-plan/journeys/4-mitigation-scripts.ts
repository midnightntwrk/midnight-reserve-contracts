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
  PaymentAddress,
  TransactionOutput,
  PolicyId,
  AssetName,
} from "@blaze-cardano/core";
import { serialize, parse } from "@blaze-cardano/data";

/**
 * Journey 4: Mitigation Scripts (Circuit Breakers)
 *
 * Tests that mitigation scripts can be added but NEVER removed.
 * Mitigations are permanent safety mechanisms.
 *
 * ARCHITECTURE:
 * - UpgradeState has mitigation_logic and mitigation_auth fields
 * - Once set to non-empty, they CANNOT be removed or set back to ""
 * - This prevents weakening security after adding safeguards
 *
 * UpgradeState field indices:
 *   [0] logic
 *   [1] mitigation_logic
 *   [2] auth
 *   [3] mitigation_auth
 *   [4] round
 *   [5] logic_round
 *
 * For MitigationLogic/MitigationAuth operations, the round (index 4) is incremented.
 * For Logic operations, the logic_round (index 5) is incremented.
 */
export const mitigationScriptsJourney: JourneyDefinition = {
  id: "mitigation-scripts",
  name: "Mitigation Scripts & Circuit Breakers",
  description: "Test adding mitigations and verify they cannot be removed",
  reuseContracts: false, // Need fresh deployment for mitigation tests
  steps: [
    // ========================================================================
    // PHASE 0: SETUP
    // ========================================================================
    {
      id: "setup-deploy-governance",
      name: "Phase 0: Deploy governance contracts",
      description: "Deploy Council, TechAuth, Thresholds (prerequisites for mitigation testing)",
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
    // PHASE 1: MITIGATION LOGIC
    // ========================================================================
    {
      id: "add-mitigation-logic",
      name: "Phase 1.1: Add mitigation logic script",
      description: "Stage and promote mitigation_logic to Council",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("add-mitigation-logic", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Adding mitigation_logic to Council via stage + promote...");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Get always_fails as the mitigation script
          const alwaysFails = await contracts.getAlwaysFails();
          const mitigationHash = alwaysFails.Script.hash();
          console.log(`  Mitigation hash (always_fails): ${mitigationHash.substring(0, 16)}...`);

          // === STEP 1: Stage mitigation_logic ===
          console.log("\n  Step 1: Staging mitigation_logic...");

          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current staging state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          console.log(`  Current mitigation_logic: "${currentState[1]}" (should be empty)`);

          if (currentState[1] !== "") {
            throw new Error("mitigation_logic is already set - cannot test adding it");
          }

          // Build staging redeemer for MitigationLogic
          const { redeemer: stagingRedeemer } = buildStagingRedeemer(mainUtxo, mitigationHash, "MitigationLogic");

          // New state: set mitigation_logic, increment round
          const stagedState: typeof Contracts.UpgradeState = [
            currentState[0],      // logic: unchanged
            mitigationHash,       // mitigation_logic: NEW
            currentState[2],      // auth: unchanged
            currentState[3],      // mitigation_auth: unchanged
            currentState[4] + 1n, // round: incremented for MitigationLogic ops
            currentState[5],      // logic_round: unchanged
          ];

          // Build staging transaction
          const stagingTxBuilder = blaze
            .newTransaction()
            .addInput(stagingUtxo, serialize(Contracts.TwoStageRedeemer, stagingRedeemer))
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
                datum: serialize(Contracts.UpgradeState, stagedState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, stagingRedeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const stagingTxHash = await ctx.provider.submitTransaction("deployer", stagingTxBuilder);
          console.log(`  ✓ Staged mitigation_logic: ${stagingTxHash.substring(0, 16)}...`);

          // === STEP 2: Promote to main ===
          console.log("\n  Step 2: Promoting mitigation_logic to main...");

          // Re-query UTxOs after staging
          const { main: mainUtxo2, staging: stagingUtxo2 } = await getTwoStageUtxos(ctx, council.twoStage.Script);

          // Build promote redeemer
          const { redeemer: promoteRedeemer } = buildPromoteRedeemer(stagingUtxo2, "MitigationLogic");

          // Read staging state (which now has the mitigation)
          const stagedStateActual = parseInlineDatum(stagingUtxo2, Contracts.UpgradeState, parse);

          // Read main state
          const mainState = parseInlineDatum(mainUtxo2, Contracts.UpgradeState, parse);
          console.log(`  Main mitigation_logic before promote: "${mainState[1]}" (should be empty)`);

          // Promoted state: copy mitigation_logic from staging to main
          const promotedState: typeof Contracts.UpgradeState = [
            mainState[0],            // logic: keep main's value
            stagedStateActual[1],    // mitigation_logic: from staging
            mainState[2],            // auth: keep main's value
            mainState[3],            // mitigation_auth: keep main's value
            stagedStateActual[4],    // round: from staging
            mainState[5],            // logic_round: keep main's value
          ];

          // Build promote transaction
          const promoteTxBuilder = blaze
            .newTransaction()
            .addInput(mainUtxo2, serialize(Contracts.TwoStageRedeemer, promoteRedeemer))
            .addReferenceInput(stagingUtxo2)
            .addReferenceInput(refUtxos.councilForever)
            .addReferenceInput(refUtxos.techAuthForever)
            .addReferenceInput(refUtxos.thresholds)
            .addMint(PolicyId(councilNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(techAuthNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(mainUtxo2.output().address().toBech32()),
                value: {
                  coins: mainUtxo2.output().amount().coin(),
                  assets: mainUtxo2.output().amount().multiasset() ?? new Map(),
                },
                datum: serialize(Contracts.UpgradeState, promotedState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, promoteRedeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const promoteTxHash = await ctx.provider.submitTransaction("deployer", promoteTxBuilder);
          console.log(`  ✓ Promoted mitigation_logic: ${promoteTxHash.substring(0, 16)}...`);

          // Verify final state
          const { main: finalMainUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const finalState = parseInlineDatum(finalMainUtxo, Contracts.UpgradeState, parse);
          console.log(`  Final main mitigation_logic: ${finalState[1].substring(0, 16)}...`);

          if (finalState[1] !== mitigationHash) {
            throw new Error(`mitigation_logic not set correctly: expected ${mitigationHash}, got ${finalState[1]}`);
          }

          // Store for later phases
          ctx.journeyState.metadata = {
            ...ctx.journeyState.metadata,
            mitigationLogicHash: mitigationHash,
          };

          return completeTestResult(result, "passed", "Mitigation logic added to Council main UpgradeState");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-mitigation-enforced",
      name: "Phase 1.2: Verify mitigation logic is enforced",
      description: "Test that mitigation logic runs alongside main logic",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-mitigation-enforced", this.name);

        // The forever contract (FC-9) calls validate_running(logic, mitigation_logic, withdrawals)
        // This requires withdrawals from BOTH logic AND mitigation_logic (if non-empty)
        // Since mitigation_logic = always_fails, ANY operation should now fail!

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { generateTestSigners } = await import("../lib/test-helpers");
          const { contracts, blaze, address } = await getTestSetup(ctx);

          console.log("  Testing that Council operations fail after mitigation_logic = always_fails...");
          console.log("  (Negative test: operation should FAIL because always_fails blocks withdrawals)");

          // Get deployments
          const councilDeployment = getDeployment(ctx, "council");
          const thresholdsDeployment = getDeployment(ctx, "thresholds");
          const techAuthDeployment = getDeployment(ctx, "techAuth");

          if (!councilDeployment || !thresholdsDeployment || !techAuthDeployment) {
            throw new Error("Required deployments not found");
          }

          // Get contract instances
          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const thresholdsContracts = await contracts.getThresholds();
          const govAuth = await contracts.getGovAuth();

          // Query two-stage UTxOs using helper (they were moved by Phase 1.1)
          const { main: councilTwoStageMainUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);

          // Query other UTxOs by address
          const { addressFromValidator, AssetId } = await import("@blaze-cardano/core");

          const councilForeverAddress = addressFromValidator(0, council.forever.Script);
          const councilForeverUtxos = Array.from(await blaze.provider.getUnspentOutputs(councilForeverAddress));
          const councilForeverUtxo = councilForeverUtxos.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(council.forever.Script.hash())) ?? 0n) === 1n
          );

          const techAuthForeverAddress = addressFromValidator(0, techAuth.forever.Script);
          const techAuthForeverUtxos = Array.from(await blaze.provider.getUnspentOutputs(techAuthForeverAddress));
          const techAuthForeverUtxo = techAuthForeverUtxos.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(techAuth.forever.Script.hash())) ?? 0n) === 1n
          );

          const thresholdAddress = addressFromValidator(0, thresholdsContracts.mainCouncilUpdate.Script);
          const thresholdUtxos = Array.from(await blaze.provider.getUnspentOutputs(thresholdAddress));
          const councilUpdateThresholdUtxo = thresholdUtxos.find(utxo =>
            (utxo.output().amount().multiasset()?.get(AssetId(thresholdsContracts.mainCouncilUpdate.Script.hash())) ?? 0n) === 1n
          );

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            throw new Error("Required UTxOs not found");
          }

          // Read current states
          const currentCouncilState = await readVersionedMultisigState(councilForeverUtxo);
          const [[_currentSignerCount, currentSigners], currentRound] = currentCouncilState;

          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          // Generate new signers (same count, just to trigger the operation)
          const newSigners = generateTestSigners(1, true);

          console.log(`  Attempting Council member update...`);
          console.log(`  (Should FAIL because mitigation_logic=always_fails blocks forever contract)`);

          // Build the transaction
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

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", txBuilder); },
            { description: "Council operation with always_fails mitigation" }
          );

          if (!rejection.passed) {
            throw new Error(`UNEXPECTED: ${rejection.message}`);
          }

          console.log(`  ✓ Negative test passed: Council operation was REJECTED`);
          console.log(`    Forever contract (FC-9) enforces mitigation_logic via validate_running()`);
          console.log(`    Since mitigation_logic = always_fails, ALL Council operations are blocked`);

          return completeTestResult(
            result,
            "passed",
            "Mitigation logic enforced. Council operations blocked by always_fails mitigation."
          );
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "negative-remove-mitigation-logic",
      name: "Phase 1.3: Attempt to remove mitigation logic",
      description: "Verify mitigation_logic cannot be set back to empty",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-remove-mitigation-logic", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Testing that mitigation_logic cannot be removed...");
          console.log("  (Negative test: should FAIL)");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current staging state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          console.log(`  Current staging mitigation_logic: ${currentState[1].substring(0, 16)}...`);

          // Try to stage mitigation_logic = "" (empty)
          // This should fail because main already has mitigation_logic set (TSG-7)
          const { redeemer } = buildStagingRedeemer(mainUtxo, "", "MitigationLogic");

          // Build state with empty mitigation_logic
          const badState: typeof Contracts.UpgradeState = [
            currentState[0],      // logic: unchanged
            "",                   // mitigation_logic: ATTEMPTING TO CLEAR
            currentState[2],      // auth: unchanged
            currentState[3],      // mitigation_auth: unchanged
            currentState[4] + 1n, // round: incremented
            currentState[5],      // logic_round: unchanged
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
                datum: serialize(Contracts.UpgradeState, badState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, redeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", txBuilder); },
            { description: "removing mitigation_logic" }
          );

          if (!rejection.passed) {
            throw new Error(`UNEXPECTED: ${rejection.message}`);
          }

          console.log(`  ✓ Negative test passed: Removing mitigation_logic was REJECTED`);
          console.log(`    Contract enforces TSG-7: Cannot stage mitigation once main is populated`);

          return completeTestResult(
            result,
            "passed",
            "Mitigation logic removal blocked. TSG-7 enforces permanence."
          );
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },

    // ========================================================================
    // PHASE 2: MITIGATION AUTH
    // ========================================================================
    {
      id: "add-mitigation-auth",
      name: "Phase 2.1: Add mitigation auth script",
      description: "Add mitigation_auth to authorization layer",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("add-mitigation-auth", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Adding mitigation_auth to Council via stage + promote...");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Use threshold contract hash as mitigation_auth (a real script)
          const thresholds = await contracts.getThresholds();
          const mitigationAuthHash = thresholds.mainGov.Script.hash();
          console.log(`  Mitigation auth hash (main_gov threshold): ${mitigationAuthHash.substring(0, 16)}...`);

          // === STEP 1: Stage mitigation_auth ===
          console.log("\n  Step 1: Staging mitigation_auth...");

          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current staging state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          console.log(`  Current mitigation_auth: "${currentState[3]}" (should be empty)`);

          // Check main state
          const mainState = parseInlineDatum(mainUtxo, Contracts.UpgradeState, parse);
          if (mainState[3] !== "") {
            throw new Error("Main mitigation_auth is already set - cannot test adding it");
          }

          // Build staging redeemer for MitigationAuth
          const { redeemer: stagingRedeemer } = buildStagingRedeemer(mainUtxo, mitigationAuthHash, "MitigationAuth");

          // New state: set mitigation_auth, increment round
          const stagedState: typeof Contracts.UpgradeState = [
            currentState[0],      // logic: unchanged
            currentState[1],      // mitigation_logic: unchanged (already set from Phase 1.1)
            currentState[2],      // auth: unchanged
            mitigationAuthHash,   // mitigation_auth: NEW
            currentState[4] + 1n, // round: incremented for MitigationAuth ops
            currentState[5],      // logic_round: unchanged
          ];

          // Build staging transaction
          const stagingTxBuilder = blaze
            .newTransaction()
            .addInput(stagingUtxo, serialize(Contracts.TwoStageRedeemer, stagingRedeemer))
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
                datum: serialize(Contracts.UpgradeState, stagedState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, stagingRedeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const stagingTxHash = await ctx.provider.submitTransaction("deployer", stagingTxBuilder);
          console.log(`  ✓ Staged mitigation_auth: ${stagingTxHash.substring(0, 16)}...`);

          // === STEP 2: Promote to main ===
          console.log("\n  Step 2: Promoting mitigation_auth to main...");

          // Re-query UTxOs after staging
          const { main: mainUtxo2, staging: stagingUtxo2 } = await getTwoStageUtxos(ctx, council.twoStage.Script);

          // Build promote redeemer
          const { redeemer: promoteRedeemer } = buildPromoteRedeemer(stagingUtxo2, "MitigationAuth");

          // Read staging state (which now has the mitigation_auth)
          const stagedStateActual = parseInlineDatum(stagingUtxo2, Contracts.UpgradeState, parse);

          // Read main state
          const mainState2 = parseInlineDatum(mainUtxo2, Contracts.UpgradeState, parse);

          // Promoted state: copy mitigation_auth from staging to main
          const promotedState: typeof Contracts.UpgradeState = [
            mainState2[0],           // logic: keep main's value
            mainState2[1],           // mitigation_logic: keep main's value
            mainState2[2],           // auth: keep main's value
            stagedStateActual[3],    // mitigation_auth: from staging
            stagedStateActual[4],    // round: from staging
            mainState2[5],           // logic_round: keep main's value
          ];

          // Build promote transaction
          const promoteTxBuilder = blaze
            .newTransaction()
            .addInput(mainUtxo2, serialize(Contracts.TwoStageRedeemer, promoteRedeemer))
            .addReferenceInput(stagingUtxo2)
            .addReferenceInput(refUtxos.councilForever)
            .addReferenceInput(refUtxos.techAuthForever)
            .addReferenceInput(refUtxos.thresholds)
            .addMint(PolicyId(councilNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(techAuthNativeScript.hash()), new Map([[AssetName(""), 1n]]))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(mainUtxo2.output().address().toBech32()),
                value: {
                  coins: mainUtxo2.output().amount().coin(),
                  assets: mainUtxo2.output().amount().multiasset() ?? new Map(),
                },
                datum: serialize(Contracts.UpgradeState, promotedState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, promoteRedeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const promoteTxHash = await ctx.provider.submitTransaction("deployer", promoteTxBuilder);
          console.log(`  ✓ Promoted mitigation_auth: ${promoteTxHash.substring(0, 16)}...`);

          // Verify final state
          const { main: finalMainUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const finalState = parseInlineDatum(finalMainUtxo, Contracts.UpgradeState, parse);
          console.log(`  Final main mitigation_auth: ${finalState[3].substring(0, 16)}...`);

          if (finalState[3] !== mitigationAuthHash) {
            throw new Error(`mitigation_auth not set correctly: expected ${mitigationAuthHash}, got ${finalState[3]}`);
          }

          // Store for later phases
          ctx.journeyState.metadata = {
            ...ctx.journeyState.metadata,
            mitigationAuthHash: mitigationAuthHash,
          };

          return completeTestResult(result, "passed", "Mitigation auth added to Council main UpgradeState");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-mitigation-auth-enforced",
      name: "Phase 2.2: Verify mitigation auth is enforced",
      description: "Test that operations require both auth scripts",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-mitigation-auth-enforced", this.name);

        // Now that mitigation_auth is set, two-stage operations require withdrawal
        // from BOTH gov_auth AND mitigation_auth. If we omit the mitigation_auth
        // withdrawal, the operation should fail.

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");
          const { RewardAccount, NetworkId, CredentialType, Hash28ByteBase16 } = await import("@blaze-cardano/core");

          console.log("  Testing that two-stage ops require mitigation_auth withdrawal...");
          console.log("  (Negative test: omit mitigation_auth withdrawal, should FAIL)");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          const mitigationAuthHash = currentState[3];
          console.log(`  Current mitigation_auth: ${mitigationAuthHash.substring(0, 16)}...`);

          if (mitigationAuthHash === "") {
            throw new Error("mitigation_auth is empty - cannot test enforcement");
          }

          // Build a valid staging redeemer (Logic update, but we'll omit mitigation_auth withdrawal)
          const { redeemer } = buildStagingRedeemer(mainUtxo, council.logic.Script.hash(), "Logic");

          // New state - just increment logic_round (valid update)
          const newState: typeof Contracts.UpgradeState = [
            council.logic.Script.hash(), // logic: valid update
            currentState[1],             // mitigation_logic: unchanged
            currentState[2],             // auth: unchanged
            currentState[3],             // mitigation_auth: unchanged
            currentState[4],             // round: unchanged for Logic ops
            currentState[5] + 1n,        // logic_round: incremented
          ];

          // Build transaction - DELIBERATELY omit mitigation_auth withdrawal
          // The two-stage contract calls validate_running(auth, mitigation_auth, withdrawals)
          // which requires BOTH auth and mitigation_auth withdrawals
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
            // Include gov_auth withdrawal but NOT mitigation_auth
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, redeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", txBuilder); },
            { description: "two-stage op without mitigation_auth withdrawal" }
          );

          if (!rejection.passed) {
            throw new Error(`UNEXPECTED: ${rejection.message}`);
          }

          console.log(`  ✓ Negative test passed: Operation was REJECTED without mitigation_auth`);
          console.log(`    validate_running() enforces mitigation_auth withdrawal (RUN-3)`);

          return completeTestResult(
            result,
            "passed",
            "Mitigation auth enforced. Two-stage operations require mitigation_auth withdrawal."
          );
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "negative-remove-mitigation-auth",
      name: "Phase 2.3: Attempt to remove mitigation auth",
      description: "Verify mitigation_auth cannot be removed",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-remove-mitigation-auth", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Testing that mitigation_auth cannot be removed...");
          console.log("  (Negative test: should FAIL)");

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, council.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current staging state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          console.log(`  Current staging mitigation_auth: ${currentState[3].substring(0, 16)}...`);

          // Try to stage mitigation_auth = "" (empty)
          // This should fail because main already has mitigation_auth set (TSG-8)
          const { redeemer } = buildStagingRedeemer(mainUtxo, "", "MitigationAuth");

          // Build state with empty mitigation_auth
          const badState: typeof Contracts.UpgradeState = [
            currentState[0],      // logic: unchanged
            currentState[1],      // mitigation_logic: unchanged
            currentState[2],      // auth: unchanged
            "",                   // mitigation_auth: ATTEMPTING TO CLEAR
            currentState[4] + 1n, // round: incremented
            currentState[5],      // logic_round: unchanged
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
                datum: serialize(Contracts.UpgradeState, badState).toCore(),
              })
            )
            .addWithdrawal(govAuthRewardAccount, 0n, serialize(Contracts.TwoStageRedeemer, redeemer))
            .provideScript(council.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", txBuilder); },
            { description: "removing mitigation_auth" }
          );

          if (!rejection.passed) {
            throw new Error(`UNEXPECTED: ${rejection.message}`);
          }

          console.log(`  ✓ Negative test passed: Removing mitigation_auth was REJECTED`);
          console.log(`    Contract enforces TSG-8: Cannot stage mitigation auth once main is populated`);

          return completeTestResult(
            result,
            "passed",
            "Mitigation auth removal blocked. TSG-8 enforces permanence."
          );
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
  ],
};
