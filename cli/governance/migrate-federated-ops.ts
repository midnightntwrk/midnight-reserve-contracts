/**
 * migrate-federated-ops: rewrite the federated-ops forever datum from the v1
 * shape to FederatedOpsV2 through the promoted v2 logic's Migrate redeemer.
 * The program resolves the forever and two-stage main UTxOs and the logic
 * scripts the UpgradeState names; buildFederatedOpsMigrationTx is pure over
 * them. No multisig witnesses: the Migrate branch only checks the datum
 * rewrite against the forever state.
 */
import {
  type Address,
  addressFromValidator,
  AssetId,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Option } from "effect";
import { environmentOf } from "../config/network-mapping";
import {
  contractUtxos,
  ensureRegistered,
  deployerUtxo,
  upgradeScripts,
  upgradeStateAt,
} from "../chain/governance-provider";
import {
  createRewardAccount,
  decodeDatum,
  inlineDatum,
  createTxMetadata,
  signAndWrite,
  UNSIGNED,
  withdrawThroughLogic,
  DEPLOYER_ONLY,
} from "../chain/transaction";
import { Output } from "../output";
import { buildTx } from "../chain/complete-tx";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { Blueprint } from "../contracts/contracts";
import { Provider } from "../chain/provider";
import { PreconditionFailed } from "../errors";
import * as Contracts from "../../contract_blueprint";

const COMMAND = "migrate-federated-ops";

/** A federated ops migration: its fee UTxO and where the file goes. */
export type MigrateFederatedOpsInput = TxFileInput & FeeInput;

/** What the transaction is built from, resolved from the chain and the blueprint. */
export interface FederatedOpsMigrationInputs {
  readonly federatedOpsForever: Script;
  readonly foreverUtxo: TransactionUnspentOutput;
  readonly twoStageUtxo: TransactionUnspentOutput;
  readonly userUtxo: TransactionUnspentOutput;
  /** The v1 forever datum the migration rewrites. */
  readonly current: Contracts.FederatedOps;
  /** The logic the two-stage main state names; must carry a Migrate branch (v2+). */
  readonly logicScript: Script;
  readonly mitigationLogicScript: Option.Option<Script>;
}

export interface FederatedOpsMigrationParams {
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
}

/** LogicRedeemer::Migrate — constructor 1, no fields. */
const MIGRATE_REDEEMER = PlutusData.fromCore({
  constructor: 1n,
  fields: { items: [] },
});

/** The v1 forever datum rewritten as FederatedOpsV2 (empty message, logic_round 2). */
const migratedDatum = ([data, appendix]: Contracts.FederatedOps): PlutusData =>
  serialize(Contracts.FederatedOpsV2, [data, "", appendix, 2n]);

/** The migration: spend the forever UTxO into the v2 datum, withdraw through the logic (and mitigation logic) with Migrate, referencing two-stage main. */
export const buildFederatedOpsMigrationTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: FederatedOpsMigrationInputs,
  params: FederatedOpsMigrationParams,
): TxBuilder => {
  const { networkId } = params;
  const foreverAddress = addressFromValidator(
    networkId,
    inputs.federatedOpsForever,
  );
  const txBuilder = blaze
    .newTransaction()
    .addInput(inputs.userUtxo)
    .addInput(inputs.foreverUtxo, PlutusData.newInteger(0n))
    .addReferenceInput(inputs.twoStageUtxo)
    .provideScript(inputs.federatedOpsForever)
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(foreverAddress.toBech32()),
        value: {
          coins: inputs.foreverUtxo.output().amount().coin(),
          assets: new Map([[AssetId(inputs.federatedOpsForever.hash()), 1n]]),
        },
        datum: migratedDatum(inputs.current).toCore(),
      }),
    );
  return withdrawThroughLogic(
    txBuilder,
    inputs.logicScript,
    inputs.mitigationLogicScript,
    MIGRATE_REDEEMER,
    networkId,
  )
    .setChangeAddress(params.changeAddress)
    .setMetadata(createTxMetadata(COMMAND))
    .setFeePadding(params.feePadding);
};

/** Resolve the inputs, build, complete and write the migration transaction. */
export const migrateFederatedOpsProgram = (input: MigrateFederatedOpsInput) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex } = input;
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);

    yield* out.log(
      `\nMigrating Federated Ops datum from v1 to v2 on ${network} network`,
    );
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const contracts = yield* blueprint.instances;
    const forever = contracts.federatedOpsForever.Script;
    const twoStage = contracts.federatedOpsTwoStage.Script;
    const foreverAddress = addressFromValidator(networkId, forever);
    yield* out.log(
      `\nFederated Ops Forever Address: ${foreverAddress.toBech32()}`,
    );

    const blaze = yield* provider.blaze;
    const found = yield* contractUtxos(
      { federatedOpsForever: forever, federatedOpsTwoStage: twoStage },
      networkId,
    );
    yield* out.log("\nFound contract UTxOs:");
    yield* out.log(
      `  Federated ops forever: ${found.at("federatedOpsForever").length}`,
    );
    yield* out.log(
      `  Federated ops two stage: ${found.at("federatedOpsTwoStage").length}`,
    );
    const foreverUtxo = yield* found.first("federatedOpsForever");
    const twoStageUtxo = yield* found.main("federatedOpsTwoStage");

    yield* out.log("\nReading federated ops two-stage upgrade state...");
    const { logicHash, mitigationLogicHash } =
      yield* upgradeStateAt(twoStageUtxo);
    yield* out.log(`  Logic hash: ${logicHash}`);
    yield* out.log(
      `  Mitigation logic hash: ${mitigationLogicHash || "(empty)"}`,
    );

    // v1 logic has no Migrate branch
    if (logicHash === contracts.federatedOpsLogic.Script.hash()) {
      return yield* new PreconditionFailed({
        command: COMMAND,
        refusal: { _tag: "LogicNotV2", logicHash },
      });
    }
    const { logic: logicScript, mitigationLogic: mitigationLogicScript } =
      yield* upgradeScripts(
        { logicHash, mitigationLogicHash },
        "a federated ops logic with a Migrate branch (v2+) in the blueprint",
      );

    yield* out.log("\nCurrent federated ops forever datum:");
    const datum = yield* inlineDatum(foreverUtxo, "FederatedOps");
    if ((datum.asList()?.getLength() ?? 0) >= 4) {
      return yield* new PreconditionFailed({
        command: COMMAND,
        refusal: { _tag: "DatumAlreadyMigrated" },
      });
    }
    const current = yield* decodeDatum(datum, "FederatedOps", (d) =>
      parse(Contracts.FederatedOps, d),
    );
    yield* out.log(`  Current logic round: ${current[2]}`);
    yield* out.log(`  Appendix entries: ${current[1].length}`);
    yield* out.log("\nNew FederatedOpsV2 datum created:");
    yield* out.log("  message: (empty)");
    yield* out.log("  logic_round: 2");

    const logicRewardAccount = createRewardAccount(logicHash, networkId);
    yield* out.log(`\nLogic reward account: ${logicRewardAccount}`);
    const accounts = [
      {
        label: "Logic (v2)",
        rewardAccount: logicRewardAccount,
        scriptHash: logicHash,
      },
    ];
    if (Option.isSome(mitigationLogicScript)) {
      const mitigationRewardAccount = createRewardAccount(
        mitigationLogicHash,
        networkId,
      );
      yield* out.log(
        `Mitigation logic reward account: ${mitigationRewardAccount}`,
      );
      accounts.push({
        label: "Mitigation Logic",
        rewardAccount: mitigationRewardAccount,
        scriptHash: mitigationLogicHash,
      });
    }
    yield* ensureRegistered(accounts, network);

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );

    if (Option.isSome(mitigationLogicScript)) {
      yield* out.log("  Adding mitigation logic withdrawal...");
    }
    const txBuilder = buildFederatedOpsMigrationTx(
      blaze,
      {
        federatedOpsForever: forever,
        foreverUtxo,
        twoStageUtxo,
        userUtxo,
        current,
        logicScript,
        mitigationLogicScript,
      },
      {
        networkId,
        changeAddress,
        feePadding: input.feePadding,
      },
    );
    const tx = yield* buildTx(txBuilder, {
      commandName: COMMAND,
      environment: network,
      witnesses: DEPLOYER_ONLY,
      knownUtxos: [foreverUtxo, twoStageUtxo, userUtxo],
    });
    yield* signAndWrite(
      tx,
      outputPath,
      UNSIGNED,
      "Migrate Federated Ops Transaction",
    );
    yield* out.log(
      "\nNote: Migrate redeemer bypasses multisig validation - no signing required.",
    );
    return tx;
  });
