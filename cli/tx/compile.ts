import {
  Credential,
  CredentialType,
  PlutusData,
  PolicyId,
  type SlotConfig,
  Transaction,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  TxBuilder,
  Wallet,
} from "@blaze-cardano/sdk";
import { makeUplcEvaluator } from "@blaze-cardano/vm";
import { Data, Effect, Either, Option } from "effect";
import type { CompileOptions, TxPlan } from "./plan";
import { createTxMetadata } from "./scripts";
import { Output } from "../output";
import {
  type NamedContract,
  validatorLabels,
  labelValidators,
  type ValidatorLabels,
} from "./labels";
import { Provider } from "../chain/provider";
import {
  type BlueprintError,
  type ConfigError,
  type ProviderError,
  renderError,
  TxBuildError,
} from "../errors";

/** Extract UPLC trace lines from an error message string. */
function extractTraces(errorMsg: string): string[] {
  const traces: string[] = [];
  for (const line of errorMsg.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith("Trace") ||
      trimmed.includes("Validator returned false") ||
      trimmed.includes("crashed / exited prematurely") ||
      trimmed.includes("failed script execution") ||
      trimmed.includes("EvaluationFailure") ||
      trimmed.includes("ScriptFailure")
    ) {
      traces.push(trimmed);
    }
  }
  return traces;
}

/** The advisory local UPLC phase did not pass; consumed inside completeChecked, never leaves it. */
class LocalUplcFailed extends Data.TaggedError("LocalUplcFailed")<{
  readonly cause: unknown;
}> {}

const localStep = <A>(f: () => A) =>
  Effect.try({ try: f, catch: (cause) => new LocalUplcFailed({ cause }) });

const describeBuildCause = (
  error: unknown,
  labels: ValidatorLabels,
): string[] => {
  if (!(error instanceof Error)) return [String(error)];
  const lines = [`Error: ${labelValidators(error.message, labels)}`];
  if ("cause" in error && error.cause) {
    const rendered = Either.getOrElse(
      Either.try(() =>
        JSON.stringify(
          error.cause,
          (_k, v) => (typeof v === "bigint" ? v.toString() : v),
          2,
        ),
      ),
      () => String(error.cause),
    );
    lines.push(`Cause: ${labelValidators(rendered, labels)}`);
  }
  return lines;
};

/** What the completion needs beyond the builder. */
interface Completion {
  readonly commandName: string;
  /** The chain's slot configuration, for the local evaluator. */
  readonly slotConfig: SlotConfig;
  /** Inputs the draft spends or references; enables the local UPLC phase. */
  readonly knownUtxos: readonly TransactionUnspentOutput[];
  /** The vkey witnesses the transaction carries at submit (witnessCount), counted in its size. */
  readonly witnesses: number;
  /** The contracts that name validators in traces, read in the local phase only; a failure there fails that phase alone. */
  readonly contracts: Effect.Effect<readonly NamedContract[], BlueprintError>;
}

/** Complete the builder, with the local evaluator when an advisory local UPLC run over the draft passed; a failure is a TxBuildError whose traces name the validators. */
const completeChecked = (
  txBuilder: TxBuilder,
  completion: Completion,
): Effect.Effect<
  Transaction,
  TxBuildError | ProviderError | ConfigError,
  Provider | Output
> =>
  Effect.gen(function* () {
    const { commandName } = completion;
    const knownUtxos = [...completion.knownUtxos];
    const provider = yield* Provider;
    const output = yield* Output;
    let traces: string[] = [];
    let labels: ValidatorLabels = {};
    let localEvaluator: Option.Option<ReturnType<typeof makeUplcEvaluator>> =
      Option.none();

    if (knownUtxos.length > 0) {
      yield* output.log("  Testing transaction locally (UPLC)...");
      const local = yield* Effect.either(
        Effect.gen(function* () {
          const params = yield* provider.parameters;
          const { draftTx, evaluator } = yield* localStep(() => ({
            draftTx: Transaction.fromCbor(txBuilder.toCbor()),
            evaluator: makeUplcEvaluator(
              params,
              1.2,
              1.2,
              completion.slotConfig,
            ),
          }));
          labels = validatorLabels(
            draftTx,
            knownUtxos,
            yield* completion.contracts,
          );
          yield* Effect.tryPromise({
            try: () => evaluator(draftTx, knownUtxos),
            catch: (cause) => new LocalUplcFailed({ cause }),
          });
          return evaluator;
        }),
      );
      if (Either.isRight(local)) {
        yield* output.success("Local UPLC test passed");
        localEvaluator = Option.some(local.right);
      } else {
        const rawMsg =
          local.left._tag === "LocalUplcFailed"
            ? String(local.left.cause)
            : renderError(local.left);
        traces = extractTraces(rawMsg);
        yield* Effect.logWarning(
          `Local UPLC test failed (non-fatal): ${commandName}`,
        ).pipe(
          Effect.annotateLogs({
            command: commandName,
            cause: labelValidators(rawMsg, labels),
            traces: traces.map((trace) => labelValidators(trace, labels)),
            redeemers: labels,
          }),
        );
      }
    }

    if (Option.isSome(localEvaluator))
      txBuilder.useEvaluator(localEvaluator.value);
    const { maxTxSize } = yield* provider.parameters;
    const tx = yield* completeBuilder(
      txBuilder,
      commandName,
      { maxTxSize, witnesses: completion.witnesses },
      traces,
      labels,
    );
    yield* output.success(`Transaction built: ${tx.getId()}`);
    return tx;
  });

/** The plan on a fresh Blaze builder, in the order the hand-written builders used (spends, references, scripts, mints, outputs, withdrawals, registrations, collateral), then change address, metadata and fee padding. */
export const toTxBuilder = (
  blaze: Blaze<BlazeProvider, Wallet>,
  plan: TxPlan,
  options: Pick<CompileOptions, "changeAddress" | "feePadding" | "metadata">,
): TxBuilder => {
  const txBuilder = blaze.newTransaction();
  for (const { utxo, redeemer } of plan.spends)
    txBuilder.addInput(utxo, Option.getOrUndefined(redeemer));
  for (const utxo of plan.references) txBuilder.addReferenceInput(utxo);
  for (const script of plan.scripts) txBuilder.provideScript(script);
  for (const { policy, assets, redeemer } of plan.mints)
    txBuilder
      .addMint(
        PolicyId(policy.hash()),
        new Map(assets),
        Option.getOrUndefined(redeemer),
      )
      .provideScript(policy);
  for (const output of plan.outputs) txBuilder.addOutput(output);
  for (const { rewardAccount, script, redeemer } of plan.withdrawals)
    txBuilder.addWithdrawal(rewardAccount, 0n, redeemer).provideScript(script);
  for (const script of plan.registrations)
    txBuilder.provideScript(script).addRegisterStake(
      Credential.fromCore({
        hash: script.hash(),
        type: CredentialType.ScriptHash,
      }),
      PlutusData.newInteger(0n),
    );
  if (plan.collateral.length > 0)
    txBuilder.provideCollateral([...plan.collateral]);
  txBuilder.setChangeAddress(options.changeAddress);
  if (Option.isSome(options.metadata))
    txBuilder.setMetadata(createTxMetadata(options.metadata.value));
  return txBuilder.setFeePadding(options.feePadding);
};

/** Compile a plan over the wallet's Blaze: announce the build, run the local UPLC check over the UTxOs it spends, references and offers as collateral, then complete and size-check it. */
export const compile = (plan: TxPlan, options: CompileOptions) =>
  Effect.gen(function* () {
    yield* Effect.flatMap(Output, (output) =>
      output.log("\nBuilding transaction..."),
    );
    const blaze = yield* Effect.flatMap(Provider, (provider) =>
      provider.blazeFor(options.wallet),
    );
    return yield* completeChecked(toTxBuilder(blaze, plan, options), {
      commandName: options.commandName,
      slotConfig: options.slotConfig,
      knownUtxos: [
        ...plan.spends.map(({ utxo }) => utxo),
        ...plan.references,
        ...plan.collateral,
      ],
      witnesses: options.expectedWitnesses,
      contracts: Effect.succeed(options.contracts),
    });
  });

/** One vkey witness in the witness set: [vkey (32 bytes), signature (64 bytes)] with its CBOR headers. */
const VKEY_WITNESS_BYTES = 101;
/** The witness set's vkey entry when the built transaction has none yet: key 0, the set tag and the array header. */
const VKEY_ENTRY_BYTES = 6;

/** The size of `tx` at submit, once it carries `witnesses` vkey witnesses more than it has now. */
export const sizeAtSubmit = (tx: Transaction, witnesses: number): number =>
  tx.toCbor().length / 2 +
  witnesses * VKEY_WITNESS_BYTES +
  (witnesses > 0 && tx.witnessSet().vkeys() === undefined
    ? VKEY_ENTRY_BYTES
    : 0);

/** Complete the builder with no output; a failure is a TxBuildError carrying the earlier traces, the failure's own and the validator labels, and so is a transaction whose size at submit, its vkey witnesses counted, is over `maxTxSize`. */
const completeBuilder = (
  txBuilder: TxBuilder,
  commandName: string,
  limit: { readonly maxTxSize: number; readonly witnesses: number },
  traces: readonly string[] = [],
  labels: ValidatorLabels = {},
): Effect.Effect<Transaction, TxBuildError> =>
  Effect.filterOrFail(
    completed(txBuilder, commandName, traces, labels),
    (tx) => sizeAtSubmit(tx, limit.witnesses) <= limit.maxTxSize,
    (tx) =>
      new TxBuildError({
        command: commandName,
        traces: [],
        cause: undefined,
        size: {
          bytes: sizeAtSubmit(tx, limit.witnesses),
          witnesses: limit.witnesses,
          max: limit.maxTxSize,
        },
      }),
  );

const completed = (
  txBuilder: TxBuilder,
  commandName: string,
  traces: readonly string[],
  labels: ValidatorLabels,
): Effect.Effect<Transaction, TxBuildError> =>
  Effect.tryPromise({
    try: () => txBuilder.complete(),
    catch: (cause) =>
      new TxBuildError({
        command: commandName,
        traces: [
          ...traces.map((t) => labelValidators(t, labels)),
          ...extractTraces(String(cause)).map((t) =>
            labelValidators(t, labels),
          ),
          ...Object.entries(labels).map(([ref, name]) => `${ref} -> ${name}`),
          ...describeBuildCause(cause, labels),
        ],
        cause,
      }),
  });
