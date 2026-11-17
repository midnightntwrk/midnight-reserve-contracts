/**
 * A transaction as data, and compile. A command resolves a PlanningContext
 * (all of its I/O), plans a TxPlan from it, and compile turns the two into
 * an unsigned transaction over Blaze's TxBuilder: coin selection from the
 * context's wallet UTxOs, balancing, script evaluation on the local Blaze
 * VM with the context's parameters, and the size check. compile takes no
 * service and never reads the chain. Blaze changes the objects it is given
 * (TxBuilder.checkAndAlterOutput sets the coin of an output's own Value),
 * so compile hands it CBOR copies of everything it takes from the plan or
 * the context, and compiling the same plan and context again gives the
 * same transaction.
 */
import {
  Address,
  AssetId,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  Metadata,
  Metadatum,
  MetadatumList,
  MetadatumMap,
  type NetworkId,
  PlutusData,
  PolicyId,
  type ProtocolParameters,
  RewardAccount,
  Script,
  type SlotConfig,
  Transaction,
  TransactionOutput,
  TransactionUnspentOutput,
  TxCBOR,
  type AssetName,
} from "@blaze-cardano/core";
import {
  calculateMinAda,
  calculateRequiredCollateral,
  TxBuilder,
} from "@blaze-cardano/tx";
import { makeUplcEvaluator } from "@blaze-cardano/vm";
import { Effect, Option } from "effect";
import { TxBuildError } from "./errors";

/** A blueprint contract as the trace labels need it: its class name and script hash. */
export interface NamedContract {
  readonly className: string;
  readonly hash: string;
}

/**
 * Everything a command's plan and compile read, resolved before planning:
 * the chain's parameters and slot configuration, the wallet coin selection
 * draws from and the UTxOs it must never spend, the contracts that name
 * validators in traces, and the command's own resolved inputs. It is data;
 * nothing reads the chain after it is built.
 */
export interface PlanningContext<Resolved = unknown> {
  /** The command, as errors name it. */
  readonly command: string;
  readonly networkId: NetworkId;
  readonly slotConfig: SlotConfig;
  readonly parameters: ProtocolParameters;
  /** The wallet: its address, which takes the change, and its UTxOs. */
  readonly wallet: {
    readonly address: Address;
    readonly utxos: readonly TransactionUnspentOutput[];
  };
  /** UTxO references ("txId#index") coin selection never spends: the profile's one-shots and collateral. */
  readonly reserved: ReadonlySet<string>;
  readonly contracts: readonly NamedContract[];
  readonly resolved: Resolved;
}

/** A transaction before completion: coin selection, balancing and evaluation are compile's. */
export interface TxPlan {
  /** Inputs, with the spend redeemer of a script input. */
  readonly spends: readonly {
    readonly utxo: TransactionUnspentOutput;
    readonly redeemer: Option.Option<PlutusData>;
  }[];
  readonly references: readonly TransactionUnspentOutput[];
  /** Scripts provided in the witness set for the spends. */
  readonly scripts: readonly Script[];
  /** Mints and burns, each under its policy, which is provided in the witness set; a native policy has no redeemer. */
  readonly mints: readonly {
    readonly policy: Script;
    readonly assets: ReadonlyMap<AssetName, bigint>;
    readonly redeemer: Option.Option<PlutusData>;
  }[];
  /** Outputs in transaction order; the change output follows them. */
  readonly outputs: readonly TransactionOutput[];
  /** Zero withdrawals, each with its script, which is provided in the witness set. */
  readonly withdrawals: readonly {
    readonly rewardAccount: RewardAccount;
    readonly script: Script;
    readonly redeemer: PlutusData;
  }[];
  /** Scripts whose stake credential the transaction registers (Conway reg cert, script witness, redeemer 0). */
  readonly registrations: readonly Script[];
  readonly collateral: readonly TransactionUnspentOutput[];
  /** The CIP-20 transaction type; None for no metadata. */
  readonly metadata: Option.Option<string>;
  readonly feePadding: bigint;
  /** The vkey witnesses the transaction carries at submit, counted in its size. */
  readonly expectedWitnesses: number;
}

/** Redeemer index references ("spend[0]", "withdraw[1]") to the class names of the contracts behind them. */
export type ValidatorLabels = Record<string, string>;

/** The labels of a transaction's redeemer references, its inputs resolved through `knownUtxos`; the indices follow Blaze's sorting. */
export const validatorLabels = (
  tx: Transaction,
  knownUtxos: readonly TransactionUnspentOutput[],
  contracts: readonly NamedContract[],
): ValidatorLabels => {
  const labels: ValidatorLabels = {};
  const nameOf = new Map(contracts.map((c) => [c.hash, c.className]));
  const body = tx.body();
  const utxos = new Map(
    knownUtxos.map((utxo) => [
      `${utxo.input().transactionId()}#${utxo.input().index()}`,
      utxo,
    ]),
  );
  // Blaze sorts inputs by transaction id then index, as text.
  const inputs = [...body.inputs().values()].sort((a, b) =>
    (a.transactionId() + a.index().toString()).localeCompare(
      b.transactionId() + b.index().toString(),
    ),
  );
  inputs.forEach((input, i) => {
    const payment = utxos
      .get(`${input.transactionId()}#${input.index()}`)
      ?.output()
      .address()
      .getProps().paymentPart;
    const name =
      payment?.type === CredentialType.ScriptHash
        ? nameOf.get(payment.hash)
        : undefined;
    if (name) labels[`spend[${i}]`] = name;
  });
  const policies = [
    ...new Set(
      [...(body.mint()?.keys() ?? [])].map((id) => AssetId.getPolicyId(id)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  policies.forEach((policy, i) => {
    const name = nameOf.get(policy);
    if (name) labels[`mint[${i}]`] = name;
  });
  const withdrawals = [...(body.withdrawals()?.keys() ?? [])]
    .map((account) => RewardAccount.toHash(account))
    .sort((a, b) => a.localeCompare(b));
  withdrawals.forEach((hash, i) => {
    const name = nameOf.get(hash);
    if (name) labels[`withdraw[${i}]`] = name;
  });
  return labels;
};

/** Name the validator after each redeemer reference, "spend[0]" as "spend[0] (ValidatorClassName)"; a "reward" reference is a withdrawal. */
export const labelValidators = (
  message: string,
  labels: ValidatorLabels,
): string =>
  message.replace(
    /(spend|mint|withdraw|reward)\[(\d+)\]/gi,
    (match, tag: string, index: string) => {
      const purpose = tag.toLowerCase();
      const name =
        labels[`${purpose === "reward" ? "withdraw" : purpose}[${index}]`];
      return name ? `${match} (${name})` : match;
    },
  );

/** The UPLC trace lines of an evaluation failure's message. */
const tracesIn = (message: string): string[] =>
  message
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith("Trace") ||
        line.includes("Validator returned false") ||
        line.includes("crashed / exited prematurely") ||
        line.includes("failed script execution") ||
        line.includes("EvaluationFailure") ||
        line.includes("ScriptFailure"),
    );

/** CIP-20 metadata naming the transaction type. */
export const createTxMetadata = (txType: string): Metadata => {
  const messages = new MetadatumList();
  messages.add(Metadatum.newText(`midnight-reserve:${txType}`));
  const message = new MetadatumMap();
  message.insert(Metadatum.newText("msg"), Metadatum.newList(messages));
  return new Metadata(new Map([[674n, Metadatum.newMap(message)]]));
};

/** The script reward account of a script hash on the network. */
export const createRewardAccount = (
  scriptHash: string,
  networkId: NetworkId,
): RewardAccount =>
  RewardAccount.fromCredential(
    { type: CredentialType.ScriptHash, hash: Hash28ByteBase16(scriptHash) },
    networkId,
  );

/** LogicRedeemer::Normal(inner) for a v2 logic (logic_round >= 1); the bare inner redeemer for v1. */
export const logicRedeemer = (
  inner: PlutusData,
  logicRound: number,
): PlutusData =>
  logicRound >= 1
    ? PlutusData.fromCore({
        constructor: 0n,
        fields: { items: [inner.toCore()] },
      })
    : inner;

/** The zero withdrawals through the logic and, when set, the mitigation logic, both with `redeemer`, as plan withdrawals. */
export const withdrawThroughLogic = (
  logic: Script,
  mitigationLogic: Option.Option<Script>,
  redeemer: PlutusData,
  networkId: NetworkId,
): TxPlan["withdrawals"] =>
  [logic, ...Option.toArray(mitigationLogic)].map((script) => ({
    rewardAccount: createRewardAccount(script.hash(), networkId),
    script,
    redeemer,
  }));

/** The minimum ADA of an output, for plans that set an output's coin themselves. */
export const minAda = (output: TransactionOutput, coinsPerUtxoByte: number) =>
  calculateMinAda(output, coinsPerUtxoByte);

/** The fee a collateral is sized against: no transaction of the CLI's costs more. */
export const ESTIMATED_MAX_FEE = 5_000_000n;

/** The collateral a transaction with the estimated maximum fee needs at the protocol's collateral percentage. */
export const requiredCollateral = (collateralPercentage: number): bigint =>
  calculateRequiredCollateral(ESTIMATED_MAX_FEE, collateralPercentage);

/** One vkey witness in the witness set: [vkey (32 bytes), signature (64 bytes)] with its CBOR headers. */
const VKEY_WITNESS_BYTES = 101;
/** The witness set's vkey entry when the transaction has none yet: key 0, the set tag and the array header. */
const VKEY_ENTRY_BYTES = 6;

/** The size of `tx` at submit, once it carries `witnesses` vkey witnesses more than it has now. */
export const sizeAtSubmit = (tx: Transaction, witnesses: number): number =>
  tx.toCbor().length / 2 +
  witnesses * VKEY_WITNESS_BYTES +
  (witnesses > 0 && tx.witnessSet().vkeys() === undefined
    ? VKEY_ENTRY_BYTES
    : 0);

/** A copy of a UTxO through its CBOR, so Blaze changes the copy and not the plan's or the context's object. */
const copyUtxo = (utxo: TransactionUnspentOutput) =>
  TransactionUnspentOutput.fromCbor(utxo.toCbor());
const copyScript = (script: Script) => Script.fromCbor(script.toCbor());
const copyData = (data: PlutusData) => PlutusData.fromCbor(data.toCbor());

/**
 * Compile a plan in its context into an unsigned transaction. The plan's
 * parts go onto a fresh TxBuilder in the order the hand-written builders
 * used (spends, references, scripts, mints, outputs, withdrawals,
 * registrations, collateral); coin selection draws on the wallet's UTxOs
 * that carry no reference script and are not reserved; scripts run on the
 * local Blaze VM. A failure is a TxBuildError whose traces name the
 * validators, and so is a transaction over the protocol's maximum size
 * once it carries its vkey witnesses.
 */
export const compile = (
  plan: TxPlan,
  ctx: PlanningContext,
): Effect.Effect<Transaction, TxBuildError> =>
  Effect.gen(function* () {
    const parameters = structuredClone(ctx.parameters);
    // Blaze's add* calls throw at once on a plan it cannot take (a duplicate input or reference input, a duplicate mint policy, an output over the value size).
    const builder = yield* Effect.try({
      try: () => {
        const builder = new TxBuilder(parameters)
          .setNetworkId(ctx.networkId)
          .setChangeAddress(Address.fromBytes(ctx.wallet.address.toBytes()))
          .addUnspentOutputs(
            ctx.wallet.utxos
              .filter(
                (utxo) =>
                  utxo.output().scriptRef() === undefined &&
                  !ctx.reserved.has(
                    `${utxo.input().transactionId()}#${utxo.input().index()}`,
                  ),
              )
              .map(copyUtxo),
          )
          .useEvaluator(makeUplcEvaluator(parameters, 1.2, 1.2, ctx.slotConfig))
          .setFeePadding(plan.feePadding);
        for (const { utxo, redeemer } of plan.spends)
          builder.addInput(
            copyUtxo(utxo),
            Option.getOrUndefined(Option.map(redeemer, copyData)),
          );
        for (const utxo of plan.references)
          builder.addReferenceInput(copyUtxo(utxo));
        for (const script of plan.scripts)
          builder.provideScript(copyScript(script));
        for (const { policy, assets, redeemer } of plan.mints)
          builder
            .addMint(
              PolicyId(policy.hash()),
              new Map(assets),
              Option.getOrUndefined(Option.map(redeemer, copyData)),
            )
            .provideScript(copyScript(policy));
        for (const output of plan.outputs)
          builder.addOutput(TransactionOutput.fromCbor(output.toCbor()));
        for (const { rewardAccount, script, redeemer } of plan.withdrawals)
          builder
            .addWithdrawal(rewardAccount, 0n, copyData(redeemer))
            .provideScript(copyScript(script));
        for (const script of plan.registrations)
          builder.provideScript(copyScript(script)).addRegisterStake(
            Credential.fromCore({
              hash: script.hash(),
              type: CredentialType.ScriptHash,
            }),
            PlutusData.newInteger(0n),
          );
        if (plan.collateral.length > 0)
          builder.provideCollateral(plan.collateral.map(copyUtxo));
        if (Option.isSome(plan.metadata))
          builder.setMetadata(createTxMetadata(plan.metadata.value));
        return builder;
      },
      catch: (cause) =>
        new TxBuildError({ command: ctx.command, traces: [], cause }),
    });

    // The draft before completion names the validators in a failure's traces.
    const draft = Option.liftThrowable(() =>
      Transaction.fromCbor(TxCBOR(builder.toCbor())),
    )();
    const tx = yield* Effect.tryPromise({
      try: () => builder.complete(),
      catch: (cause) => {
        const labels = Option.match(draft, {
          onNone: (): ValidatorLabels => ({}),
          onSome: (tx) =>
            validatorLabels(
              tx,
              [
                ...plan.spends.map(({ utxo }) => utxo),
                ...plan.references,
                ...plan.collateral,
              ],
              ctx.contracts,
            ),
        });
        const message = cause instanceof Error ? cause.message : String(cause);
        return new TxBuildError({
          command: ctx.command,
          traces: [
            ...tracesIn(String(cause)).map((t) => labelValidators(t, labels)),
            ...Object.entries(labels).map(([ref, name]) => `${ref} -> ${name}`),
            `Error: ${labelValidators(message, labels)}`,
            ...(cause instanceof Error && cause.cause !== undefined
              ? [
                  `Cause: ${labelValidators(
                    Option.getOrElse(
                      Option.liftThrowable(() =>
                        JSON.stringify(
                          cause.cause,
                          (_key, value) =>
                            typeof value === "bigint"
                              ? value.toString()
                              : value,
                          2,
                        ),
                      )(),
                      () => String(cause.cause),
                    ),
                    labels,
                  )}`,
                ]
              : []),
          ],
          cause,
        });
      },
    });
    const bytes = sizeAtSubmit(tx, plan.expectedWitnesses);
    if (bytes > ctx.parameters.maxTxSize) {
      return yield* new TxBuildError({
        command: ctx.command,
        traces: [],
        cause: undefined,
        size: {
          bytes,
          witnesses: plan.expectedWitnesses,
          max: ctx.parameters.maxTxSize,
        },
      });
    }
    return tx;
  });
