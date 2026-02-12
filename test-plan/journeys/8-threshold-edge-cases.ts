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
  PaymentAddress,
  TransactionOutput,
  PolicyId,
  AssetName,
  addressFromValidator,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";

/**
 * Journey 8: Threshold Validation Edge Cases
 *
 * Tests boundary conditions on the threshold validation function:
 *   fn validation(datum: Data) {
 *     expect MultisigThreshold { ... } = datum
 *     and {
 *       technical_auth_numerator < technical_auth_denominator,
 *       council_numerator < council_denominator,
 *       technical_auth_numerator > -1,
 *       council_numerator > -1,
 *     }
 *   }
 *
 * This journey probes:
 * - numerator == denominator (100%, should fail: strict <)
 * - numerator > denominator (should fail)
 * - denominator == 0 (division by zero risk)
 * - negative numerator (should fail: > -1 means >= 0)
 */
export const thresholdEdgeCasesJourney: JourneyDefinition = {
  id: "threshold-edge-cases",
  name: "Threshold Validation Edge Cases",
  description: "Test boundary conditions on threshold datum validation",
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
    // PHASE 1: BOUNDARY REJECTIONS
    // Each test attempts to set an invalid threshold and expects rejection
    // ========================================================================
    {
      id: "reject-numerator-equals-denominator",
      name: "Phase 1.1: Reject numerator == denominator (100%)",
      description: "Contract requires strict < so 1/1 should fail",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("reject-numerator-equals-denominator", this.name);

        try {
          console.log("  Testing threshold [1, 1, 1, 2] (TechAuth 1/1 = 100%)...");
          console.log("  Contract requires numerator < denominator (strict <)");
          console.log("  1 < 1 is false, so this should be rejected");

          const invalidThreshold: [bigint, bigint, bigint, bigint] = [1n, 1n, 1n, 2n];

          const rejection = await expectTransactionRejection(
            () => buildAndSubmitThresholdUpdate(ctx, invalidThreshold),
            { errorShouldInclude: ["Validator returned false", "validation"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined,
              `Threshold [1/1, 1/2] was ACCEPTED but should have been rejected! ${rejection.message}`
            );
          }

          console.log(`  \u2713 Correctly rejected: numerator == denominator`);

          return completeTestResult(result, "passed", "Threshold [1/1, 1/2] correctly rejected.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "reject-numerator-exceeds-denominator",
      name: "Phase 1.2: Reject numerator > denominator",
      description: "Threshold like 2/1 should be rejected",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("reject-numerator-exceeds-denominator", this.name);

        try {
          console.log("  Testing threshold [2, 1, 1, 2] (TechAuth 2/1 > 100%)...");

          const invalidThreshold: [bigint, bigint, bigint, bigint] = [2n, 1n, 1n, 2n];

          const rejection = await expectTransactionRejection(
            () => buildAndSubmitThresholdUpdate(ctx, invalidThreshold),
            { errorShouldInclude: ["Validator returned false", "validation"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined,
              `Threshold [2/1, 1/2] was ACCEPTED but should have been rejected! ${rejection.message}`
            );
          }

          console.log(`  \u2713 Correctly rejected: numerator > denominator`);

          return completeTestResult(result, "passed", "Threshold [2/1, 1/2] correctly rejected.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "reject-zero-denominator",
      name: "Phase 1.3: Reject denominator == 0",
      description: "Probe for division-by-zero: threshold [1, 0, 1, 2]",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("reject-zero-denominator", this.name);

        try {
          console.log("  Testing threshold [1, 0, 1, 2] (TechAuth denominator = 0)...");
          console.log("  Validation: 1 < 0 is false, so should be rejected");
          console.log("  (Also probes whether 0 denominator causes division-by-zero elsewhere)");

          const invalidThreshold: [bigint, bigint, bigint, bigint] = [1n, 0n, 1n, 2n];

          const rejection = await expectTransactionRejection(
            () => buildAndSubmitThresholdUpdate(ctx, invalidThreshold),
            { errorShouldInclude: ["Validator returned false", "validation", "zero"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined,
              `Threshold [1/0, 1/2] was ACCEPTED but should have been rejected! ${rejection.message}`
            );
          }

          console.log(`  \u2713 Correctly rejected: zero denominator`);

          return completeTestResult(result, "passed", "Threshold [1/0, 1/2] correctly rejected.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "reject-negative-numerator",
      name: "Phase 1.4: Reject negative numerator",
      description: "Threshold with -1 numerator should fail (> -1 check)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("reject-negative-numerator", this.name);

        try {
          console.log("  Testing threshold [-1, 2, 1, 2] (TechAuth numerator = -1)...");
          console.log("  Validation: -1 > -1 is false, so should be rejected");

          const invalidThreshold: [bigint, bigint, bigint, bigint] = [-1n, 2n, 1n, 2n];

          const rejection = await expectTransactionRejection(
            () => buildAndSubmitThresholdUpdate(ctx, invalidThreshold),
            { errorShouldInclude: ["Validator returned false", "validation"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined,
              `Threshold [-1/2, 1/2] was ACCEPTED but should have been rejected! ${rejection.message}`
            );
          }

          console.log(`  \u2713 Correctly rejected: negative numerator`);

          return completeTestResult(result, "passed", "Threshold [-1/2, 1/2] correctly rejected.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "reject-council-numerator-equals-denominator",
      name: "Phase 1.5: Reject Council numerator == denominator",
      description: "Both fractions are validated independently",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("reject-council-numerator-equals-denominator", this.name);

        try {
          console.log("  Testing threshold [1, 2, 1, 1] (Council 1/1 = 100%)...");
          console.log("  TechAuth is valid (1/2), but Council is invalid (1 < 1 = false)");

          const invalidThreshold: [bigint, bigint, bigint, bigint] = [1n, 2n, 1n, 1n];

          const rejection = await expectTransactionRejection(
            () => buildAndSubmitThresholdUpdate(ctx, invalidThreshold),
            { errorShouldInclude: ["Validator returned false", "validation"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined,
              `Threshold [1/2, 1/1] was ACCEPTED but should have been rejected! ${rejection.message}`
            );
          }

          console.log(`  \u2713 Correctly rejected: Council numerator == denominator`);

          return completeTestResult(result, "passed", "Threshold [1/2, 1/1] correctly rejected.");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
  ],
};

/**
 * Helper: Build and submit a threshold update transaction for main_gov_threshold
 */
async function buildAndSubmitThresholdUpdate(
  ctx: JourneyContext,
  newThreshold: [bigint, bigint, bigint, bigint]
): Promise<void> {
  const { contracts, blaze } = await getTestSetup(ctx);
  const Contracts = await import("../../contract_blueprint");
  const { readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");

  const thresholds = await contracts.getThresholds();
  const council = await contracts.getCouncil();
  const techAuth = await contracts.getTechAuth();

  const thresholdAddress = addressFromValidator(0, thresholds.mainGov.Script);
  const thresholdUtxos = Array.from(await blaze.provider.getUnspentOutputs(thresholdAddress));
  const thresholdNftId = AssetId(thresholds.mainGov.Script.hash());

  const mainGovUtxo = thresholdUtxos.find(utxo =>
    (utxo.output().amount().multiasset()?.get(thresholdNftId) ?? 0n) === 1n
  );

  if (!mainGovUtxo) throw new Error("main_gov_threshold UTxO not found");

  const currentThreshold = await readMultisigThresholdState(mainGovUtxo);

  const councilForeverAddress = addressFromValidator(0, council.forever.Script);
  const techAuthForeverAddress = addressFromValidator(0, techAuth.forever.Script);
  const councilForeverUtxos = Array.from(await blaze.provider.getUnspentOutputs(councilForeverAddress));
  const techAuthForeverUtxos = Array.from(await blaze.provider.getUnspentOutputs(techAuthForeverAddress));

  const councilForeverUtxo = councilForeverUtxos.find(utxo =>
    (utxo.output().amount().multiasset()?.get(AssetId(council.forever.Script.hash())) ?? 0n) === 1n
  );
  const techAuthForeverUtxo = techAuthForeverUtxos.find(utxo =>
    (utxo.output().amount().multiasset()?.get(AssetId(techAuth.forever.Script.hash())) ?? 0n) === 1n
  );

  if (!councilForeverUtxo || !techAuthForeverUtxo) {
    throw new Error("Council or TechAuth forever UTxO not found");
  }

  const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);

  const txBuilder = blaze
    .newTransaction()
    .addInput(mainGovUtxo, serialize(Contracts.MultisigThreshold, currentThreshold))
    .addReferenceInput(councilForeverUtxo)
    .addReferenceInput(techAuthForeverUtxo)
    .addMint(PolicyId(councilNativeScript.hash()), new Map([[AssetName(""), 1n]]))
    .addMint(PolicyId(techAuthNativeScript.hash()), new Map([[AssetName(""), 1n]]))
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(thresholdAddress.toBech32()),
        value: {
          coins: mainGovUtxo.output().amount().coin(),
          assets: mainGovUtxo.output().amount().multiasset() ?? new Map(),
        },
        datum: serialize(Contracts.MultisigThreshold, newThreshold).toCore(),
      })
    )
    .provideScript(thresholds.mainGov.Script)
    .provideScript(councilNativeScript)
    .provideScript(techAuthNativeScript);

  await ctx.provider.submitTransaction("deployer", txBuilder);
}
