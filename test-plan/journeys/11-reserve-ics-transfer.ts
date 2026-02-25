import type {
  JourneyDefinition,
  JourneyContext,
  TestResult,
} from "../lib/types";
import {
  initTestResult,
  completeTestResult,
  getTestSetup,
  deployGovernanceContracts,
  deployReserveContracts,
  deployICSContracts,
  getContractUtxos,
  findUtxoWithNftInArray,
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
  TransactionOutput,
  PaymentAddress,
  PlutusData,
  RewardAccount,
  CredentialType,
  Hash28ByteBase16,
  Credential,
  addressFromValidator,
  TransactionInput,
  AssetId,
  toHex,
  PolicyId,
  AssetName,
} from "@blaze-cardano/core";
import { serialize, parse } from "@blaze-cardano/data";

/**
 * Journey 11: Reserve ↔ ICS Value Transfer
 *
 * Tests Reserve and ICS value operations, cross-contract independence,
 * and the two-stage upgrade path for Reserve.
 *
 * ARCHITECTURE:
 *
 * Reserve and ICS both use `logic_merge` — a write-only pattern:
 * - You can deposit new funds to the forever address
 * - You can consolidate UTxOs via merge (output >= input)
 * - You can NEVER extract value (output < input is rejected)
 * - The forever NFT cannot be moved (LM-3 check)
 *
 * A "transfer" between Reserve and ICS means:
 * - Depositing new funds at the target's forever address
 * - Consolidating via logic_merge withdrawal
 * - Both contracts operate independently
 *
 * PHASES:
 * 1. Setup: Deploy governance + Reserve + ICS, register ICS logic
 * 2. Reserve value operations: Fund + verify
 * 3. ICS value operations: Fund + verify
 * 4. Cross-contract independence & negative tests
 * 5. Staging forever: Deploy + verify staging contracts
 * 6. Two-stage upgrade path for Reserve
 */
export const reserveIcsTransferJourney: JourneyDefinition = {
  id: "reserve-ics-transfer",
  name: "Reserve <-> ICS Value Transfer",
  description: "Test Reserve and ICS value operations, independence, and upgrade paths",
  reuseContracts: false,
  steps: [
    // ========================================================================
    // PHASE 1: SETUP
    // ========================================================================
    {
      id: "setup-deploy-governance",
      name: "Phase 1.1: Deploy governance contracts",
      description: "Deploy Council, TechAuth, Thresholds, and gov_auth",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("setup-deploy-governance", this.name);

        try {
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
    {
      id: "setup-deploy-reserve",
      name: "Phase 1.2: Deploy Reserve contracts",
      description: "Deploy Reserve forever, two-stage, and logic contracts",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("setup-deploy-reserve", this.name);

        try {
          const { reserveTxHash } = await deployReserveContracts(ctx);
          console.log(`  ✓ Reserve: ${reserveTxHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "Reserve contracts deployed");
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
      id: "setup-deploy-ics",
      name: "Phase 1.3: Deploy ICS contracts",
      description: "Deploy ICS forever, two-stage, and logic contracts",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("setup-deploy-ics", this.name);

        try {
          const { icsTxHash } = await deployICSContracts(ctx);
          console.log(`  ✓ ICS: ${icsTxHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "ICS contracts deployed");
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
      id: "setup-register-logic-stakes",
      name: "Phase 1.4: Register Reserve and ICS logic stake credentials",
      description: "Register withdrawal credentials for logic_merge validators",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("setup-register-logic-stakes", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();
          const ics = await contracts.getICS();

          console.log("  Registering Reserve + ICS logic stake credentials...");

          const txBuilder = blaze
            .newTransaction()
            .addRegisterStake(Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: Hash28ByteBase16(reserve.logic.Script.hash()),
            }))
            .addRegisterStake(Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: Hash28ByteBase16(ics.logic.Script.hash()),
            }));

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Logic stakes registered: ${txHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "Reserve and ICS logic stake credentials registered");
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
    // PHASE 2: RESERVE VALUE OPERATIONS
    // ========================================================================
    {
      id: "fund-reserve",
      name: "Phase 2.1: Fund Reserve with cNIGHT via merge",
      description: "Send cNIGHT to Reserve forever address and consolidate via logic_merge",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("fund-reserve", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);
          const reserveForeverAddress = addressFromValidator(0, reserve.forever.Script);

          const adaToAdd = 5_000_000n;
          const cnightToAdd = 1000n;

          // Step 1: Send ADA + cNIGHT to Reserve forever address
          console.log(`  Sending ${Number(adaToAdd) / 1_000_000} ADA + ${cnightToAdd} cNIGHT to Reserve...`);

          const sendTxBuilder = blaze
            .newTransaction()
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: adaToAdd,
                  assets: new Map([[cnightAssetId, cnightToAdd]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const sendTxHash = await ctx.provider.submitTransaction("deployer", sendTxBuilder);
          console.log(`  ✓ Sent to forever address: ${sendTxHash.substring(0, 16)}...`);

          // Step 2: Resolve the UTxO we just sent
          const newUtxos = await blaze.provider.resolveUnspentOutputs([
            new TransactionInput(sendTxHash, 0n),
          ]);
          if (newUtxos.length === 0) throw new Error("Failed to find the UTxO we just sent");
          const newUtxo = newUtxos[0];
          const inputAda = newUtxo.output().amount().coin();
          const inputCnight = newUtxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;

          // Step 3: Find Reserve main NFT for reference
          const utxos = await getContractUtxos(ctx, { reserveTwoStage: reserve.twoStage.Script }, 0);
          const mainNftUtxo = findUtxoWithNftInArray(utxos.reserveTwoStage, reserve.twoStage.Script.hash(), "main");
          if (!mainNftUtxo) throw new Error("Reserve main NFT UTxO not found");

          // Step 4: Perform merge
          console.log("  Performing merge consolidation...");
          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(reserve.logic.Script.hash()),
          }, 0);

          const mergeTxBuilder = blaze
            .newTransaction()
            .addInput(newUtxo, PlutusData.newInteger(0n))
            .addReferenceInput(mainNftUtxo)
            .provideScript(reserve.forever.Script)
            .provideScript(reserve.logic.Script)
            .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: inputAda,
                  assets: new Map([[cnightAssetId, inputCnight]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const mergeTxHash = await ctx.provider.submitTransaction("deployer", mergeTxBuilder);
          console.log(`  ✓ Reserve merge: ${mergeTxHash.substring(0, 16)}...`);
          console.log(`    ${Number(inputAda) / 1_000_000} ADA + ${inputCnight} cNIGHT in Reserve`);

          // Store merge output for balance tracking
          ctx.journeyState.metadata = {
            ...ctx.journeyState.metadata,
            reserveMergeTxHash: mergeTxHash,
            reserveAda: inputAda.toString(),
            reserveCnight: inputCnight.toString(),
          };

          return completeTestResult(result, "passed", `Reserve funded with ${Number(inputAda) / 1_000_000} ADA + ${inputCnight} cNIGHT`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-reserve-balance",
      name: "Phase 2.2: Verify Reserve balance",
      description: "Query Reserve forever UTxOs and verify expected balance",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-reserve-balance", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);

          console.log("  Querying Reserve forever UTxOs...");

          const utxos = await getContractUtxos(ctx, { reserveForever: reserve.forever.Script }, 0);
          const foreverUtxos = utxos.reserveForever;

          // Sum up all ADA and cNIGHT across forever UTxOs
          let totalAda = 0n;
          let totalCnight = 0n;
          for (const utxo of foreverUtxos) {
            totalAda += utxo.output().amount().coin();
            const cnight = utxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;
            totalCnight += cnight;
          }

          console.log(`  Reserve forever UTxOs: ${foreverUtxos.length}`);
          console.log(`  Total ADA: ${Number(totalAda) / 1_000_000}`);
          console.log(`  Total cNIGHT: ${totalCnight}`);

          // Verify at least what we funded
          const expectedCnight = BigInt(ctx.journeyState.metadata?.reserveCnight ?? "0");
          if (totalCnight < expectedCnight) {
            throw new Error(`Expected at least ${expectedCnight} cNIGHT, found ${totalCnight}`);
          }

          console.log(`  ✓ Reserve balance verified`);

          return completeTestResult(result, "passed", `Reserve: ${Number(totalAda) / 1_000_000} ADA, ${totalCnight} cNIGHT`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },

    // ========================================================================
    // PHASE 3: ICS VALUE OPERATIONS
    // ========================================================================
    {
      id: "fund-ics",
      name: "Phase 3.1: Fund ICS with cNIGHT via merge",
      description: "Send cNIGHT to ICS forever address and consolidate via logic_merge",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("fund-ics", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const ics = await contracts.getICS();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);
          const icsForeverAddress = addressFromValidator(0, ics.forever.Script);

          const adaToAdd = 5_000_000n;
          const cnightToAdd = 2000n;

          // Step 1: Send ADA + cNIGHT to ICS forever address
          console.log(`  Sending ${Number(adaToAdd) / 1_000_000} ADA + ${cnightToAdd} cNIGHT to ICS...`);

          const sendTxBuilder = blaze
            .newTransaction()
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(icsForeverAddress.toBech32()),
                value: {
                  coins: adaToAdd,
                  assets: new Map([[cnightAssetId, cnightToAdd]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const sendTxHash = await ctx.provider.submitTransaction("deployer", sendTxBuilder);
          console.log(`  ✓ Sent to ICS forever address: ${sendTxHash.substring(0, 16)}...`);

          // Step 2: Resolve the UTxO
          const newUtxos = await blaze.provider.resolveUnspentOutputs([
            new TransactionInput(sendTxHash, 0n),
          ]);
          if (newUtxos.length === 0) throw new Error("Failed to find the UTxO we just sent");
          const newUtxo = newUtxos[0];
          const inputAda = newUtxo.output().amount().coin();
          const inputCnight = newUtxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;

          // Step 3: Find ICS main NFT for reference
          const utxos = await getContractUtxos(ctx, { icsTwoStage: ics.twoStage.Script }, 0);
          const mainNftUtxo = findUtxoWithNftInArray(utxos.icsTwoStage, ics.twoStage.Script.hash(), "main");
          if (!mainNftUtxo) throw new Error("ICS main NFT UTxO not found");

          // Step 4: Perform merge
          console.log("  Performing ICS merge consolidation...");
          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(ics.logic.Script.hash()),
          }, 0);

          const mergeTxBuilder = blaze
            .newTransaction()
            .addInput(newUtxo, PlutusData.newInteger(0n))
            .addReferenceInput(mainNftUtxo)
            .provideScript(ics.forever.Script)
            .provideScript(ics.logic.Script)
            .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(icsForeverAddress.toBech32()),
                value: {
                  coins: inputAda,
                  assets: new Map([[cnightAssetId, inputCnight]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const mergeTxHash = await ctx.provider.submitTransaction("deployer", mergeTxBuilder);
          console.log(`  ✓ ICS merge: ${mergeTxHash.substring(0, 16)}...`);
          console.log(`    ${Number(inputAda) / 1_000_000} ADA + ${inputCnight} cNIGHT in ICS`);

          ctx.journeyState.metadata = {
            ...ctx.journeyState.metadata,
            icsMergeTxHash: mergeTxHash,
            icsAda: inputAda.toString(),
            icsCnight: inputCnight.toString(),
          };

          return completeTestResult(result, "passed", `ICS funded with ${Number(inputAda) / 1_000_000} ADA + ${inputCnight} cNIGHT`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-ics-balance",
      name: "Phase 3.2: Verify ICS balance",
      description: "Query ICS forever UTxOs and verify expected balance",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-ics-balance", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const ics = await contracts.getICS();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);

          console.log("  Querying ICS forever UTxOs...");

          const utxos = await getContractUtxos(ctx, { icsForever: ics.forever.Script }, 0);
          const foreverUtxos = utxos.icsForever;

          let totalAda = 0n;
          let totalCnight = 0n;
          for (const utxo of foreverUtxos) {
            totalAda += utxo.output().amount().coin();
            const cnight = utxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;
            totalCnight += cnight;
          }

          console.log(`  ICS forever UTxOs: ${foreverUtxos.length}`);
          console.log(`  Total ADA: ${Number(totalAda) / 1_000_000}`);
          console.log(`  Total cNIGHT: ${totalCnight}`);

          const expectedCnight = BigInt(ctx.journeyState.metadata?.icsCnight ?? "0");
          if (totalCnight < expectedCnight) {
            throw new Error(`Expected at least ${expectedCnight} cNIGHT, found ${totalCnight}`);
          }

          console.log(`  ✓ ICS balance verified`);

          return completeTestResult(result, "passed", `ICS: ${Number(totalAda) / 1_000_000} ADA, ${totalCnight} cNIGHT`);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },

    // ========================================================================
    // PHASE 4: CROSS-CONTRACT INDEPENDENCE & NEGATIVE TESTS
    // ========================================================================
    {
      id: "fund-ics-verify-reserve-unchanged",
      name: "Phase 4.1: Fund ICS again, verify Reserve balance unchanged",
      description: "Demonstrate contracts operate independently",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("fund-ics-verify-reserve-unchanged", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();
          const ics = await contracts.getICS();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);

          // Snapshot Reserve balance before
          const reserveUtxosBefore = await getContractUtxos(ctx, { reserveForever: reserve.forever.Script }, 0);
          let reserveCnightBefore = 0n;
          for (const utxo of reserveUtxosBefore.reserveForever) {
            reserveCnightBefore += utxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;
          }
          console.log(`  Reserve cNIGHT before: ${reserveCnightBefore}`);

          // Fund ICS with additional cNIGHT
          const icsForeverAddress = addressFromValidator(0, ics.forever.Script);
          const sendTxBuilder = blaze
            .newTransaction()
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(icsForeverAddress.toBech32()),
                value: {
                  coins: 3_000_000n,
                  assets: new Map([[cnightAssetId, 500n]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const sendTxHash = await ctx.provider.submitTransaction("deployer", sendTxBuilder);
          console.log(`  ✓ Additional 500 cNIGHT sent to ICS: ${sendTxHash.substring(0, 16)}...`);

          // Verify Reserve balance unchanged
          const reserveUtxosAfter = await getContractUtxos(ctx, { reserveForever: reserve.forever.Script }, 0);
          let reserveCnightAfter = 0n;
          for (const utxo of reserveUtxosAfter.reserveForever) {
            reserveCnightAfter += utxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;
          }
          console.log(`  Reserve cNIGHT after: ${reserveCnightAfter}`);

          if (reserveCnightAfter !== reserveCnightBefore) {
            throw new Error(
              `Reserve balance changed! Before: ${reserveCnightBefore}, After: ${reserveCnightAfter}`
            );
          }

          console.log(`  ✓ Reserve balance unchanged — contracts are independent`);

          return completeTestResult(
            result,
            "passed",
            `ICS funded again, Reserve balance unchanged at ${reserveCnightAfter} cNIGHT. Contracts are independent.`
          );
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "negative-extract-ada-reserve",
      name: "Phase 4.2: Attempt to extract ADA from Reserve",
      description: "Verify logic_merge prevents removing ADA (output < input)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-extract-ada-reserve", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);
          const reserveForeverAddress = addressFromValidator(0, reserve.forever.Script);

          console.log("  Attempting to extract ADA from Reserve (should fail)...");

          // Send funds to forever address
          const inputAda = 5_000_000n;
          const inputCnight = 1000n;

          const sendTxBuilder = blaze
            .newTransaction()
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: inputAda,
                  assets: new Map([[cnightAssetId, inputCnight]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const sendTxHash = await ctx.provider.submitTransaction("deployer", sendTxBuilder);
          const newUtxos = await blaze.provider.resolveUnspentOutputs([
            new TransactionInput(sendTxHash, 0n),
          ]);
          if (newUtxos.length === 0) throw new Error("Failed to find the UTxO we just sent");
          const newUtxo = newUtxos[0];

          // Find Reserve main NFT
          const utxos = await getContractUtxos(ctx, { reserveTwoStage: reserve.twoStage.Script }, 0);
          const mainNftUtxo = findUtxoWithNftInArray(utxos.reserveTwoStage, reserve.twoStage.Script.hash(), "main");
          if (!mainNftUtxo) throw new Error("Reserve main NFT UTxO not found");

          // Try to merge with LESS ADA
          const outputAda = inputAda - 1_000_000n;

          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(reserve.logic.Script.hash()),
          }, 0);

          const mergeTxBuilder = blaze
            .newTransaction()
            .addInput(newUtxo, PlutusData.newInteger(0n))
            .addReferenceInput(mainNftUtxo)
            .provideScript(reserve.forever.Script)
            .provideScript(reserve.logic.Script)
            .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: outputAda,
                  assets: new Map([[cnightAssetId, inputCnight]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", mergeTxBuilder); },
            { errorShouldInclude: ["failed"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined, rejection.message);
          }

          console.log(`  ✓ Transaction correctly rejected: ADA extraction blocked`);

          return completeTestResult(result, "passed", "logic_merge prevents ADA extraction from Reserve", rejection.error);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "negative-extract-ada-ics",
      name: "Phase 4.3: Attempt to extract ADA from ICS",
      description: "Verify ICS logic_merge prevents removing ADA (output < input)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-extract-ada-ics", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const ics = await contracts.getICS();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);
          const icsForeverAddress = addressFromValidator(0, ics.forever.Script);

          console.log("  Attempting to extract ADA from ICS (should fail)...");

          // Send funds to ICS forever address
          const inputAda = 5_000_000n;
          const inputCnight = 1000n;

          const sendTxBuilder = blaze
            .newTransaction()
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(icsForeverAddress.toBech32()),
                value: {
                  coins: inputAda,
                  assets: new Map([[cnightAssetId, inputCnight]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const sendTxHash = await ctx.provider.submitTransaction("deployer", sendTxBuilder);
          const newUtxos = await blaze.provider.resolveUnspentOutputs([
            new TransactionInput(sendTxHash, 0n),
          ]);
          if (newUtxos.length === 0) throw new Error("Failed to find the UTxO we just sent");
          const newUtxo = newUtxos[0];

          // Find ICS main NFT
          const utxos = await getContractUtxos(ctx, { icsTwoStage: ics.twoStage.Script }, 0);
          const mainNftUtxo = findUtxoWithNftInArray(utxos.icsTwoStage, ics.twoStage.Script.hash(), "main");
          if (!mainNftUtxo) throw new Error("ICS main NFT UTxO not found");

          // Try to merge with LESS ADA
          const outputAda = inputAda - 1_000_000n;

          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(ics.logic.Script.hash()),
          }, 0);

          const mergeTxBuilder = blaze
            .newTransaction()
            .addInput(newUtxo, PlutusData.newInteger(0n))
            .addReferenceInput(mainNftUtxo)
            .provideScript(ics.forever.Script)
            .provideScript(ics.logic.Script)
            .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(icsForeverAddress.toBech32()),
                value: {
                  coins: outputAda,
                  assets: new Map([[cnightAssetId, inputCnight]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", mergeTxBuilder); },
            { errorShouldInclude: ["failed"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined, rejection.message);
          }

          console.log(`  ✓ Transaction correctly rejected: ADA extraction from ICS blocked`);

          return completeTestResult(result, "passed", "logic_merge prevents ADA extraction from ICS", rejection.error);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "negative-move-reserve-forever-nft",
      name: "Phase 4.4: Attempt to move Reserve forever NFT",
      description: "Verify logic_merge forbids consuming forever NFT (LM-3)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-move-reserve-forever-nft", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();
          const reserveForeverAddress = addressFromValidator(0, reserve.forever.Script);

          console.log("  Attempting to move Reserve forever NFT (should fail)...");

          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(reserve.logic.Script.hash()),
          }, 0);

          // Find the forever UTxO with the NFT
          const utxos = await getContractUtxos(ctx, { reserveForever: reserve.forever.Script }, 0);
          const foreverNftId = AssetId(reserve.forever.Script.hash());
          const foreverUtxo = utxos.reserveForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(foreverNftId) ?? 0n) === 1n;
          });

          if (!foreverUtxo) throw new Error("Reserve forever NFT UTxO not found");

          const txBuilder = blaze
            .newTransaction()
            .addInput(foreverUtxo, PlutusData.newInteger(0n))
            .provideScript(reserve.forever.Script)
            .provideScript(reserve.logic.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: foreverUtxo.output().amount().toCore(),
                datum: foreverUtxo.output().datum()?.toCore(),
              })
            )
            .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n));

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", txBuilder); },
            { errorShouldInclude: ["validation", "failed", "logic"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined, rejection.message);
          }

          console.log(`  ✓ Transaction correctly rejected: Reserve forever NFT is immovable`);

          return completeTestResult(result, "passed", "Reserve forever NFT cannot be moved (LM-3)", rejection.error);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "negative-move-ics-forever-nft",
      name: "Phase 4.5: Attempt to move ICS forever NFT",
      description: "Verify ICS logic_merge forbids consuming forever NFT (LM-3)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-move-ics-forever-nft", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const ics = await contracts.getICS();
          const icsForeverAddress = addressFromValidator(0, ics.forever.Script);

          console.log("  Attempting to move ICS forever NFT (should fail)...");

          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(ics.logic.Script.hash()),
          }, 0);

          // Find the ICS forever UTxO with the NFT
          const utxos = await getContractUtxos(ctx, { icsForever: ics.forever.Script }, 0);
          const foreverNftId = AssetId(ics.forever.Script.hash());
          const foreverUtxo = utxos.icsForever.find(utxo => {
            const assets = utxo.output().amount().multiasset();
            return assets && (assets.get(foreverNftId) ?? 0n) === 1n;
          });

          if (!foreverUtxo) throw new Error("ICS forever NFT UTxO not found");

          const txBuilder = blaze
            .newTransaction()
            .addInput(foreverUtxo, PlutusData.newInteger(0n))
            .provideScript(ics.forever.Script)
            .provideScript(ics.logic.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(icsForeverAddress.toBech32()),
                value: foreverUtxo.output().amount().toCore(),
                datum: foreverUtxo.output().datum()?.toCore(),
              })
            )
            .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n));

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", txBuilder); },
            { errorShouldInclude: ["validation", "failed", "logic"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined, rejection.message);
          }

          console.log(`  ✓ Transaction correctly rejected: ICS forever NFT is immovable`);

          return completeTestResult(result, "passed", "ICS forever NFT cannot be moved (LM-3)", rejection.error);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "final-balance-accounting",
      name: "Phase 4.6: Final balance accounting verification",
      description: "Verify total balances across Reserve and ICS are consistent",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("final-balance-accounting", this.name);

        try {
          const { contracts, config } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();
          const ics = await contracts.getICS();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);

          console.log("  Final balance accounting...");

          // Query both contracts
          const allUtxos = await getContractUtxos(ctx, {
            reserveForever: reserve.forever.Script,
            icsForever: ics.forever.Script,
          }, 0);

          let reserveAda = 0n, reserveCnight = 0n;
          for (const utxo of allUtxos.reserveForever) {
            reserveAda += utxo.output().amount().coin();
            reserveCnight += utxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;
          }

          let icsAda = 0n, icsCnight = 0n;
          for (const utxo of allUtxos.icsForever) {
            icsAda += utxo.output().amount().coin();
            icsCnight += utxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;
          }

          console.log(`  Reserve: ${Number(reserveAda) / 1_000_000} ADA, ${reserveCnight} cNIGHT (${allUtxos.reserveForever.length} UTxOs)`);
          console.log(`  ICS:     ${Number(icsAda) / 1_000_000} ADA, ${icsCnight} cNIGHT (${allUtxos.icsForever.length} UTxOs)`);
          console.log(`  Total:   ${Number(reserveAda + icsAda) / 1_000_000} ADA, ${reserveCnight + icsCnight} cNIGHT`);

          // Both should have positive balances
          if (reserveCnight === 0n) throw new Error("Reserve has 0 cNIGHT — expected positive balance");
          if (icsCnight === 0n) throw new Error("ICS has 0 cNIGHT — expected positive balance");

          console.log(`  ✓ Both contracts have positive balances`);

          return completeTestResult(
            result,
            "passed",
            `Reserve: ${Number(reserveAda) / 1_000_000} ADA/${reserveCnight} cNIGHT | ICS: ${Number(icsAda) / 1_000_000} ADA/${icsCnight} cNIGHT`
          );
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },

    // ========================================================================
    // PHASE 5: STAGING FOREVER
    // ========================================================================
    {
      id: "staging-forever-deploy",
      name: "Phase 5.1: Deploy staging forever contracts",
      description: "Mint staging NFTs to staging forever addresses for Reserve and ICS",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("staging-forever-deploy", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");
          const config = ctx.provider.getConfig();
          const address = await blaze.wallet.getChangeAddress();
          const deployerUtxos = await blaze.provider.getUnspentOutputs(address);

          // Get staging contracts
          const stagingReserve = await contracts.getStagingReserve();
          const stagingICS = await contracts.getStagingICS();

          // Get main contracts for comparison
          const mainReserve = await contracts.getReserve();
          const mainICS = await contracts.getICS();

          console.log("  Staging Reserve forever hash: " + stagingReserve.forever.Script.hash().substring(0, 16) + "...");
          console.log("  Staging ICS forever hash:     " + stagingICS.forever.Script.hash().substring(0, 16) + "...");
          console.log("  Main Reserve forever hash:    " + mainReserve.forever.Script.hash().substring(0, 16) + "...");
          console.log("  Main ICS forever hash:        " + mainICS.forever.Script.hash().substring(0, 16) + "...");

          // Verify staging hashes differ from main
          if (stagingReserve.forever.Script.hash() === mainReserve.forever.Script.hash()) {
            throw new Error("Staging Reserve hash must differ from main Reserve hash");
          }
          if (stagingICS.forever.Script.hash() === mainICS.forever.Script.hash()) {
            throw new Error("Staging ICS hash must differ from main ICS hash");
          }
          console.log("  ✓ Staging hashes differ from main hashes");

          // Find staging one-shot UTxOs
          const reserveStagingOneShotUtxo = deployerUtxos.find((utxo) => {
            const txId = utxo.input().transactionId();
            const txIdStr = typeof txId === "string" ? txId : txId.toString();
            return (
              txIdStr === config.reserve_staging_one_shot_hash &&
              utxo.input().index() === BigInt(config.reserve_staging_one_shot_index)
            );
          });
          if (!reserveStagingOneShotUtxo) {
            throw new Error(`Reserve staging one-shot UTxO not found: ${config.reserve_staging_one_shot_hash}#${config.reserve_staging_one_shot_index}`);
          }

          const icsStagingOneShotUtxo = deployerUtxos.find((utxo) => {
            const txId = utxo.input().transactionId();
            const txIdStr = typeof txId === "string" ? txId : txId.toString();
            return (
              txIdStr === config.ics_staging_one_shot_hash &&
              utxo.input().index() === BigInt(config.ics_staging_one_shot_index)
            );
          });
          if (!icsStagingOneShotUtxo) {
            throw new Error(`ICS staging one-shot UTxO not found: ${config.ics_staging_one_shot_hash}#${config.ics_staging_one_shot_index}`);
          }

          // Create datum (VersionedMultisig with deployer as sole signer)
          const paymentHash = address.asBase()?.getPaymentCredential().hash!;
          const signers: Record<string, string> = {
            [paymentHash]: "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
          };
          const signerCount = BigInt(Object.keys(signers).length);
          const foreverState: typeof Contracts.VersionedMultisig = [
            [signerCount, signers],
            0n,
          ];
          const redeemerForever: typeof Contracts.PermissionedRedeemer = signers;

          // Get addresses
          const stagingReserveAddr = addressFromValidator(0, stagingReserve.forever.Script);
          const stagingICSAddr = addressFromValidator(0, stagingICS.forever.Script);

          // Build transaction: deploy both staging forever contracts in one tx
          const txBuilder = blaze
            .newTransaction()
            .addInput(reserveStagingOneShotUtxo)
            .addInput(icsStagingOneShotUtxo)
            // Mint staging Reserve NFT
            .addMint(
              PolicyId(stagingReserve.forever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, redeemerForever)
            )
            // Mint staging ICS NFT
            .addMint(
              PolicyId(stagingICS.forever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, redeemerForever)
            )
            .provideScript(stagingReserve.forever.Script)
            .provideScript(stagingICS.forever.Script)
            // Output: Staging Reserve forever UTxO
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(stagingReserveAddr.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([[AssetId(stagingReserve.forever.Script.hash()), 1n]]),
                },
                datum: serialize(Contracts.VersionedMultisig, foreverState).toCore(),
              })
            )
            // Output: Staging ICS forever UTxO
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(stagingICSAddr.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([[AssetId(stagingICS.forever.Script.hash()), 1n]]),
                },
                datum: serialize(Contracts.VersionedMultisig, foreverState).toCore(),
              })
            );

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Staging forever deployment tx: ${txHash.substring(0, 16)}...`);

          // Store deployment info for later verification
          ctx.journeyState.deployments["staging_reserve"] = {
            componentName: "staging_reserve",
            txHash,
            outputIndex: 0,
            metadata: { foreverOutputIndex: 0 },
          };
          ctx.journeyState.deployments["staging_ics"] = {
            componentName: "staging_ics",
            txHash,
            outputIndex: 1,
            metadata: { foreverOutputIndex: 1 },
          };

          // Verify staging forever UTxOs exist
          const stagingUtxos = await getContractUtxos(ctx, {
            stagingReserve: stagingReserve.forever.Script,
            stagingICS: stagingICS.forever.Script,
          }, 0);

          const stagingReserveNft = findUtxoWithNftInArray(stagingUtxos.stagingReserve, stagingReserve.forever.Script.hash());
          const stagingIcsNft = findUtxoWithNftInArray(stagingUtxos.stagingICS, stagingICS.forever.Script.hash());

          if (!stagingReserveNft) throw new Error("Staging Reserve forever NFT not found");
          if (!stagingIcsNft) throw new Error("Staging ICS forever NFT not found");

          console.log("  ✓ Staging Reserve forever UTxO verified");
          console.log("  ✓ Staging ICS forever UTxO verified");

          // Verify main forever UTxOs still exist and are independent
          const mainUtxos = await getContractUtxos(ctx, {
            mainReserve: mainReserve.forever.Script,
            mainICS: mainICS.forever.Script,
          }, 0);
          const mainReserveNft = findUtxoWithNftInArray(mainUtxos.mainReserve, mainReserve.forever.Script.hash());
          const mainIcsNft = findUtxoWithNftInArray(mainUtxos.mainICS, mainICS.forever.Script.hash());

          if (!mainReserveNft) throw new Error("Main Reserve forever NFT missing after staging deployment");
          if (!mainIcsNft) throw new Error("Main ICS forever NFT missing after staging deployment");
          console.log("  ✓ Main forever UTxOs unaffected by staging deployment");

          return completeTestResult(result, "passed", "Staging forever contracts deployed and verified independent from main");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },

    // ========================================================================
    // PHASE 6: TWO-STAGE UPGRADE PATH
    // ========================================================================
    {
      id: "stage-always-fails-reserve",
      name: "Phase 6.1: Stage always_fails as Reserve logic",
      description: "Update Reserve staging UTxO with always-fails validator",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("stage-always-fails-reserve", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Staging always_fails logic to Reserve staging...");

          const reserve = await contracts.getReserve();
          const govAuth = await contracts.getGovAuth();
          const alwaysFails = await contracts.getAlwaysFails();
          const alwaysFailsHash = alwaysFails.Script.hash();

          // Get UTxOs
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, reserve.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          console.log(`  Current staging logic: ${currentState[0].substring(0, 16)}...`);
          console.log(`  Staging to always_fails: ${alwaysFailsHash.substring(0, 16)}...`);

          // Build redeemer and new state
          const { redeemer } = buildStagingRedeemer(mainUtxo, alwaysFailsHash, "Logic");
          const newState: typeof Contracts.UpgradeState = [
            alwaysFailsHash, currentState[1], currentState[2],
            currentState[3], currentState[4], currentState[5] + 1n,
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
            .provideScript(reserve.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Staged always_fails: ${txHash.substring(0, 16)}...`);

          // Store original logic for later restoration
          ctx.journeyState.metadata = {
            ...ctx.journeyState.metadata,
            reserveOriginalLogicHash: currentState[0],
            reserveAlwaysFailsHash: alwaysFailsHash,
          };

          return completeTestResult(result, "passed", "always_fails staged to Reserve staging");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-reserve-main-merge-still-works",
      name: "Phase 6.2: Verify Reserve main merge still works",
      description: "Staging has always_fails but main should still work (isolation)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-reserve-main-merge-still-works", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);
          const reserveForeverAddress = addressFromValidator(0, reserve.forever.Script);

          console.log("  Verifying Reserve main merge still works after staging update...");

          // Send funds to forever address
          const adaToAdd = 3_000_000n;
          const cnightToAdd = 100n;

          const sendTxBuilder = blaze
            .newTransaction()
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: adaToAdd,
                  assets: new Map([[cnightAssetId, cnightToAdd]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const sendTxHash = await ctx.provider.submitTransaction("deployer", sendTxBuilder);
          const newUtxos = await blaze.provider.resolveUnspentOutputs([
            new TransactionInput(sendTxHash, 0n),
          ]);
          if (newUtxos.length === 0) throw new Error("Failed to find the UTxO we just sent");
          const newUtxo = newUtxos[0];
          const inputAda = newUtxo.output().amount().coin();
          const inputCnight = newUtxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;

          // Find Reserve main NFT
          const utxos = await getContractUtxos(ctx, { reserveTwoStage: reserve.twoStage.Script }, 0);
          const mainNftUtxo = findUtxoWithNftInArray(utxos.reserveTwoStage, reserve.twoStage.Script.hash(), "main");
          if (!mainNftUtxo) throw new Error("Reserve main NFT UTxO not found");

          // Merge — main still has original logic, so this should work
          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(reserve.logic.Script.hash()),
          }, 0);

          const mergeTxBuilder = blaze
            .newTransaction()
            .addInput(newUtxo, PlutusData.newInteger(0n))
            .addReferenceInput(mainNftUtxo)
            .provideScript(reserve.forever.Script)
            .provideScript(reserve.logic.Script)
            .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: inputAda,
                  assets: new Map([[cnightAssetId, inputCnight]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const mergeTxHash = await ctx.provider.submitTransaction("deployer", mergeTxBuilder);
          console.log(`  ✓ Reserve main merge still works: ${mergeTxHash.substring(0, 16)}...`);
          console.log(`    This proves staging is isolated from main`);

          return completeTestResult(result, "passed", "Reserve main merge works despite staging having always_fails (isolation proven)");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "promote-always-fails-to-main",
      name: "Phase 6.3: Promote staged always_fails to Reserve main",
      description: "Copy always_fails from staging to main",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("promote-always-fails-to-main", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          console.log("  Promoting always_fails from staging to main...");

          const reserve = await contracts.getReserve();
          const govAuth = await contracts.getGovAuth();
          const alwaysFailsHash = ctx.journeyState.metadata?.reserveAlwaysFailsHash;
          if (!alwaysFailsHash) throw new Error("always_fails hash not found in metadata");

          // Get UTxOs
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, reserve.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current states
          const mainState = parseInlineDatum(mainUtxo, Contracts.UpgradeState, parse);
          const stagingState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);

          // Build promote redeemer
          const { redeemer } = buildPromoteRedeemer(stagingUtxo, "Logic");
          const newMainState: typeof Contracts.UpgradeState = [
            alwaysFailsHash, mainState[1], mainState[2],
            mainState[3], mainState[4], stagingState[5],
          ];

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
            .provideScript(reserve.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Promoted always_fails to main: ${txHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "always_fails promoted to Reserve main");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "negative-verify-merge-fails-with-old-logic",
      name: "Phase 6.4: Verify Reserve merge fails with old logic",
      description: "Main now has always_fails — merge with original logic should fail",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("negative-verify-merge-fails-with-old-logic", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);
          const reserveForeverAddress = addressFromValidator(0, reserve.forever.Script);

          console.log("  Verifying merge fails now that main has always_fails...");

          // Send funds to forever address
          const sendTxBuilder = blaze
            .newTransaction()
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: 3_000_000n,
                  assets: new Map([[cnightAssetId, 100n]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const sendTxHash = await ctx.provider.submitTransaction("deployer", sendTxBuilder);
          const newUtxos = await blaze.provider.resolveUnspentOutputs([
            new TransactionInput(sendTxHash, 0n),
          ]);
          if (newUtxos.length === 0) throw new Error("Failed to find the UTxO we just sent");
          const newUtxo = newUtxos[0];
          const inputAda = newUtxo.output().amount().coin();
          const inputCnight = newUtxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;

          // Find Reserve main NFT
          const utxos = await getContractUtxos(ctx, { reserveTwoStage: reserve.twoStage.Script }, 0);
          const mainNftUtxo = findUtxoWithNftInArray(utxos.reserveTwoStage, reserve.twoStage.Script.hash(), "main");
          if (!mainNftUtxo) throw new Error("Reserve main NFT UTxO not found");

          // Try merge with original reserve.logic — should fail because main now expects always_fails
          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(reserve.logic.Script.hash()),
          }, 0);

          const mergeTxBuilder = blaze
            .newTransaction()
            .addInput(newUtxo, PlutusData.newInteger(0n))
            .addReferenceInput(mainNftUtxo)
            .provideScript(reserve.forever.Script)
            .provideScript(reserve.logic.Script)
            .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: inputAda,
                  assets: new Map([[cnightAssetId, inputCnight]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const rejection = await expectTransactionRejection(
            async () => { await ctx.provider.submitTransaction("deployer", mergeTxBuilder); },
            { errorShouldInclude: ["failed"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined, rejection.message);
          }

          console.log(`  ✓ Merge correctly rejected — proves promotion took effect`);

          return completeTestResult(result, "passed", "Reserve merge fails with old logic after always_fails promotion", rejection.error);
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "stage-original-logic-back",
      name: "Phase 6.5: Re-stage original Reserve logic (downgrade)",
      description: "Stage original reserve_logic hash back to staging",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("stage-original-logic-back", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          const originalLogicHash = ctx.journeyState.metadata?.reserveOriginalLogicHash;
          if (!originalLogicHash) throw new Error("Original logic hash not found in metadata");

          console.log(`  Re-staging original logic: ${originalLogicHash.substring(0, 16)}...`);

          const reserve = await contracts.getReserve();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, reserve.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current staging state
          const currentState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);
          const { redeemer } = buildStagingRedeemer(mainUtxo, originalLogicHash, "Logic");
          const newState: typeof Contracts.UpgradeState = [
            originalLogicHash, currentState[1], currentState[2],
            currentState[3], currentState[4], currentState[5] + 1n,
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
            .provideScript(reserve.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Re-staged original logic: ${txHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "Original reserve_logic re-staged for downgrade");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "promote-original-logic-back",
      name: "Phase 6.6: Promote original Reserve logic back to main",
      description: "Complete the downgrade by promoting original logic",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("promote-original-logic-back", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const Contracts = await import("../../contract_blueprint.ts");

          const originalLogicHash = ctx.journeyState.metadata?.reserveOriginalLogicHash;
          if (!originalLogicHash) throw new Error("Original logic hash not found in metadata");

          console.log("  Promoting original logic back to main (downgrade)...");

          const reserve = await contracts.getReserve();
          const govAuth = await contracts.getGovAuth();

          // Get UTxOs
          const { main: mainUtxo, staging: stagingUtxo } = await getTwoStageUtxos(ctx, reserve.twoStage.Script);
          const refUtxos = await getGovernanceReferenceUtxos(ctx);
          const { councilNativeScript, techAuthNativeScript } = await buildAuthNativeScripts(ctx);
          const govAuthRewardAccount = await buildGovAuthRewardAccount(ctx);

          // Read current states
          const mainState = parseInlineDatum(mainUtxo, Contracts.UpgradeState, parse);
          const stagingState = parseInlineDatum(stagingUtxo, Contracts.UpgradeState, parse);

          // Build promote redeemer
          const { redeemer } = buildPromoteRedeemer(stagingUtxo, "Logic");
          const newMainState: typeof Contracts.UpgradeState = [
            originalLogicHash, mainState[1], mainState[2],
            mainState[3], mainState[4], stagingState[5],
          ];

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
            .provideScript(reserve.twoStage.Script)
            .provideScript(govAuth.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript);

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
          console.log(`  ✓ Downgrade complete: ${txHash.substring(0, 16)}...`);

          return completeTestResult(result, "passed", "Original reserve_logic promoted back to main (downgrade complete)");
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      id: "verify-merge-works-again",
      name: "Phase 6.7: Verify Reserve merge works again after downgrade",
      description: "Full round-trip: original → always_fails → original",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-merge-works-again", this.name);

        try {
          const { contracts, blaze, config } = await getTestSetup(ctx);
          const reserve = await contracts.getReserve();

          const cnightPolicyId = config.cnight_policy;
          const cnightAssetName = toHex(new TextEncoder().encode("NIGHT"));
          const cnightAssetId = AssetId(cnightPolicyId + cnightAssetName);
          const reserveForeverAddress = addressFromValidator(0, reserve.forever.Script);

          console.log("  Verifying Reserve merge works again after downgrade...");

          // Send funds to forever address
          const adaToAdd = 3_000_000n;
          const cnightToAdd = 100n;

          const sendTxBuilder = blaze
            .newTransaction()
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: adaToAdd,
                  assets: new Map([[cnightAssetId, cnightToAdd]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const sendTxHash = await ctx.provider.submitTransaction("deployer", sendTxBuilder);
          const newUtxos = await blaze.provider.resolveUnspentOutputs([
            new TransactionInput(sendTxHash, 0n),
          ]);
          if (newUtxos.length === 0) throw new Error("Failed to find the UTxO we just sent");
          const newUtxo = newUtxos[0];
          const inputAda = newUtxo.output().amount().coin();
          const inputCnight = newUtxo.output().amount().multiasset()?.get(cnightAssetId) ?? 0n;

          // Find Reserve main NFT
          const utxos = await getContractUtxos(ctx, { reserveTwoStage: reserve.twoStage.Script }, 0);
          const mainNftUtxo = findUtxoWithNftInArray(utxos.reserveTwoStage, reserve.twoStage.Script.hash(), "main");
          if (!mainNftUtxo) throw new Error("Reserve main NFT UTxO not found");

          // Merge — should work again now
          const logicRewardAccount = RewardAccount.fromCredential({
            type: CredentialType.ScriptHash,
            hash: Hash28ByteBase16(reserve.logic.Script.hash()),
          }, 0);

          const mergeTxBuilder = blaze
            .newTransaction()
            .addInput(newUtxo, PlutusData.newInteger(0n))
            .addReferenceInput(mainNftUtxo)
            .provideScript(reserve.forever.Script)
            .provideScript(reserve.logic.Script)
            .addWithdrawal(logicRewardAccount, 0n, PlutusData.newInteger(0n))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveForeverAddress.toBech32()),
                value: {
                  coins: inputAda,
                  assets: new Map([[cnightAssetId, inputCnight]]),
                },
                datum: PlutusData.newInteger(1n).toCore(),
              })
            );

          const mergeTxHash = await ctx.provider.submitTransaction("deployer", mergeTxBuilder);
          console.log(`  ✓ Reserve merge works again! ${mergeTxHash.substring(0, 16)}...`);
          console.log(`    Full round-trip verified:`);
          console.log(`      original reserve_logic → always_fails → original reserve_logic`);

          return completeTestResult(
            result,
            "passed",
            "Full upgrade/downgrade round-trip verified. Reserve merge works with restored logic."
          );
        } catch (error) {
          return completeTestResult(result, "failed", undefined, error instanceof Error ? error.message : String(error));
        }
      },
    },
  ],
};
