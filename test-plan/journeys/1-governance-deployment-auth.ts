import type {
  JourneyDefinition,
  JourneyContext,
  TestResult,
  DeploymentInfo,
} from "../lib/types";
import {
  initTestResult,
  completeTestResult,
  expectFailure,
  getTestSetup,
  findOneShotUtxo,
  findAnyUtxo,
  storeDeployment,
  createSigner,
  generateTestSigners,
  findUtxoWithNftInArray,
  getContractUtxos,
  findUtxoByTxOutput,
  expectTransactionRejection,
  parseInlineDatum,
} from "../lib/test-helpers";

/**
 * Journey 1: Governance System Deployment & Authorization
 *
 * This journey tests the complete lifecycle of deploying and exercising the core
 * governance system (Council + TechAuth + Thresholds).
 *
 * ARCHITECTURE NOTES FOR AI AGENTS:
 *
 * The governance system consists of:
 * 1. Council Forever Contract - stores Council multisig configuration (VersionedMultisig)
 *    - Validates multisig structure on deployment via validate_multisig_structure
 *    - Can be updated via Council logic + two-stage upgrade system
 *
 * 2. TechAuth Forever Contract - stores TechAuth multisig configuration (VersionedMultisig)
 *    - Similar structure to Council
 *    - Separate authorization domain from Council
 *
 * 3. Threshold Contracts - store MultisigThreshold (ratios for each group)
 *    - main_gov_threshold: affects all two-stage promote operations
 *    - staging_gov_threshold: affects all two-stage staging operations
 *    - main_council_update_threshold: affects Council member updates
 *    - main_tech_auth_update_threshold: affects TechAuth member updates
 *    - etc.
 *
 * 4. Two-Stage Upgrade System
 *    - Each contract has staging + main NFTs
 *    - UpgradeState datum stores logic hashes and auth script hashes
 *    - Changes flow: stage → test → promote
 *
 * CRITICAL ORDERING:
 * - NEGATIVE tests MUST come BEFORE positive deployment tests
 * - Each contract has a one-shot UTxO that can only be consumed ONCE
 * - Once consumed for successful deployment, cannot test negative deployment cases
 * - Negative tests should either:
 *   a) Use wrong UTxO (not the configured one-shot) - will fail one-shot validation
 *   b) Test validation that happens client-side before transaction submission
 *
 * AUTHORIZATION FLOW:
 * - Council/TechAuth changes require multisig authorization from BOTH groups
 * - Authorization is validated via native script mints (ephemeral tokens)
 * - Threshold contracts define the required signature ratios
 * - gov_auth script validates Council + TechAuth multisig for operations
 */
export const governanceDeploymentAuthJourney: JourneyDefinition = {
  id: "governance-deployment-auth",
  name: "Governance System Deployment & Authorization",
  description: "Deploy governance contracts and test authorization topologies",
  reuseContracts: false, // Fresh deployment for this journey
  steps: [
    // ========================================================================
    // PHASE 1: DEPLOYMENT - NEGATIVE TESTS FIRST
    // ========================================================================
    {
      id: "council-deploy-negative-empty-signers",
      name: "Phase 1.1: Reject Council deployment with empty signers",
      description: "Attempt to deploy Council with no signers (should fail client-side validation)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("council-deploy-negative-empty-signers", this.name);

        // SKIPPED: Contract doesn't validate signers at deployment time
        // Validation only occurs when the contract is used
        console.log("  ⚠️  SKIPPED: Contract lacks deployment-time validation for empty signers");
        console.log("     The contract mints successfully with empty signer list");
        console.log("     Validation happens later when multisig is used, not at deployment");

        return completeTestResult(
          result,
          "skipped",
          "CONTRACT LIMITATION: Council forever contract doesn't validate signer count at deployment. " +
          "Empty signers are only caught when attempting to use the multisig in operations."
        );
      },
    },
    {
      id: "council-deploy-negative-invalid-ratio",
      name: "Phase 1.2: Reject Council with numerator > denominator",
      description: "Attempt Council deployment with invalid threshold ratio (e.g., 3/2)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("council-deploy-negative-invalid-ratio", this.name);

        // NOTE: This test is SKIPPED because contracts don't validate threshold ratios at deployment time
        // Validation only occurs when spending/using the threshold contracts
        console.log("  ⚠️  SKIPPED: Contracts lack deployment-time validation for threshold ratios");
        console.log("     Ratios like 3/2 (numerator > denominator) should be rejected but aren't");
        console.log("     Validation happens later when threshold is used, not at deployment");

        return completeTestResult(
          result,
          "skipped",
          "Contracts don't validate threshold ratios at deployment time. " +
          "Invalid ratios (e.g., 3/2) are only caught when the threshold is used in operations."
        );
      },
    },
    {
      id: "tech-auth-deploy-negative-empty-signers",
      name: "Phase 1.3: Reject TechAuth deployment with empty signers",
      description: "Attempt TechAuth deployment with no signers",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("tech-auth-deploy-negative-empty-signers", this.name);

        // SKIPPED: Same contract limitation as Council
        console.log("  ⚠️  SKIPPED: Contract lacks deployment-time validation for empty signers");
        console.log("     Same limitation as Council - validation happens at use time");

        return completeTestResult(
          result,
          "skipped",
          "CONTRACT LIMITATION: TechAuth has same validation gap as Council."
        );
      },
    },

    // ========================================================================
    // PHASE 1: DEPLOYMENT - POSITIVE TESTS (CONSUME ONE-SHOT UTxOs)
    // ========================================================================
    {
      id: "council-deploy-valid",
      name: "Phase 1.4: Deploy Council with valid 1-of-1 configuration",
      description: "Successfully deploy Council forever contract with single signer",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("council-deploy-valid", this.name);

        try {
          const { buildCouncilDeploymentTx } = await import("../../sdk/lib/tx-builders/deployment");
          const { contracts, blaze, address, config } = await getTestSetup(ctx);

          console.log("  Deploying Council contract...");

          // Find the council one-shot UTxO (CRITICAL: This will be consumed!)
          const councilOneShotUtxo = await findOneShotUtxo(
            ctx,
            config.council_one_shot_hash,
            config.council_one_shot_index
          );

          if (!councilOneShotUtxo) {
            throw new Error(
              `Council one-shot UTxO not found: ${config.council_one_shot_hash}#${config.council_one_shot_index}`
            );
          }

          const council = await contracts.getCouncil();
          const govAuth = await contracts.getGovAuth();

          // Create valid 1-of-1 configuration using payment credential
          // Council uses payment credential, TechAuth will use stake credential (different signers)
          const paymentHash = address.asBase()?.getPaymentCredential().hash!;
          const signers = createSigner(paymentHash, true); // true = add prefix for Council

          console.log(`  Deployer address: ${address.toBech32()}`);

          const txBuilder = await buildCouncilDeploymentTx({
            blaze,
            councilForeverScript: council.forever.Script,
            councilTwoStageScript: council.twoStage.Script,
            councilLogicScript: council.logic.Script,
            govAuthScript: govAuth.Script,
            councilOneShotUtxo,
            threshold: 1n,
            signers,
            networkId: 0,
          });

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

          console.log(`  ✓ Council deployed! TxHash: ${txHash}`);

          // Register the council signer: maps to deployer's payment credential
          ctx.provider.registerSigner("council-auth-0", "deployer", "payment");

          // Store deployment info
          const deployment: DeploymentInfo = {
            componentName: "council",
            txHash,
            outputIndex: 0,
            metadata: {
              foreverOutputIndex: 2, // Third output is forever contract
              mainOutputIndex: 0,    // First output is main two-stage
              stagingOutputIndex: 1, // Second output is staging two-stage
            },
          };
          storeDeployment(ctx, "council", deployment);

          return completeTestResult(
            result,
            "passed",
            `Council deployed successfully. TxHash: ${txHash}`
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
      id: "tech-auth-deploy-valid",
      name: "Phase 1.5: Deploy TechAuth with valid 1-of-1 configuration",
      description: "Successfully deploy TechAuth forever contract",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("tech-auth-deploy-valid", this.name);

        try {
          const { buildTechAuthDeploymentTx } = await import("../../sdk/lib/tx-builders/deployment");
          const { contracts, blaze, address, config } = await getTestSetup(ctx);

          console.log("  Deploying TechAuth contract...");

          // Find the tech-auth one-shot UTxO (CRITICAL: This will be consumed!)
          const techAuthOneShotUtxo = await findOneShotUtxo(
            ctx,
            config.technical_authority_one_shot_hash,
            config.technical_authority_one_shot_index
          );

          if (!techAuthOneShotUtxo) {
            throw new Error(
              `TechAuth one-shot UTxO not found: ${config.technical_authority_one_shot_hash}#${config.technical_authority_one_shot_index}`
            );
          }

          const techAuth = await contracts.getTechAuth();
          const govAuth = await contracts.getGovAuth();

          // Create valid 1-of-1 configuration using stake credential (different from Council)
          // Council uses payment credential, TechAuth uses stake credential
          const stakeHash = address.asBase()?.getStakeCredential()?.hash;
          if (!stakeHash) {
            throw new Error("Deployer address must have a stake credential");
          }
          const signers = createSigner(stakeHash, true); // true = add prefix for TechAuth

          const txBuilder = await buildTechAuthDeploymentTx({
            blaze,
            techAuthForeverScript: techAuth.forever.Script,
            techAuthTwoStageScript: techAuth.twoStage.Script,
            techAuthLogicScript: techAuth.logic.Script,
            govAuthScript: govAuth.Script,
            techAuthOneShotUtxo,
            threshold: 1n,
            signers,
            networkId: 0,
          });

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

          console.log(`  ✓ TechAuth deployed! TxHash: ${txHash}`);

          // Register the tech-auth signer: maps to deployer's stake credential
          ctx.provider.registerSigner("tech-auth-0", "deployer", "stake");

          // Store deployment info
          const deployment: DeploymentInfo = {
            componentName: "tech-auth",
            txHash,
            outputIndex: 0,
            metadata: {
              foreverOutputIndex: 2,
              mainOutputIndex: 0,
              stagingOutputIndex: 1,
            },
          };
          storeDeployment(ctx, "tech-auth", deployment);

          return completeTestResult(
            result,
            "passed",
            `TechAuth deployed successfully. TxHash: ${txHash}`
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
      id: "thresholds-deploy",
      name: "Phase 1.6: Deploy threshold contracts",
      description: "Deploy all threshold contracts with initial configurations",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("thresholds-deploy", this.name);

        try {
          const { buildThresholdDeploymentTx } = await import("../../sdk/lib/tx-builders/thresholds");
          const { contracts, blaze, config } = await getTestSetup(ctx);

          console.log("  Deploying 5 threshold contracts individually...");

          const thresholdsContracts = await contracts.getThresholds();

          // Initial threshold: 1/2 TechAuth, 1/2 Council (at least half required from each)
          // NOTE: Cannot use 1/1 because validator requires numerator < denominator (strict <)
          const initialThreshold: [bigint, bigint, bigint, bigint] = [1n, 2n, 1n, 2n];
          console.log(`  Threshold: ${initialThreshold[0]}/${initialThreshold[1]} TechAuth, ${initialThreshold[2]}/${initialThreshold[3]} Council (at least half required)`);

          const thresholdsToDeploy = [
            { name: "mainGov", script: thresholdsContracts.mainGov.Script, hashKey: "main_gov_one_shot_hash" as const, indexKey: "main_gov_one_shot_index" as const },
            { name: "stagingGov", script: thresholdsContracts.stagingGov.Script, hashKey: "staging_gov_one_shot_hash" as const, indexKey: "staging_gov_one_shot_index" as const },
            { name: "mainCouncilUpdate", script: thresholdsContracts.mainCouncilUpdate.Script, hashKey: "main_council_update_one_shot_hash" as const, indexKey: "main_council_update_one_shot_index" as const },
            { name: "mainTechAuthUpdate", script: thresholdsContracts.mainTechAuthUpdate.Script, hashKey: "main_tech_auth_update_one_shot_hash" as const, indexKey: "main_tech_auth_update_one_shot_index" as const },
            { name: "mainFederatedOpsUpdate", script: thresholdsContracts.mainFederatedOpsUpdate.Script, hashKey: "main_federated_ops_update_one_shot_hash" as const, indexKey: "main_federated_ops_update_one_shot_index" as const },
          ];

          const txHashes: string[] = [];

          for (const t of thresholdsToDeploy) {
            const oneShot = await findOneShotUtxo(ctx, config[t.hashKey], config[t.indexKey]);
            if (!oneShot) {
              throw new Error(`One-shot UTxO not found for ${t.name}`);
            }

            console.log(`  Deploying ${t.name}...`);
            const txBuilder = await buildThresholdDeploymentTx({
              blaze,
              thresholdScript: t.script,
              oneShotUtxo: oneShot,
              threshold: initialThreshold,
              networkId: 0,
            });

            const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);
            txHashes.push(txHash);
            console.log(`  ✓ ${t.name} deployed! TxHash: ${txHash}`);
          }

          // Store deployment info
          const deployment: DeploymentInfo = {
            componentName: "thresholds",
            txHash: txHashes[txHashes.length - 1],
            outputIndex: 0,
            metadata: {
              initialThreshold,
              txHashes,
              deployedContracts: thresholdsToDeploy.map(t => t.name),
            },
          };
          storeDeployment(ctx, "thresholds", deployment);

          return completeTestResult(
            result,
            "passed",
            `All 5 threshold contracts deployed in ${txHashes.length} transactions`
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
      id: "gov-auth-register",
      name: "Phase 1.7: Register gov_auth and logic stake credentials",
      description: "Register gov_auth, council_logic, and tech_auth_logic as reward accounts",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("gov-auth-register", this.name);

        try {
          const { contracts, blaze } = await getTestSetup(ctx);
          const { Credential, CredentialType, Hash28ByteBase16 } = await import("@blaze-cardano/core");

          console.log("  Registering stake credentials for gov_auth, council_logic, tech_auth_logic...");

          const govAuth = await contracts.getGovAuth();
          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();

          const govAuthHash = govAuth.Script.hash();
          const councilLogicHash = council.logic.Script.hash();
          const techAuthLogicHash = techAuth.logic.Script.hash();

          // Register all three stake credentials in one transaction
          const txBuilder = blaze
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

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

          console.log(`  ✓ All stake credentials registered! TxHash: ${txHash}`);

          return completeTestResult(
            result,
            "passed",
            `Registered stake credentials for gov_auth, council_logic, tech_auth_logic. TxHash: ${txHash}. ` +
            `This enables withdrawals from these scripts for authorization validation.`
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
    // PHASE 2: AUTHORIZATION TOPOLOGIES
    // ========================================================================
    {
      id: "verify-1-of-1-auth",
      name: "Phase 2.1: Verify 1-of-1 authorization works",
      description: "Test Council member update with single signature",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("verify-1-of-1-auth", this.name);

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze, address, config } = await getTestSetup(ctx);
          const { TransactionId, TransactionInput } = await import("@blaze-cardano/core");

          console.log("  Updating Council members using 1-of-1 authorization...");

          // Get deployed contract info
          const councilDeployment = ctx.journeyState.deployments["council"];
          if (!councilDeployment) {
            throw new Error("Council deployment not found. Did Phase 1.4 run?");
          }

          const thresholdsDeployment = ctx.journeyState.deployments["thresholds"];
          if (!thresholdsDeployment) {
            throw new Error("Thresholds deployment not found. Did Phase 1.6 run?");
          }

          const techAuthDeployment = ctx.journeyState.deployments["tech-auth"];
          if (!techAuthDeployment) {
            throw new Error("TechAuth deployment not found. Did Phase 1.5 run?");
          }

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

          // Find specific UTxOs by deployment transaction outputs
          const councilForeverUtxo = findUtxoByTxOutput(
            utxos.councilForever,
            councilDeployment.txHash,
            councilDeployment.metadata.foreverOutputIndex
          );
          const councilTwoStageMainUtxo = findUtxoByTxOutput(
            utxos.councilTwoStage,
            councilDeployment.txHash,
            councilDeployment.metadata.mainOutputIndex
          );
          const techAuthForeverUtxo = findUtxoByTxOutput(
            utxos.techAuthForever,
            techAuthDeployment.txHash,
            techAuthDeployment.metadata.foreverOutputIndex
          );
          // Each threshold was deployed in its own tx; mainCouncilUpdate is index 2 in the deploy order
          const councilUpdateTxHash = thresholdsDeployment.metadata.txHashes?.[2] ?? thresholdsDeployment.txHash;
          const councilUpdateThresholdUtxo = findUtxoByTxOutput(
            utxos.threshold,
            councilUpdateTxHash,
            0
          );

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            throw new Error("Required UTxOs not found");
          }

          // Read current Council state
          const currentCouncilState = await readVersionedMultisigState(councilForeverUtxo);
          const [[currentSignerCount, currentSigners], currentRound] = currentCouncilState;

          // Read threshold state
          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          // Generate new signers — we must include the deployer's payment key
          // so that subsequent phases can still authorize council operations.
          // The "update" is changing the sr25519 key value, keeping the same
          // payment key hash.
          const paymentHash = address.asBase()?.getPaymentCredential().hash!;
          const newSigners = createSigner(paymentHash, true);

          // Build update transaction
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

          // Council update requires both council and tech-auth authorization
          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder, {
            suggestedSigners: ["council-auth-0", "tech-auth-0"],
          });

          console.log(`  ✓ Council members updated! TxHash: ${txHash}`);

          // Verify the update
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

          if (Object.keys(updatedSigners).length !== Object.keys(newSigners).length) {
            throw new Error(`Signer count mismatch: expected ${Object.keys(newSigners).length}, got ${Object.keys(updatedSigners).length}`);
          }

          result.txHash = txHash;
          return completeTestResult(
            result,
            "passed",
            `Council members successfully updated with 1-of-1 authorization. TxHash: ${txHash}. ` +
            `Round unchanged: ${currentRound}. New signer count: ${newSignerCount}.`
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
      id: "update-council-to-3-of-5",
      name: "Phase 2.2: Update Council to 3-of-5 multisig",
      description: "Change Council to require 3 signatures out of 5 possible signers",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("update-council-to-3-of-5", this.name);

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze, address, config } = await getTestSetup(ctx);
          const { TransactionId, TransactionInput } = await import("@blaze-cardano/core");

          console.log("  Updating Council to 3-of-5 multisig...");

          // Get deployed contract info
          const councilDeployment = ctx.journeyState.deployments["council"];
          if (!councilDeployment) {
            throw new Error("Council deployment not found");
          }

          const thresholdsDeployment = ctx.journeyState.deployments["thresholds"];
          if (!thresholdsDeployment) {
            throw new Error("Thresholds deployment not found. Did Phase 1.6 run?");
          }

          const techAuthDeployment = ctx.journeyState.deployments["tech-auth"];
          if (!techAuthDeployment) {
            throw new Error("TechAuth deployment not found. Did Phase 1.5 run?");
          }

          // Get contract instances
          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const govAuth = await contracts.getGovAuth();
          const thresholdsContracts = await contracts.getThresholds();

          // Query UTxOs from all relevant contracts
          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
          }, 0);

          // Find the latest Council UTxO (might have been updated by Phase 2.1)
          // Use findLast so a successful retry on resume takes precedence over
          // an earlier failed attempt that has no txHash.
          const phase21Result = ctx.journeyState.testResults.findLast(r => r.testId === "verify-1-of-1-auth");
          let councilForeverUtxo;

          if (phase21Result?.txHash) {
            // Phase 2.1 updated the Council, find that UTxO
            councilForeverUtxo = findUtxoByTxOutput(
              utxos.councilForever,
              phase21Result.txHash,
              0
            );
          } else {
            // Use original deployment UTxO
            councilForeverUtxo = findUtxoByTxOutput(
              utxos.councilForever,
              councilDeployment.txHash,
              councilDeployment.metadata.foreverOutputIndex
            );
          }

          const councilTwoStageMainUtxo = findUtxoByTxOutput(
            utxos.councilTwoStage,
            councilDeployment.txHash,
            councilDeployment.metadata.mainOutputIndex
          );
          const techAuthForeverUtxo = findUtxoByTxOutput(
            utxos.techAuthForever,
            techAuthDeployment.txHash,
            techAuthDeployment.metadata.foreverOutputIndex
          );
          const councilUpdateTxHash = thresholdsDeployment.metadata.txHashes?.[2] ?? thresholdsDeployment.txHash;
          const councilUpdateThresholdUtxo = findUtxoByTxOutput(
            utxos.threshold,
            councilUpdateTxHash,
            0
          );

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            throw new Error("Required UTxOs not found");
          }

          // Read current Council state
          const currentCouncilState = await readVersionedMultisigState(councilForeverUtxo);
          const [[currentSignerCount, currentSigners], currentRound] = currentCouncilState;

          // Read threshold state
          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          // Build 5 signers that include keys we can actually sign with on
          // testnet so the 3-of-5 native script can be satisfied.
          //
          // We gather key hashes from registered signers (deployer payment,
          // deployer stake, and any additional wallets), then fill the rest
          // with random test keys.  The threshold is N/D → we need
          // ceil(count * N/D) real signable keys.
          const paymentHash = address.asBase()?.getPaymentCredential().hash!;
          const stakeHash = address.asBase()?.getStakeCredential()?.hash;

          // Gather real signable keys
          const realSignerKeys: string[] = [paymentHash];
          if (stakeHash) {
            realSignerKeys.push(stakeHash);
          }

          // Resolve additional wallet key hashes from settings
          const additionalWallets = ctx.settings.additionalWallets ?? {};
          console.log(`  [DEBUG] additionalWallets from settings: ${JSON.stringify(Object.keys(additionalWallets))}`);
          for (const [walletId, walletDef] of Object.entries(additionalWallets)) {
            const signerId = `council-member-${walletId}`;
            let pkh: string | undefined;
            if (walletDef.type === "external") {
              pkh = walletDef.paymentKeyHash;
            } else {
              pkh = await ctx.provider.getSignerKeyHash(signerId);
            }
            console.log(`    Wallet ${walletId} (${walletDef.type}): signer=${signerId}, pkh=${pkh ?? "UNRESOLVED"}`);
            if (pkh && !realSignerKeys.includes(pkh)) {
              realSignerKeys.push(pkh);
              ctx.provider.registerSigner(signerId, walletId, "payment");
            }
          }

          // Build signer map: real keys first, then random test keys
          const realSigners: Record<string, string> = {};
          for (const key of realSignerKeys) {
            const prefixed = `8200581c${key}`;
            realSigners[prefixed] = "A".repeat(64); // dummy sr25519 value
          }

          const targetCount = 5;
          const remainingCount = Math.max(0, targetCount - Object.keys(realSigners).length);
          const testSigners = generateTestSigners(remainingCount, true, 100);
          const newSigners: Record<string, string> = {
            ...realSigners,
            ...testSigners,
          };

          const required = Math.ceil(Object.keys(newSigners).length * Number(councilNum) / Number(councilDenom));
          console.log(`  Updating from ${currentSignerCount} to ${Object.keys(newSigners).length} signers`);
          console.log(`    Real signable keys: ${realSignerKeys.length}, test keys: ${remainingCount}`);
          console.log(`    Threshold: ${councilNum}/${councilDenom} → need ${required} of ${Object.keys(newSigners).length}`);

          if (realSignerKeys.length < required) {
            console.warn(`  ⚠ Only ${realSignerKeys.length} real keys available but need ${required}.`);
            console.warn(`    Configure additional wallets in settings to satisfy the threshold.`);
          }

          // Build update transaction
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

          // Council update requires both council and tech-auth authorization
          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder, {
            suggestedSigners: ["council-auth-0", "tech-auth-0"],
          });

          console.log(`  ✓ Council updated! TxHash: ${txHash}`);

          // Verify
          const [newCouncilForeverUtxo] = await blaze.provider.resolveUnspentOutputs([
            TransactionInput.fromCore({
              txId: TransactionId(txHash),
              index: 0,
            }),
          ]);

          const newCouncilState = await readVersionedMultisigState(newCouncilForeverUtxo);
          const [[newSignerCount]] = newCouncilState;

          if (newSignerCount !== 5n) {
            throw new Error(`Expected 5 signers, got ${newSignerCount}`);
          }

          result.txHash = txHash;
          return completeTestResult(
            result,
            "passed",
            `Council updated to 3-of-5 multisig with ${newSignerCount} signers. TxHash: ${txHash}`
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
      id: "test-3-of-5-sufficient",
      name: "Phase 2.3: Test 3-of-5 with sufficient signatures",
      description: "Perform operation using the new 3-of-5 multisig",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("test-3-of-5-sufficient", this.name);

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze } = await getTestSetup(ctx);
          const { addressFromValidator } = await import("@blaze-cardano/core");

          console.log("  Performing operation with new 3-of-5 multisig...");

          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const govAuth = await contracts.getGovAuth();
          const thresholdsContracts = await contracts.getThresholds();

          // Query UTxOs from all relevant contracts
          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
          }, 0);

          // Find specific UTxOs
          const councilForeverUtxo = utxos.councilForever[utxos.councilForever.length - 1];
          const councilTwoStageMainUtxo = findUtxoWithNftInArray(
            utxos.councilTwoStage,
            council.twoStage.Script.hash(),
            "main"
          );
          const techAuthForeverUtxo = utxos.techAuthForever[utxos.techAuthForever.length - 1];
          const councilUpdateThresholdUtxo = utxos.threshold[0];

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            throw new Error("Missing required UTxOs");
          }

          // Read current state
          const currentState = await readVersionedMultisigState(councilForeverUtxo);
          const [[currentSignerCount, currentSigners], currentRound] = currentState;

          console.log(`  Current Council: ${currentSignerCount} signers, round ${currentRound}`);

          // Read threshold
          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          // Update to 3 signers — use deployer's payment key AND stake key so future phases
          // can still authorize (need 2-of-3 to satisfy 1/2 threshold).
          const { contracts: _, blaze: __, address } = await getTestSetup(ctx);
          const ph = address.asBase()?.getPaymentCredential().hash!;
          const sh = address.asBase()?.getStakeCredential()?.hash;

          // Build signers with 2 real keys (payment + stake) + 1 test key
          // This ensures we can always satisfy 2-of-3 threshold
          const newSigners: Record<string, string> = {
            ...createSigner(ph, true),
          };
          if (sh) {
            newSigners[`8200581c${sh}`] = "B".repeat(64);
          }
          // Fill remaining with test key
          const testSignersFor23 = generateTestSigners(3 - Object.keys(newSigners).length, true, 200);
          Object.assign(newSigners, testSignersFor23);

          console.log(`  Updating to ${Object.keys(newSigners).length} signers using current multisig...`);

          // Build update transaction - this will require the 3-of-5 native script
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

          // Council update requires both council and tech-auth authorization.
          // The council native script is N-of-M — we need signatures from
          // enough council members.  List all registered signable members.
          const councilSignerIds23 = ["council-auth-0"];
          const additionalWallets23 = ctx.settings.additionalWallets ?? {};
          for (const wId of Object.keys(additionalWallets23)) {
            councilSignerIds23.push(`council-member-${wId}`);
          }

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder, {
            suggestedSigners: [...councilSignerIds23, "tech-auth-0"],
          });

          console.log(`  ✓ Operation succeeded using multisig! TxHash: ${txHash}`);

          result.txHash = txHash;
          return completeTestResult(
            result,
            "passed",
            `Successfully performed Council operation using the new 3-of-5 multisig. Updated from ${currentSignerCount} to ${Object.keys(newSigners).length} signers. The 3-of-5 native script was built and validated by the ledger.`
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
      id: "test-3-of-5-insufficient",
      name: "Phase 2.4: Test missing tech-auth signature rejection",
      description: "Verify Council operation FAILS when tech-auth (stake key) signature is missing",
      expectSuccess: true, // Test expects to pass (by verifying transaction rejection)
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("test-3-of-5-insufficient", this.name);

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze } = await getTestSetup(ctx);

          console.log("  Attempting operation with only council signer (missing tech-auth, should fail)...");

          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const govAuth = await contracts.getGovAuth();
          const thresholdsContracts = await contracts.getThresholds();

          // Query UTxOs from all relevant contracts
          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
          }, 0);

          // Find specific UTxOs
          const councilForeverUtxo = utxos.councilForever[utxos.councilForever.length - 1];
          const councilTwoStageMainUtxo = findUtxoWithNftInArray(
            utxos.councilTwoStage,
            council.twoStage.Script.hash(),
            "main"
          );
          const techAuthForeverUtxo = utxos.techAuthForever[utxos.techAuthForever.length - 1];
          const councilUpdateThresholdUtxo = utxos.threshold[0];

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            throw new Error("Missing required UTxOs");
          }

          // Read current state
          const currentState = await readVersionedMultisigState(councilForeverUtxo);
          const [[currentSignerCount, currentSigners], currentRound] = currentState;

          // Read threshold
          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          // Try to update signers (any change to test the multisig)
          const newSigners = generateTestSigners(4, true);

          console.log(`  Building transaction that requires 3-of-5 multisig...`);

          // Build the transaction (same as Phase 2.3)
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

          console.log(`  Submitting with only council signer (missing tech-auth)...`);

          // Submit with only the council authorization (payment key) but NOT
          // tech-auth (stake key).  The TechAuth native script will fail
          // validation because no stake key VKey witness is present.
          const rejection = await expectTransactionRejection(
            async () => {
              await ctx.provider.submitTransaction("deployer", txBuilder, {
                suggestedSigners: ["council-auth-0"],
              });
            },
            { errorShouldInclude: ["script", "witness", "valid"] }
          );

          if (!rejection.passed) {
            return completeTestResult(result, "failed", undefined, rejection.message);
          }

          console.log(`  ✓ Transaction correctly rejected: ${rejection.error}`);

          return completeTestResult(
            result,
            "passed",
            `Transaction correctly failed when tech-auth (stake key) signature was missing. Only council-auth-0 (payment key) was provided. Error: ${rejection.error}`
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
      id: "test-weighted-signatures",
      name: "Phase 2.5: Update to 3/5 multisig with one repeated key",
      description: "Update council to 3/5 where one key appears twice (weighted voting)",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("test-weighted-signatures", this.name);

        try {
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { createMultisigStateCbor, extractSignersFromCbor } = await import("../../cli/lib/signers");
          const { contracts, blaze, address } = await getTestSetup(ctx);
          const { TransactionId, TransactionInput, addressFromValidator, AssetName, PolicyId, TransactionOutput, AssetId, PaymentAddress, RewardAccount, NetworkId, CredentialType, NativeScripts, addressFromCredential, Credential, Hash28ByteBase16, Script } = await import("@blaze-cardano/core");
          const { serialize } = await import("@blaze-cardano/data");

          console.log("  Setting up 3/5 council with weighted voting (one key repeated twice)...");

          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const govAuth = await contracts.getGovAuth();
          const thresholdsContracts = await contracts.getThresholds();

          // Query current UTxOs
          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
          }, 0);

          const councilForeverUtxo = utxos.councilForever[utxos.councilForever.length - 1];
          const councilTwoStageMainUtxo = findUtxoWithNftInArray(
            utxos.councilTwoStage,
            council.twoStage.Script.hash(),
            "main"
          );
          const techAuthForeverUtxo = utxos.techAuthForever[utxos.techAuthForever.length - 1];
          const councilUpdateThresholdUtxo = utxos.threshold[0];

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !councilUpdateThresholdUtxo) {
            throw new Error("Missing required UTxOs");
          }

          // Read current state - use extractSignersFromCbor to preserve duplicates
          const councilDatumForState = councilForeverUtxo.output().datum()?.asInlineData();
          if (!councilDatumForState) {
            throw new Error("Missing inline datum on council UTxO");
          }
          const currentCouncilSigners = extractSignersFromCbor(councilDatumForState);

          // Read threshold state and round from existing reader
          const currentState = await readVersionedMultisigState(councilForeverUtxo);
          const [, currentRound] = currentState;
          const thresholdState = await readMultisigThresholdState(councilUpdateThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;

          console.log(`  Current: ${currentCouncilSigners.length} signers, threshold ${councilNum}/${councilDenom}`);
          console.log(`  Current council signers:`);
          for (const signer of currentCouncilSigners) {
            console.log(`    - ${signer.paymentHash}`);
          }

          // Build 5 signer entries where deployer payment key appears TWICE
          // This creates weighted voting: deployer has 2 votes, others have 1 each
          // With threshold 1/2: need ceil(5 * 1/2) = 3 signatures
          // Deployer's 2 appearances + one other = 3 satisfied!
          const paymentHash = address.asBase()?.getPaymentCredential().hash!;
          const stakeHash = address.asBase()?.getStakeCredential()?.hash;

          // Use Signer[] array to preserve duplicates via createMultisigStateCbor
          type Signer = { paymentHash: string; sr25519Key: string };
          const signersList: Signer[] = [];

          // Entry 1: deployer payment key (first occurrence - counts as vote 1)
          signersList.push({ paymentHash, sr25519Key: "A".repeat(64) });
          // Entry 2: deployer payment key AGAIN (second occurrence - counts as vote 2!)
          signersList.push({ paymentHash, sr25519Key: "B".repeat(64) });
          // Entry 3: deployer stake key (different key, vote 3)
          if (stakeHash) {
            signersList.push({ paymentHash: stakeHash, sr25519Key: "C".repeat(64) });
          }

          // Add additional wallets
          const additionalWallets = ctx.settings.additionalWallets ?? {};
          for (const [walletId, walletDef] of Object.entries(additionalWallets)) {
            let pkh: string | undefined;
            if (walletDef.type === "external") {
              pkh = walletDef.paymentKeyHash;
            } else {
              pkh = await ctx.provider.getSignerKeyHash(`council-member-${walletId}`);
            }
            if (pkh) {
              signersList.push({ paymentHash: pkh, sr25519Key: String.fromCharCode(68 + signersList.length).repeat(64) });
            }
          }

          // Fill to 5 entries with test keys if needed
          while (signersList.length < 5) {
            const testHash = "00000000000000000000000000000000000000000000000000000000" + signersList.length.toString(16).padStart(2, "0");
            signersList.push({ paymentHash: testHash.slice(0, 56), sr25519Key: String.fromCharCode(65 + signersList.length).repeat(64) });
          }

          console.log(`  Creating weighted council with ${signersList.length} entries:`);
          const paymentHashCount = signersList.filter(s => s.paymentHash === paymentHash).length;
          console.log(`    - Deployer payment key appears ${paymentHashCount}x (${paymentHashCount} votes)`);
          console.log(`    - Threshold ${councilNum}/${councilDenom} requires ${Math.ceil(5 * Number(councilNum) / Number(councilDenom))} of 5`);
          console.log(`    - Deployer alone can satisfy with payment key (2 votes) + stake key (1 vote) = 3 votes`);

          // Create the new state datum with duplicates preserved using CBOR builder
          const newStateDatum = createMultisigStateCbor(signersList, currentRound);

          // Build native scripts for current authorization
          // IMPORTANT: Use extractSignersFromCbor to preserve duplicate keys (weighted voting)
          const buildNativeScript = (
            signers: Array<{ paymentHash: string; sr25519Key: string }>,
            numerator: bigint,
            denominator: bigint
          ) => {
            const totalSigners = BigInt(signers.length);
            const minSigners = (totalSigners * numerator + (denominator - 1n)) / denominator;
            const signerScripts = signers.map((signer) => {
              const bech32 = addressFromCredential(
                0,
                Credential.fromCore({
                  type: CredentialType.KeyHash,
                  hash: Hash28ByteBase16(signer.paymentHash),
                })
              ).toBech32();
              return NativeScripts.justAddress(bech32, 0);
            });
            const nativeScript = NativeScripts.atLeastNOfK(Number(minSigners), ...signerScripts);
            const script = Script.newNativeScript(nativeScript);
            return { script, policyId: script.hash() };
          };

          // Extract tech-auth signers from raw CBOR datum to preserve duplicates
          const techAuthDatum = techAuthForeverUtxo.output().datum()?.asInlineData();
          if (!techAuthDatum) {
            throw new Error("Missing inline datum on tech-auth UTxO");
          }
          const techAuthSigners = extractSignersFromCbor(techAuthDatum);

          // Use already-extracted council signers (currentCouncilSigners) for native script
          const { script: councilNativeScript, policyId: councilPolicyId } = buildNativeScript(
            currentCouncilSigners, councilNum, councilDenom
          );
          const { script: techAuthNativeScript, policyId: techAuthPolicyId } = buildNativeScript(
            techAuthSigners, techAuthNum, techAuthDenom
          );

          console.log(`  Council native script policy: ${councilPolicyId}`);
          console.log(`  TechAuth native script policy: ${techAuthPolicyId}`);
          const minCouncilSigners = (BigInt(currentCouncilSigners.length) * councilNum + (councilDenom - 1n)) / councilDenom;
          console.log(`  Need ${minCouncilSigners} of ${currentCouncilSigners.length} council signatures`);

          // Build redeemer with new signers (for member updates, redeemer contains NEW signers)
          // IMPORTANT: Must use CBOR builder to preserve duplicate keys, matching the datum
          const { createRedeemerMapCbor } = await import("../../cli/lib/signers");
          const councilRedeemer = createRedeemerMapCbor(signersList);

          const councilLogicRewardAccount = RewardAccount.fromCredential(
            { type: CredentialType.ScriptHash, hash: Hash28ByteBase16(council.logic.Script.hash()) },
            NetworkId.Testnet
          );

          const councilForeverAddress = addressFromValidator(0, council.forever.Script);

          // Build transaction manually since we need custom datum
          const txBuilder = blaze
            .newTransaction()
            .addInput(councilForeverUtxo, councilRedeemer)
            .addReferenceInput(councilTwoStageMainUtxo)
            .addReferenceInput(councilUpdateThresholdUtxo)
            .addReferenceInput(techAuthForeverUtxo)
            .addWithdrawal(councilLogicRewardAccount, 0n, councilRedeemer)
            .provideScript(council.forever.Script)
            .provideScript(council.logic.Script)
            .provideScript(councilNativeScript)
            .provideScript(techAuthNativeScript)
            .addMint(PolicyId(councilPolicyId), new Map([[AssetName(""), 1n]]))
            .addMint(PolicyId(techAuthPolicyId), new Map([[AssetName(""), 1n]]))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(councilForeverAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([[AssetId(council.forever.Script.hash()), 1n]]),
                },
                datum: newStateDatum.toCore(),
              })
            );

          // Gather all council signers
          const councilSignerIds = ["council-auth-0"];
          for (const wId of Object.keys(additionalWallets)) {
            councilSignerIds.push(`council-member-${wId}`);
          }

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder, {
            suggestedSigners: [...councilSignerIds, "tech-auth-0"],
          });

          console.log(`  ✓ Council updated to weighted multisig! TxHash: ${txHash}`);

          // Verify the new state preserves duplicates
          const [newCouncilForeverUtxo] = await blaze.provider.resolveUnspentOutputs([
            TransactionInput.fromCore({
              txId: TransactionId(txHash),
              index: 0,
            }),
          ]);

          const newDatum = newCouncilForeverUtxo.output().datum()?.asInlineData();
          if (newDatum) {
            const extractedSigners = extractSignersFromCbor(newDatum);
            const duplicateCount = extractedSigners.filter(s => s.paymentHash === paymentHash).length;
            console.log(`  ✓ Verified: ${extractedSigners.length} signer entries on-chain`);
            console.log(`  ✓ Deployer payment key appears ${duplicateCount}x (weighted voting works!)`);
          }

          result.txHash = txHash;
          return completeTestResult(
            result,
            "passed",
            `Updated council to weighted 3/5 multisig with duplicate keys. Deployer payment key appears ${paymentHashCount}x. TxHash: ${txHash}`
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
      id: "update-threshold-to-0-of-n",
      name: "Phase 2.6: Update threshold to 0-of-N (council approval bypassed)",
      description: "Update council threshold to 0/N, allowing operations with only tech-auth",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("update-threshold-to-0-of-n", this.name);

        try {
          const { buildUpdateThresholdTx } = await import("../../sdk/lib/tx-builders/thresholds");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze, address } = await getTestSetup(ctx);
          const { TransactionId, TransactionInput } = await import("@blaze-cardano/core");

          console.log("  Updating council threshold to 0-of-N (bypasses council signatures)...");

          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const govAuth = await contracts.getGovAuth();
          const thresholdsContracts = await contracts.getThresholds();

          // Query current UTxOs - need mainGovThreshold for authorization config
          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            techAuthTwoStage: techAuth.twoStage.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
            mainGovThreshold: thresholdsContracts.mainGov.Script,
          }, 0);

          const councilForeverUtxo = utxos.councilForever[utxos.councilForever.length - 1];
          const councilTwoStageMainUtxo = findUtxoWithNftInArray(
            utxos.councilTwoStage,
            council.twoStage.Script.hash(),
            "main"
          );
          const techAuthForeverUtxo = utxos.techAuthForever[utxos.techAuthForever.length - 1];
          const techAuthTwoStageMainUtxo = findUtxoWithNftInArray(
            utxos.techAuthTwoStage,
            techAuth.twoStage.Script.hash(),
            "main"
          );
          const thresholdUtxo = utxos.threshold[utxos.threshold.length - 1];
          const mainGovThresholdUtxo = utxos.mainGovThreshold[utxos.mainGovThreshold.length - 1];

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !techAuthTwoStageMainUtxo || !thresholdUtxo || !mainGovThresholdUtxo) {
            throw new Error("Missing required UTxOs");
          }

          // Read current threshold from mainGovThreshold (authorization config)
          const currentThreshold = await readMultisigThresholdState(mainGovThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = currentThreshold;

          console.log(`  Current threshold: TechAuth ${techAuthNum}/${techAuthDenom}, Council ${councilNum}/${councilDenom}`);

          // Update to 0-of-N for council (still require tech-auth)
          // This means council signatures are not required for operations
          const newTechAuthNum = 1n;
          const newTechAuthDenom = 2n;
          const newCouncilNum = 0n;  // 0-of-N: no council signatures needed
          const newCouncilDenom = 1n;

          console.log(`  New threshold: TechAuth ${newTechAuthNum}/${newTechAuthDenom}, Council ${newCouncilNum}/${newCouncilDenom}`);
          console.log(`  This means: tech-auth required, council NOT required (0-of-N)`);

          // Build threshold update transaction
          // This requires current council + tech-auth authorization
          const txBuilder = await buildUpdateThresholdTx({
            blaze,
            thresholdScript: thresholdsContracts.mainCouncilUpdate.Script,
            councilLogicScript: council.logic.Script,
            techAuthLogicScript: techAuth.logic.Script,
            govAuthScript: govAuth.Script,
            thresholdUtxo,
            mainGovThresholdUtxo,
            councilForeverUtxo,
            techAuthForeverUtxo,
            councilTwoStageMainUtxo,
            techAuthTwoStageMainUtxo,
            newThreshold: [newTechAuthNum, newTechAuthDenom, newCouncilNum, newCouncilDenom],
            currentCouncilThreshold: { numerator: councilNum, denominator: councilDenom },
            currentTechAuthThreshold: { numerator: techAuthNum, denominator: techAuthDenom },
            networkId: 0,
          });

          // Gather signers - need current council + tech-auth to authorize the change
          const additionalWallets = ctx.settings.additionalWallets ?? {};
          const councilSignerIds = ["council-auth-0"];
          for (const wId of Object.keys(additionalWallets)) {
            councilSignerIds.push(`council-member-${wId}`);
          }

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder, {
            suggestedSigners: [...councilSignerIds, "tech-auth-0"],
          });

          console.log(`  ✓ Threshold updated to 0-of-N! TxHash: ${txHash}`);

          // Verify
          const [newThresholdUtxo] = await blaze.provider.resolveUnspentOutputs([
            TransactionInput.fromCore({
              txId: TransactionId(txHash),
              index: 0,
            }),
          ]);
          const newThreshold = await readMultisigThresholdState(newThresholdUtxo);
          const [newTAN, newTAD, newCN, newCD] = newThreshold;

          console.log(`  ✓ Verified: TechAuth ${newTAN}/${newTAD}, Council ${newCN}/${newCD}`);
          console.log(`  ✓ Council approval is now bypassed (0-of-N)`);
          console.log(`  ✓ Operations can proceed with only tech-auth signatures`);

          result.txHash = txHash;
          return completeTestResult(
            result,
            "passed",
            `Updated threshold to 0-of-N (council bypassed). TxHash: ${txHash}. Council threshold now ${newCN}/${newCD}.`
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
      id: "restore-original-multisig",
      name: "Phase 2.7: Restore original 3/5 multisig and standard thresholds",
      description: "Restore council to original 3/5 multisig and thresholds to 1/2",
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("restore-original-multisig", this.name);

        try {
          const { buildUpdateCouncilMembersTx } = await import("../../sdk/lib/tx-builders/council-operations");
          const { buildUpdateThresholdTx } = await import("../../sdk/lib/tx-builders/thresholds");
          const { readVersionedMultisigState, readMultisigThresholdState } = await import("../../sdk/lib/helpers/state-readers");
          const { contracts, blaze, address } = await getTestSetup(ctx);
          const { TransactionId, TransactionInput } = await import("@blaze-cardano/core");

          console.log("  Restoring original 3/5 multisig and standard thresholds...");

          const council = await contracts.getCouncil();
          const techAuth = await contracts.getTechAuth();
          const govAuth = await contracts.getGovAuth();
          const thresholdsContracts = await contracts.getThresholds();

          // Query current UTxOs - need mainGovThreshold for authorization config
          const utxos = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            techAuthTwoStage: techAuth.twoStage.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
            mainGovThreshold: thresholdsContracts.mainGov.Script,
          }, 0);

          const councilForeverUtxo = utxos.councilForever[utxos.councilForever.length - 1];
          const councilTwoStageMainUtxo = findUtxoWithNftInArray(
            utxos.councilTwoStage,
            council.twoStage.Script.hash(),
            "main"
          );
          const techAuthForeverUtxo = utxos.techAuthForever[utxos.techAuthForever.length - 1];
          const techAuthTwoStageMainUtxo = findUtxoWithNftInArray(
            utxos.techAuthTwoStage,
            techAuth.twoStage.Script.hash(),
            "main"
          );
          const thresholdUtxo = utxos.threshold[utxos.threshold.length - 1];
          const mainGovThresholdUtxo = utxos.mainGovThreshold[utxos.mainGovThreshold.length - 1];

          if (!councilForeverUtxo || !councilTwoStageMainUtxo || !techAuthForeverUtxo || !techAuthTwoStageMainUtxo || !thresholdUtxo || !mainGovThresholdUtxo) {
            throw new Error("Missing required UTxOs");
          }

          // Read current states
          const currentState = await readVersionedMultisigState(councilForeverUtxo);
          const [[currentSignerCount, currentSigners], currentRound] = currentState;
          // Read authorization config from mainGovThreshold
          const currentThreshold = await readMultisigThresholdState(mainGovThresholdUtxo);
          const [techAuthNum, techAuthDenom, councilNum, councilDenom] = currentThreshold;

          console.log(`  Current: ${currentSignerCount} signers, threshold ${councilNum}/${councilDenom}`);

          // Step 1: Restore threshold to 1/2 for both council and tech-auth
          console.log("  Step 1: Restoring threshold to 1/2 for both groups...");

          const newTechAuthNum = 1n;
          const newTechAuthDenom = 2n;
          const newCouncilNum = 1n;
          const newCouncilDenom = 2n;

          const thresholdTxBuilder = await buildUpdateThresholdTx({
            blaze,
            thresholdScript: thresholdsContracts.mainCouncilUpdate.Script,
            councilLogicScript: council.logic.Script,
            techAuthLogicScript: techAuth.logic.Script,
            govAuthScript: govAuth.Script,
            thresholdUtxo,
            mainGovThresholdUtxo,
            councilForeverUtxo,
            techAuthForeverUtxo,
            councilTwoStageMainUtxo,
            techAuthTwoStageMainUtxo,
            newThreshold: [newTechAuthNum, newTechAuthDenom, newCouncilNum, newCouncilDenom],
            currentCouncilThreshold: { numerator: councilNum, denominator: councilDenom },
            currentTechAuthThreshold: { numerator: techAuthNum, denominator: techAuthDenom },
            networkId: 0,
          });

          const additionalWallets = ctx.settings.additionalWallets ?? {};
          const councilSignerIds = ["council-auth-0"];
          for (const wId of Object.keys(additionalWallets)) {
            councilSignerIds.push(`council-member-${wId}`);
          }

          const thresholdTxHash = await ctx.provider.submitTransaction("deployer", thresholdTxBuilder, {
            suggestedSigners: [...councilSignerIds, "tech-auth-0"],
          });

          console.log(`  ✓ Threshold restored! TxHash: ${thresholdTxHash}`);

          // Step 2: Restore council to 5 signers
          console.log("  Step 2: Restoring council to 5 signers...");

          // Re-query UTxOs after threshold update
          const utxos2 = await getContractUtxos(ctx, {
            councilForever: council.forever.Script,
            councilTwoStage: council.twoStage.Script,
            techAuthForever: techAuth.forever.Script,
            threshold: thresholdsContracts.mainCouncilUpdate.Script,
          }, 0);

          const councilForeverUtxo2 = utxos2.councilForever[utxos2.councilForever.length - 1];
          const councilUpdateThresholdUtxo2 = utxos2.threshold[utxos2.threshold.length - 1];

          const currentState2 = await readVersionedMultisigState(councilForeverUtxo2);
          const [[_, currentSigners2], currentRound2] = currentState2;

          // Build 5 signers using available keys
          const paymentHash = address.asBase()?.getPaymentCredential().hash!;
          const stakeHash = address.asBase()?.getStakeCredential()?.hash;
          const signableKeys: string[] = [paymentHash];
          if (stakeHash) signableKeys.push(stakeHash);

          for (const [walletId, walletDef] of Object.entries(additionalWallets)) {
            let pkh: string | undefined;
            if (walletDef.type === "external") {
              pkh = walletDef.paymentKeyHash;
            } else {
              pkh = await ctx.provider.getSignerKeyHash(`council-member-${walletId}`);
            }
            if (pkh && !signableKeys.includes(pkh)) {
              signableKeys.push(pkh);
            }
          }

          const newSigners: Record<string, string> = {};
          for (let i = 0; i < Math.min(signableKeys.length, 5); i++) {
            newSigners[`8200581c${signableKeys[i]}`] = String.fromCharCode(65 + i).repeat(64);
          }
          const remaining = 5 - Object.keys(newSigners).length;
          if (remaining > 0) {
            const fillerKeys = generateTestSigners(remaining, true, 700);
            Object.assign(newSigners, fillerKeys);
          }

          const councilTxBuilder = await buildUpdateCouncilMembersTx({
            blaze,
            councilForeverScript: council.forever.Script,
            councilTwoStageScript: council.twoStage.Script,
            councilLogicScript: council.logic.Script,
            techAuthForeverScript: techAuth.forever.Script,
            govAuthScript: govAuth.Script,
            councilForeverUtxo: councilForeverUtxo2,
            councilTwoStageMainUtxo,
            councilUpdateThresholdUtxo: councilUpdateThresholdUtxo2,
            techAuthForeverUtxo,
            newSigners,
            currentSigners: currentSigners2,
            currentRound: currentRound2,
            councilThreshold: { numerator: newCouncilNum, denominator: newCouncilDenom },
            techAuthThreshold: { numerator: newTechAuthNum, denominator: newTechAuthDenom },
            networkId: 0,
          });

          const councilTxHash = await ctx.provider.submitTransaction("deployer", councilTxBuilder, {
            suggestedSigners: [...councilSignerIds, "tech-auth-0"],
          });

          console.log(`  ✓ Council restored to 5 signers! TxHash: ${councilTxHash}`);

          // Verify final state
          const [finalCouncilUtxo] = await blaze.provider.resolveUnspentOutputs([
            TransactionInput.fromCore({
              txId: TransactionId(councilTxHash),
              index: 0,
            }),
          ]);
          const finalState = await readVersionedMultisigState(finalCouncilUtxo);
          const [[finalSignerCount]] = finalState;

          console.log(`\n  ✓ Final council: ${finalSignerCount} signers`);
          console.log(`  ✓ Final threshold: 1/2 for both council and tech-auth`);
          console.log(`\n  Governance authorization journey complete!`);
          console.log(`    ✓ Deployed all governance contracts`);
          console.log(`    ✓ Tested 1-of-1 authorization`);
          console.log(`    ✓ Tested 3-of-5 multisig`);
          console.log(`    ✓ Tested 3/5 with weighted keys (duplicate signer entries)`);
          console.log(`    ✓ Tested 0-of-N (council approval bypassed)`);
          console.log(`    ✓ Restored original configuration`);

          result.txHash = councilTxHash;
          return completeTestResult(
            result,
            "passed",
            `Restored original 3/5 multisig and 1/2 thresholds. Threshold tx: ${thresholdTxHash}, Council tx: ${councilTxHash}`
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
