/**
 * merge-utxos: spend two value-holding UTxOs at a reserve or ICS forever
 * validator into one output that holds exactly their ADA and cNIGHT, keeping
 * the first UTxO's datum, under the logic named by the two-stage main state.
 * The program resolves the UTxOs and the logic script; buildMergeTx is pure
 * over them.
 */
import {
  type Address,
  addressFromValidator,
  type AssetId,
  type NetworkId,
  PlutusData,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
  Value,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Either, Option } from "effect";
import { cnightAssetId, Settings } from "../config/settings";
import { environmentOf } from "../config/network-mapping";
import {
  contractUtxos,
  deployerUtxo,
  upgradeScripts,
  upgradeStateAt,
} from "../chain/governance-provider";
import {
  createRewardAccount,
  findUtxoByTxRef,
  createTxMetadata,
  logicRedeemer,
  signAndWrite,
  UNSIGNED,
  withdrawThroughLogic,
  DEPLOYER_ONLY,
} from "../chain/transaction";
import { Output } from "../output";
import { buildTx } from "../chain/complete-tx";
import {
  type FeeInput,
  type TxFileInput,
  txFilePath,
  type TxHash,
  type TxIndex,
} from "../input";
import { Blueprint } from "../contracts/contracts";
import { Provider } from "../chain/provider";
import {
  DatumParseError,
  InputParseError,
  PreconditionFailed,
  UtxoNotFound,
} from "../errors";

const COMMAND = "merge-utxos";

/** A merge: the forever family, the two UTxOs to merge, its fee UTxO, and where the file goes. */
export interface MergeUtxosInput extends TxFileInput, FeeInput {
  readonly validator: "reserve" | "ics";
  readonly utxo1Hash: TxHash;
  readonly utxo1Index: TxIndex;
  readonly utxo2Hash: TxHash;
  readonly utxo2Index: TxIndex;
}

/** What the transaction is built from, resolved from the chain and the blueprint. */
export interface MergeInputs {
  readonly forever: Script;
  readonly utxo1: TransactionUnspentOutput;
  readonly utxo2: TransactionUnspentOutput;
  readonly twoStageMainUtxo: TransactionUnspentOutput;
  readonly userUtxo: TransactionUnspentOutput;
  /** The logic the two-stage main state names; its logic_round selects the redeemer shape. */
  readonly logicScript: Script;
  readonly logicRound: number;
}

export interface MergeParams {
  readonly cnightAssetId: AssetId;
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
}

interface MergeAmounts {
  readonly ada: bigint;
  readonly cnight1: bigint;
  readonly cnight2: bigint;
  readonly cnight: bigint;
}

/** The ADA and cNIGHT of both UTxOs; at least one must hold cNIGHT. */
const mergeAmounts = (
  utxo1: TransactionUnspentOutput,
  utxo2: TransactionUnspentOutput,
  cnight: AssetId,
): Either.Either<MergeAmounts, PreconditionFailed> => {
  const value1 = utxo1.output().amount();
  const value2 = utxo2.output().amount();
  const cnight1 = value1.multiasset()?.get(cnight) ?? 0n;
  const cnight2 = value2.multiasset()?.get(cnight) ?? 0n;
  return cnight1 === 0n && cnight2 === 0n
    ? Either.left(
        new PreconditionFailed({
          command: COMMAND,
          refusal: { _tag: "NoCnight", asset: cnight },
        }),
      )
    : Either.right({
        ada: value1.coin() + value2.coin(),
        cnight1,
        cnight2,
        cnight: cnight1 + cnight2,
      });
};

/** The merge: spend both forever UTxOs and the fee UTxO, withdraw through the logic, one output with exactly ADA + cNIGHT and the first datum. */
export const buildMergeTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: MergeInputs,
  params: MergeParams,
): Either.Either<TxBuilder, PreconditionFailed | DatumParseError> =>
  Either.gen(function* () {
    const amounts = yield* mergeAmounts(
      inputs.utxo1,
      inputs.utxo2,
      params.cnightAssetId,
    );
    const datum = yield* Either.fromNullable(
      inputs.utxo1.output().datum(),
      () =>
        new DatumParseError({
          what: "forever",
          cbor: "",
          reason: "First UTxO missing datum",
        }),
    );
    const redeemer = logicRedeemer(
      PlutusData.newInteger(0n),
      inputs.logicRound,
    );
    const merged = new TransactionOutput(
      addressFromValidator(params.networkId, inputs.forever),
      new Value(amounts.ada, new Map([[params.cnightAssetId, amounts.cnight]])),
    );
    merged.setDatum(datum);
    return withdrawThroughLogic(
      blaze
        .newTransaction()
        .addInput(inputs.utxo1, PlutusData.newInteger(0n))
        .addInput(inputs.utxo2, PlutusData.newInteger(0n))
        .addInput(inputs.userUtxo)
        .addReferenceInput(inputs.twoStageMainUtxo)
        .provideScript(inputs.forever),
      inputs.logicScript,
      Option.none(),
      redeemer,
      params.networkId,
    )
      .addOutput(merged)
      .setChangeAddress(params.changeAddress)
      .setMetadata(createTxMetadata(COMMAND))
      .setFeePadding(params.feePadding);
  });

/** Resolve the inputs, build, complete and write the merge transaction. */
export const mergeUtxosProgram = (input: MergeUtxosInput) =>
  Effect.gen(function* () {
    const { network, validator, utxo1Hash, utxo1Index, utxo2Hash, utxo2Index } =
      input;
    if (utxo1Hash === utxo2Hash && utxo1Index === utxo2Index) {
      return yield* new InputParseError({
        source: "--utxo2-hash/--utxo2-index",
        issues: [
          `UTxO 2 is UTxO 1 (${utxo1Hash}#${utxo1Index}): a merge needs two different UTxOs`,
        ],
      });
    }
    const { txHash, txIndex } = input;
    const out = yield* Output;
    const cfg = yield* Settings;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);

    yield* out.log(`\nMerging UTxOs on ${network} network`);
    yield* out.log(`Validator: ${validator}`);
    yield* out.log(`UTxO 1: ${utxo1Hash}#${utxo1Index}`);
    yield* out.log(`UTxO 2: ${utxo2Hash}#${utxo2Index}`);
    yield* out.log(`Fee UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const cnight = cnightAssetId(yield* cfg.profile);
    const { twoStage, forever, logic } = yield* blueprint.twoStage(validator);
    const foreverAddress = addressFromValidator(networkId, forever.Script);
    yield* out.log(`\nForever address: ${foreverAddress.toBech32()}`);
    yield* out.log(
      `Two-stage address: ${addressFromValidator(networkId, twoStage.Script).toBech32()}`,
    );

    const blaze = yield* provider.blaze;
    const found = yield* contractUtxos(
      { forever: forever.Script, twoStage: twoStage.Script },
      networkId,
    );
    yield* out.log("\nFound contract UTxOs:");
    yield* out.log(`  Forever: ${found.at("forever").length}`);
    yield* out.log(`  Two-stage: ${found.at("twoStage").length}`);
    const twoStageMainUtxo = yield* found.main("twoStage");
    const foreverUtxo = (hash: TxHash, index: TxIndex) =>
      Either.fromNullable(
        findUtxoByTxRef(found.at("forever"), hash, index),
        () => UtxoNotFound.byRef(`${hash}#${index}`, foreverAddress.toBech32()),
      );
    const utxo1 = yield* foreverUtxo(utxo1Hash, utxo1Index);
    const utxo2 = yield* foreverUtxo(utxo2Hash, utxo2Index);

    yield* out.log("\nReading two-stage upgrade state...");
    const { logicHash, mitigationLogicHash, logicRound } =
      yield* upgradeStateAt(twoStageMainUtxo);
    yield* out.log(`  Logic hash: ${logicHash}`);
    yield* out.log(
      `  Mitigation logic hash: ${mitigationLogicHash || "(empty)"}`,
    );
    yield* out.log(`  Logic round: ${logicRound}`);
    if (mitigationLogicHash) {
      return yield* new PreconditionFailed({
        command: COMMAND,
        refusal: { _tag: "MitigationActive", mitigationLogicHash },
      });
    }
    const { logic: logicScript } = yield* upgradeScripts(
      { logicHash, mitigationLogicHash },
      logic.Script.hash(),
    );
    yield* out.log(
      `\nLogic reward account: ${createRewardAccount(logicHash, networkId)}`,
    );

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );

    yield* out.log("\nMerging values:");
    const amounts = yield* mergeAmounts(utxo1, utxo2, cnight);
    yield* out.log(
      `  UTxO 1: ${utxo1.output().amount().coin()} lovelace, ${amounts.cnight1} CNIGHT`,
    );
    yield* out.log(
      `  UTxO 2: ${utxo2.output().amount().coin()} lovelace, ${amounts.cnight2} CNIGHT`,
    );
    yield* out.log(
      `  Merged: ${amounts.ada} lovelace, ${amounts.cnight} CNIGHT`,
    );
    yield* out.log("\nBuilding transaction...");

    const txBuilder = yield* buildMergeTx(
      blaze,
      {
        forever: forever.Script,
        utxo1,
        utxo2,
        twoStageMainUtxo,
        userUtxo,
        logicScript,
        logicRound,
      },
      {
        cnightAssetId: cnight,
        networkId,
        changeAddress,
        feePadding: input.feePadding,
      },
    );
    const tx = yield* buildTx(txBuilder, {
      commandName: COMMAND,
      witnesses: DEPLOYER_ONLY,
      knownUtxos: [utxo1, utxo2, twoStageMainUtxo, userUtxo],
    });
    yield* signAndWrite(tx, outputPath, UNSIGNED, "Merge UTxOs Transaction");
    return tx;
  });
