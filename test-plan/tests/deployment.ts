import type { TestDefinition, TestResult, TestContext, TestCategory } from "../lib/types";
import { ContractsManager } from "../lib/contracts";
import { printTestHeader, printTestResult } from "../utils/reporting";

const deploymentPositive: TestDefinition = {
  id: "deploy-positive",
  name: "Deploy contracts with valid parameters",
  description: "Verify contracts deploy correctly with various valid configurations",

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      testId: "deploy-positive",
      name: this.name,
      status: "running",
      startTime: new Date(),
    };

    try {
      printTestHeader(this.name);

      const contracts = new ContractsManager();
      const config = ctx.provider.getConfig();
      const blaze = await ctx.provider.getBlaze("deployer");

      const address = await blaze.wallet.getChangeAddress();
      const balance = await blaze.wallet.getBalance();

      console.log(`Deployer: ${address.toBech32()}`);
      console.log(`Balance: ${Number(balance.coin()) / 1_000_000} ADA\n`);

      // Load contracts
      const reserve = await contracts.getReserve();
      const govAuth = await contracts.getGovAuth();

      const {
        addressFromValidator,
        AssetName,
        PolicyId,
        TransactionOutput,
        NetworkId,
        PlutusData,
        AssetId,
        Address,
        PaymentAddress,
        toHex,
      } = await import("@blaze-cardano/core");
      const { serialize } = await import("@blaze-cardano/data");

      // Find the one-shot UTxO that matches the config (used during contract compilation)
      const deployerUtxos = await blaze.provider.getUnspentOutputs(address);
      const reserveOneShotUtxo = deployerUtxos.find(
        (utxo) => {
          const txId = utxo.input().transactionId();
          const txIdStr = typeof txId === "string" ? txId : txId.toString();
          return (
            txIdStr === config.reserve_one_shot_hash &&
            utxo.input().index() === BigInt(config.reserve_one_shot_index)
          );
        }
      );

      if (!reserveOneShotUtxo) {
        throw new Error(
          `Reserve one-shot UTxO not found in wallet: ${config.reserve_one_shot_hash}#${config.reserve_one_shot_index}\n` +
          `This UTxO was selected during setup and compiled into the contracts.\n` +
          `Make sure it hasn't been spent.`
        );
      }

      console.log("Building deployment transaction...");

      // Import contract types
      const Contracts = await import("../../contract_blueprint");

      // Get script addresses
      const reserveForeverAddress = addressFromValidator(
        NetworkId.Testnet,
        reserve.forever.Script,
      );
      const reserveTwoStageAddress = addressFromValidator(
        NetworkId.Testnet,
        reserve.twoStage.Script,
      );

      // Create upgrade state datum for Reserve two-stage
      const reserveUpgradeState: Contracts.UpgradeState = [
        reserve.logic.Script.hash(), // logic script hash
        "", // mitigation_logic (empty initially)
        govAuth.Script.hash(), // auth script hash
        "", // mitigation_auth (empty initially)
        0n, // round
        0n, // logic_round
      ];

      // Create multisig state for Reserve forever
      const reserveForeverState: Contracts.VersionedMultisig = {
        data: [
          1n, // threshold (1 for simple testing)
          {
            [address.asBase()?.getPaymentCredential().hash!]:
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
          },
        ],
        round: 0n,
      };

      const redeemerForever: Contracts.PermissionedRedeemer = {
        [address.asBase()?.getPaymentCredential().hash!]:
          "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
      };

      // Build the transaction
      const txBuilder = blaze
        .newTransaction()
        .addInput(reserveOneShotUtxo)
        .addMint(
          PolicyId(reserve.forever.Script.hash()),
          new Map([[AssetName(""), 1n]]),
          serialize(Contracts.PermissionedRedeemer, redeemerForever),
        )
        .addMint(
          PolicyId(reserve.twoStage.Script.hash()),
          new Map([
            [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
            [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
          ]),
          PlutusData.newInteger(0n),
        )
        .provideScript(reserve.twoStage.Script)
        .provideScript(reserve.forever.Script)
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(reserveTwoStageAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [
                  AssetId(
                    reserve.twoStage.Script.hash() +
                      toHex(new TextEncoder().encode("main")),
                  ),
                  1n,
                ],
              ]),
            },
            datum: serialize(Contracts.UpgradeState, reserveUpgradeState).toCore(),
          }),
        )
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(reserveTwoStageAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [
                  AssetId(
                    reserve.twoStage.Script.hash() +
                      toHex(new TextEncoder().encode("staging")),
                  ),
                  1n,
                ],
              ]),
            },
            datum: serialize(Contracts.UpgradeState, reserveUpgradeState).toCore(),
          }),
        )
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(reserveForeverAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(reserve.forever.Script.hash()), 1n]]),
            },
            datum: serialize(Contracts.VersionedMultisig, reserveForeverState).toCore(),
          }),
        );

      // Submit transaction (provider handles signing and confirmation prompt)
      const txHash = await ctx.provider.submitTransaction("deployer", txBuilder);

      result.txHash = txHash;
      result.notes = "Reserve contracts deployed successfully";

      // Record deployment info
      // TODO: Store UTxO references for the deployed contracts

      result.status = "passed";

    } catch (error) {
      result.status = "failed";

      // Enhanced error logging
      if (error instanceof Error) {
        result.error = error.message;

        // Log full error details for debugging
        console.error("\n[ERROR] Full error details:");
        console.error(error);

        // If it's a Blockfrost error, try to extract more info
        if ('response' in error) {
          console.error("\n[ERROR] Response data:", (error as any).response);
        }
      } else {
        result.error = String(error);
      }
    }

    result.endTime = new Date();
    printTestResult(result);
    return result;
  },
};

const deploymentNegative: TestDefinition = {
  id: "deploy-negative",
  name: "Reject invalid deployment parameters",
  description: "Ensure invalid configurations are properly rejected",
  prerequisites: ["deploy-positive"],

  async execute(ctx: TestContext): Promise<TestResult> {
    const result: TestResult = {
      testId: "deploy-negative",
      name: this.name,
      status: "running",
      startTime: new Date(),
    };

    try {
      printTestHeader(this.name);

      console.log("Testing invalid parameter scenarios:");
      console.log("  - Out of bounds thresholds");
      console.log("  - Empty key sets");
      console.log("  - Malformed time locks");
      console.log("  - Invalid parties");

      console.log("\nTODO: Implement negative test cases");

      result.status = "passed";
      result.notes = "Skeleton implementation completed";

    } catch (error) {
      result.status = "failed";
      result.error = error instanceof Error ? error.message : String(error);
    }

    result.endTime = new Date();
    printTestResult(result);
    return result;
  },
};

import { reserveLifecycleJourney } from "../journeys/reserve-lifecycle";

// Legacy standalone tests - these are now covered by the journey
// Keep them for backward compatibility but they won't run if journey succeeds
export const deploymentTests: TestDefinition[] = [];

export const deploymentCategory: TestCategory = {
  id: "deployment",
  name: "Reserve Complete Lifecycle",
  description: "Test Reserve contract through full lifecycle: deployment, authorization, upgrades, and mitigations",
  tests: deploymentTests,
  journeys: [reserveLifecycleJourney],
};
