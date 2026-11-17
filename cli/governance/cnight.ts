/**
 * The cNIGHT mint contracts: register-cnight-mint-logic registers the mint
 * logic's stake credential, and run-cnight-mint-mainnet withdraws zero
 * from the mint forever and from the logic (and mitigation logic) its
 * two-stage main state names, with that UTxO as reference input.
 */
import {
  PlutusData,
  type Script,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect, Option } from "effect";
import {
  deployerUtxo,
  ensureRegistered,
  planningContext,
  refuseRegistered,
  scriptUtxos,
} from "../chain";
import { type Environment, environmentOf } from "../config";
import { ContractResolver } from "../contracts/resolver";
import { BlueprintError } from "../errors";
import { type TxHash, type TxIndex, txFilePath } from "../input";
import { Output } from "../output";
import {
  compileReported,
  signAndWrite,
  UNSIGNED,
  witnessCount,
} from "../signing";
import {
  createRewardAccount,
  type PlanningContext,
  type TxPlan,
  withdrawThroughLogic,
} from "../tx";
import { mainUtxoAt, upgradeScripts, upgradeStateAt } from "./two-stage";

/** A transaction command that pays its fee from a deployer UTxO. */
interface FeeInput {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
  readonly txHash: TxHash;
  readonly txIndex: TxIndex;
  readonly feePadding: bigint;
}

// register-cnight-mint-logic

/** The cNIGHT mint logic and the UTxO that pays for its registration. */
export interface CnightMintLogicRegistration {
  readonly feeUtxo: TransactionUnspentOutput;
  readonly cnightMintLogic: Script;
  readonly feePadding: bigint;
}

/** Register the cNIGHT mint logic as a stake credential, paying from the fee UTxO. */
export const planRegisterCnightMintLogic = (
  ctx: PlanningContext<CnightMintLogicRegistration>,
): TxPlan => ({
  spends: [{ utxo: ctx.resolved.feeUtxo, redeemer: Option.none() }],
  references: [],
  scripts: [],
  mints: [],
  outputs: [],
  withdrawals: [],
  registrations: [ctx.resolved.cnightMintLogic],
  collateral: [],
  metadata: Option.none(),
  feePadding: ctx.resolved.feePadding,
  expectedWitnesses: witnessCount(UNSIGNED, 0),
});

/** Register the cNIGHT mint logic's stake credential, refused when the chain already has it; the logic comes from the record when it holds it, else from the build; built (never submitted), unsigned, and written to a file. */
export const registerCnightMintLogicProgram = (input: FeeInput) =>
  Effect.gen(function* () {
    const command = "register-cnight-mint-logic";
    const { network, txHash, txIndex } = input;
    const output = yield* Output;
    yield* output.log(
      `\nRegistering cNIGHT mint logic script on ${network} network`,
    );
    yield* output.log(`Using UTxO: ${txHash}#${txIndex}`);

    const blueprint = yield* (yield* ContractResolver).toRegister(
      "cnightMintLogic",
    );
    const logic = (yield* blueprint.instances).cnightMintLogic;
    if (logic === undefined) {
      return yield* new BlueprintError({
        environment: network,
        source: blueprint.source,
        reason: `cNIGHT mint logic contract not found in the record or the build; run 'just build ${environmentOf(network).aikenConfigSection}' first`,
      });
    }
    const cnightMintLogic = logic.Script;
    yield* output.log(
      `\ncNIGHT mint logic script hash: ${cnightMintLogic.hash()}`,
    );
    yield* refuseRegistered(command, network, [
      { label: "cNIGHT mint logic", scriptHash: cnightMintLogic.hash() },
    ]);

    const { address: deployer, utxo: feeUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const ctx = yield* planningContext({
      command,
      environment: network,
      wallet: deployer,
      contracts: yield* blueprint.contracts,
      resolved: { feeUtxo, cnightMintLogic, feePadding: input.feePadding },
    });
    const tx = yield* compileReported(planRegisterCnightMintLogic(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      UNSIGNED,
      "Register cNIGHT Mint Logic Transaction",
    );
    return tx;
  });

// run-cnight-mint-mainnet

/** What the run references and withdraws through. */
export interface CnightMintRun {
  readonly forever: Script;
  readonly twoStageMainUtxo: TransactionUnspentOutput;
  readonly feeUtxo: TransactionUnspentOutput;
  readonly logicScript: Script;
  readonly mitigationLogicScript: Option.Option<Script>;
  readonly feePadding: bigint;
}

/** Zero withdrawals from the forever, the logic and, when set, the mitigation logic, each with the redeemer 0, the two-stage main referenced. */
export const planRunCnightMint = (
  ctx: PlanningContext<CnightMintRun>,
): TxPlan => {
  const run = ctx.resolved;
  const redeemer = PlutusData.newInteger(0n);
  return {
    spends: [{ utxo: run.feeUtxo, redeemer: Option.none() }],
    references: [run.twoStageMainUtxo],
    scripts: [],
    mints: [],
    outputs: [],
    withdrawals: [
      {
        rewardAccount: createRewardAccount(run.forever.hash(), ctx.networkId),
        script: run.forever,
        redeemer,
      },
      ...withdrawThroughLogic(
        run.logicScript,
        run.mitigationLogicScript,
        redeemer,
        ctx.networkId,
      ),
    ],
    registrations: [],
    collateral: [],
    metadata: Option.some(ctx.command),
    feePadding: run.feePadding,
    expectedWitnesses: witnessCount(UNSIGNED, 0),
  };
};

/** Run the cNIGHT mint forever and the logic its two-stage main state names, their reward accounts checked; built (never submitted), unsigned, and written to a file. */
export const runCnightMintProgram = (input: FeeInput) =>
  Effect.gen(function* () {
    const command = "run-cnight-mint-mainnet";
    const { network, txHash, txIndex } = input;
    const output = yield* Output;
    const blueprint = (yield* ContractResolver).contracts("actsOn");
    const { networkId } = environmentOf(network);

    yield* output.log(
      `\nRunning cNIGHT mint withdrawals on ${network} network`,
    );
    yield* output.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { twoStage, forever, logic } =
      yield* blueprint.twoStage("cnight-minting");
    const utxosAt = yield* scriptUtxos(
      { twoStage: twoStage.Script },
      networkId,
    );
    const twoStageMainUtxo = yield* mainUtxoAt(
      utxosAt("twoStage"),
      twoStage.Script,
      networkId,
    );
    yield* output.log("\nFound cNIGHT minting two-stage main UTxO");

    const { logicHash, mitigationLogicHash } =
      yield* upgradeStateAt(twoStageMainUtxo);
    yield* output.log(`  Logic hash: ${logicHash}`);
    yield* output.log(
      `  Mitigation logic hash: ${mitigationLogicHash || "(empty)"}`,
    );
    const { logic: logicScript, mitigationLogic: mitigationLogicScript } =
      yield* upgradeScripts(
        blueprint,
        { logicHash, mitigationLogicHash },
        logic.Script.hash(),
      );

    const accounts = [
      { label: "cNIGHT Mint Forever", scriptHash: forever.Script.hash() },
      { label: "cNIGHT Mint Logic", scriptHash: logicScript.hash() },
      ...Option.toArray(mitigationLogicScript).map((script) => ({
        label: "cNIGHT Mint Mitigation Logic",
        scriptHash: script.hash(),
      })),
    ];
    for (const { label, scriptHash } of accounts) {
      yield* output.log(
        `${label} reward account: ${createRewardAccount(scriptHash, networkId)}`,
      );
    }
    yield* ensureRegistered(network, accounts);

    const { address: deployer, utxo: feeUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const ctx = yield* planningContext({
      command,
      environment: network,
      wallet: deployer,
      contracts: yield* blueprint.contracts,
      resolved: {
        forever: forever.Script,
        twoStageMainUtxo,
        feeUtxo,
        logicScript,
        mitigationLogicScript,
        feePadding: input.feePadding,
      },
    });
    const tx = yield* compileReported(planRunCnightMint(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      UNSIGNED,
      "Run cNIGHT Mint Mainnet Transaction",
    );
    return tx;
  });
