import type {
  JourneyDefinition,
  JourneyContext,
  TestResult,
  DeploymentInfo,
} from "../lib/types";
import { ContractsManager } from "../lib/contracts";

/**
 * Helper to build a Council deployment transaction
 */
async function buildCouncilDeploymentTx(
  ctx: JourneyContext,
  params: {
    threshold: bigint;
    signers: Record<string, string>;
    councilOneShotUtxo: any;
  }
) {
  const { threshold, signers, councilOneShotUtxo } = params;

  const {
    addressFromValidator,
    AssetName,
    PolicyId,
    TransactionOutput,
    NetworkId,
    PlutusData,
    AssetId,
    PaymentAddress,
    toHex,
  } = await import("@blaze-cardano/core");
  const { serialize } = await import("@blaze-cardano/data");
  const Contracts = await import("../../contract_blueprint");

  const contracts = new ContractsManager();
  const council = await contracts.getCouncil();
  const govAuth = await contracts.getGovAuth();
  const blaze = await ctx.provider.getBlaze("deployer");
  const address = await blaze.wallet.getChangeAddress();

  // Get script addresses
  const councilForeverAddress = addressFromValidator(
    NetworkId.Testnet,
    council.forever.Script
  );
  const councilTwoStageAddress = addressFromValidator(
    NetworkId.Testnet,
    council.twoStage.Script
  );

  // Create upgrade state datum for Council two-stage
  const councilUpgradeState: Contracts.UpgradeState = [
    council.logic.Script.hash(),
    "",
    govAuth.Script.hash(),
    "",
    0n,
    0n,
  ];

  // Create multisig state for Council forever
  // VersionedMultisig is a tuple: [[total_signers, signers], round]
  const signerCount = BigInt(Object.keys(signers).length);

  // The datum stores prefixed keys (32 bytes each)
  const councilForeverState: Contracts.VersionedMultisig = [
    [signerCount, signers],
    0n,
  ];

  // The redeemer contains raw 28-byte payment hashes (without prefix)
  // The validator will call create_signer to add the prefix
  const redeemerSigners: Record<string, string> = {};
  for (const [key, value] of Object.entries(signers)) {
    // Remove the "8200581c" prefix to get the raw 28-byte hash
    const rawHash = key.replace(/^8200581c/i, '');
    redeemerSigners[rawHash] = value;
  }
  const redeemerForever: Contracts.PermissionedRedeemer = redeemerSigners;

  // Build the transaction
  return blaze
    .newTransaction()
    .addInput(councilOneShotUtxo)
    .addMint(
      PolicyId(council.forever.Script.hash()),
      new Map([[AssetName(""), 1n]]),
      serialize(Contracts.PermissionedRedeemer, redeemerForever)
    )
    .addMint(
      PolicyId(council.twoStage.Script.hash()),
      new Map([
        [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
        [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
      ]),
      PlutusData.newInteger(0n)
    )
    .provideScript(council.twoStage.Script)
    .provideScript(council.forever.Script)
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(councilTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [
              AssetId(
                council.twoStage.Script.hash() +
                  toHex(new TextEncoder().encode("main"))
              ),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, councilUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(councilTwoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [
              AssetId(
                council.twoStage.Script.hash() +
                  toHex(new TextEncoder().encode("staging"))
              ),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, councilUpgradeState).toCore(),
      })
    )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(councilForeverAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([[AssetId(council.forever.Script.hash()), 1n]]),
        },
        datum: serialize(Contracts.VersionedMultisig, councilForeverState).toCore(),
      })
    );
}

/**
 * Council Complete Lifecycle Journey
 *
 * Tests the full lifecycle of Council contracts from deployment through upgrades and mitigations.
 * Mirrors the Reserve lifecycle but for Council-specific operations and governance.
 */
export const councilLifecycleJourney: JourneyDefinition = {
  id: "council-lifecycle",
  name: "Council Complete Lifecycle",
  description: "Deploy, authorize, upgrade, and manage Council contracts through their full lifecycle",
  reuseContracts: true,
  steps: [
    // ========================================================================
    // PHASE 1: DEPLOYMENT
    // ========================================================================
    {
      id: "council-deploy-valid",
      name: "Phase 1.1: Deploy Council with valid parameters",
      description: "Establish baseline with successful Council deployment",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-deploy-valid",
          name: this.name,
          status: "running",
          startTime: new Date(),
        };

        try {
          const config = ctx.provider.getConfig();
          const blaze = await ctx.provider.getBlaze("deployer");
          const address = await blaze.wallet.getChangeAddress();

          console.log(`Deployer: ${address.toBech32()}`);

          // Find the council one-shot UTxO
          const deployerUtxos = await blaze.provider.getUnspentOutputs(address);
          const councilOneShotUtxo = deployerUtxos.find((utxo) => {
            const txId = utxo.input().transactionId();
            const txIdStr = typeof txId === "string" ? txId : txId.toString();
            return (
              txIdStr === config.council_one_shot_hash &&
              utxo.input().index() === BigInt(config.council_one_shot_index)
            );
          });

          if (!councilOneShotUtxo) {
            throw new Error(
              `Council one-shot UTxO not found: ${config.council_one_shot_hash}#${config.council_one_shot_index}`
            );
          }

          console.log("Building Council deployment transaction...");

          // Valid parameters: threshold 1, single signer
          // Add CBOR prefix "8200581c" to payment hash for NativeScriptSigner format
          const paymentHash = address.asBase()?.getPaymentCredential().hash!;
          const txBuilder = await buildCouncilDeploymentTx(ctx, {
            threshold: 1n,
            signers: {
              [`8200581c${paymentHash}`]:
                "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            },
            councilOneShotUtxo,
          });

          const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

          // Store deployment info for later steps
          const deployment: DeploymentInfo = {
            componentName: "council",
            txHash,
            outputIndex: 0,
          };
          ctx.journeyState.deployments["council-valid"] = deployment;

          result.txHash = txHash;
          result.status = "passed";
          result.notes = "Council deployed successfully with valid parameters";
        } catch (error) {
          result.status = "failed";
          result.error = error instanceof Error ? error.message : String(error);
        }

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-deploy-invalid-threshold-zero",
      name: "Phase 1.2: Reject Council deployment with threshold 0",
      description: "Attempt Council deployment with 0-of-1 threshold (invalid)",
      expectSuccess: false,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-deploy-invalid-threshold-zero",
          name: this.name,
          status: "todo",
          startTime: new Date(),
          notes: "Implement negative test - threshold 0\n" +
                 "  - Similar to Reserve, use different UTxO\n" +
                 "  - Should fail during multisig validation",
        };

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-deploy-invalid-empty-signers",
      name: "Phase 1.3: Reject Council deployment with empty signers",
      description: "Attempt Council deployment with no signers",
      expectSuccess: false,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-deploy-invalid-empty-signers",
          name: this.name,
          status: "todo",
          startTime: new Date(),
          notes: "Implement negative test - empty signers",
        };

        result.endTime = new Date();
        return result;
      },
    },

    // ========================================================================
    // PHASE 2: AUTHORIZATION VALIDATION
    // ========================================================================
    {
      id: "council-auth-test-1-of-1",
      name: "Phase 2.1: Test Council 1-of-1 authorization",
      description: "Verify current 1-of-1 multisig authorization works for Council operations",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-auth-test-1-of-1",
          name: this.name,
          status: "todo",
          startTime: new Date(),
          notes: "Implement Council 1-of-1 authorization test\n" +
                 "  - Execute Council operation (e.g., member update)\n" +
                 "  - Verify single signature is sufficient",
        };

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-auth-update-to-m-of-n",
      name: "Phase 2.2: Update Council to M-of-N multisig",
      description: "Update Council authorization to 3-of-5 threshold",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-auth-update-to-m-of-n",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-auth-test-3-deep-tree",
      name: "Phase 2.3: Test 3-deep authorization tree",
      description: "Test complex authorization with 3-level nested multisig",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-auth-test-3-deep-tree",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },

    // ========================================================================
    // PHASE 3: LOGIC UPGRADE - ABORT
    // ========================================================================
    {
      id: "council-upgrade-abort-stage",
      name: "Phase 3.1: Stage abort logic for Council",
      description: "Stage 'always fails' validator to Council staging UTxO",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-upgrade-abort-stage",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-upgrade-abort-verify",
      name: "Phase 3.2: Verify Council abort logic isolation",
      description: "Confirm Council staging uses abort logic, main unchanged",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-upgrade-abort-verify",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-upgrade-abort-revert",
      name: "Phase 3.3: Revert Council staging to original logic",
      description: "Restore Council staging to original logic hash",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-upgrade-abort-revert",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },

    // ========================================================================
    // PHASE 4: LOGIC UPGRADE - SUCCESS
    // ========================================================================
    {
      id: "council-upgrade-success-stage",
      name: "Phase 4.1: Stage new Council logic",
      description: "Stage new logic validator to Council staging UTxO",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-upgrade-success-stage",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-upgrade-success-promote",
      name: "Phase 4.2: Promote Council staging to main",
      description: "Swap Council staging and main NFTs to promote new logic",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-upgrade-success-promote",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },

    // ========================================================================
    // PHASE 5: LOGIC UPGRADE - DOWNGRADE
    // ========================================================================
    {
      id: "council-upgrade-downgrade-stage",
      name: "Phase 5.1: Stage old Council logic (downgrade)",
      description: "Stage previous Council logic hash back to staging",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-upgrade-downgrade-stage",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-upgrade-downgrade-promote",
      name: "Phase 5.2: Promote Council downgrade to main",
      description: "Swap to restore old Council logic to main",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-upgrade-downgrade-promote",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },

    // ========================================================================
    // PHASE 6: MITIGATION LOGIC
    // ========================================================================
    {
      id: "council-mitigation-logic-add",
      name: "Phase 6.1: Add Council mitigation logic script",
      description: "Add safety mitigation to Council logic scripts",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-mitigation-logic-add",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-mitigation-logic-remove-attempt",
      name: "Phase 6.2: Attempt to remove Council mitigation logic",
      description: "Verify Council mitigation cannot be removed (should fail)",
      expectSuccess: false,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-mitigation-logic-remove-attempt",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },

    // ========================================================================
    // PHASE 7: MITIGATION AUTH
    // ========================================================================
    {
      id: "council-mitigation-auth-add",
      name: "Phase 7.1: Add Council mitigation auth script",
      description: "Add authorization mitigation to Council",
      expectSuccess: true,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-mitigation-auth-add",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },
    {
      id: "council-mitigation-auth-remove-attempt",
      name: "Phase 7.2: Attempt to remove Council mitigation auth",
      description: "Verify Council auth mitigation cannot be removed (should fail)",
      expectSuccess: false,
      async execute(ctx: JourneyContext): Promise<TestResult> {
        const result: TestResult = {
          testId: "council-mitigation-auth-remove-attempt",
          name: this.name,
          status: "todo",
          startTime: new Date(),
        };

        result.status = "todo";
        result.notes = "Not yet implemented";

        result.endTime = new Date();
        return result;
      },
    },
  ],
};
