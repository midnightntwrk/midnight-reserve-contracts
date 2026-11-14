import {
  type Address,
  addressFromValidator,
  AssetName,
  CredentialType,
  NetworkId,
  PlutusData,
  RewardAccount,
  Script,
  SLOT_CONFIG_NETWORK,
  type Transaction,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  Value,
} from "@blaze-cardano/core";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import { TxBuilder } from "@blaze-cardano/tx";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { Provider } from "../cli/chain";
import { renderError, TxBuildError } from "../cli/errors";
import {
  compile,
  labelValidators,
  type PlanningContext,
  type TxPlan,
  type ValidatorLabels,
} from "../cli/tx";
import {
  AlwaysFailsAlwaysFailsSpend,
  TestCnightNoAuditTcnightMintInfiniteElse,
} from "../contract_blueprint_default";

/** An emulator with a funded wallet, and the context of a plan over it. */
const setup = Effect.promise(async () => {
  const emulator = new Emulator([]);
  const alice = await emulator.register("alice", new Value(100_000_000n));
  const bob = await emulator.register("bob");
  const provider = new EmulatorProvider(emulator);
  const ctx: PlanningContext = {
    command: "test",
    networkId: NetworkId.Testnet,
    slotConfig: SLOT_CONFIG_NETWORK.Preview,
    parameters: await provider.getParameters(),
    wallet: {
      address: alice,
      utxos: await provider.getUnspentOutputs(alice),
    },
    reserved: new Set(),
    contracts: [],
    resolved: undefined,
  };
  return { emulator, alice, bob, ctx };
});

const EMPTY: TxPlan = {
  spends: [],
  references: [],
  scripts: [],
  mints: [],
  outputs: [],
  withdrawals: [],
  registrations: [],
  collateral: [],
  metadata: Option.none(),
  feePadding: 0n,
  expectedWitnesses: 1,
};

/** An output paying `lovelace` to `address`, read back from its CBOR as a decoded file would be. */
const payment = (address: Address, lovelace: bigint) =>
  TransactionOutput.fromCbor(
    new TransactionOutput(address, new Value(lovelace)).toCbor(),
  );

/** Sign `tx` as alice, submit it to the emulator and confirm it. */
const accepted = (emulator: Emulator, tx: Transaction) =>
  Effect.promise(async () => {
    const signed = await emulator.as("alice", (blaze) =>
      blaze.signTransaction(tx),
    );
    const txId = await emulator.submitTransaction(signed);
    return emulator.awaitTransactionConfirmation(txId);
  });

const tcnight = new TestCnightNoAuditTcnightMintInfiniteElse().Script;
const alwaysFails = new AlwaysFailsAlwaysFailsSpend().Script;

describe("compile on the emulator", () => {
  it.live(
    "a payment compiles from the context alone and the ledger accepts it",
    () =>
      Effect.gen(function* () {
        const { emulator, bob, ctx } = yield* setup;
        const tx = yield* compile(
          { ...EMPTY, outputs: [payment(bob, 5_000_000n)] },
          ctx,
        );
        expect(yield* accepted(emulator, tx)).toBe(true);
      }),
  );

  it.live(
    "a script mint is evaluated on the local VM and the ledger accepts it",
    () =>
      Effect.gen(function* () {
        const { emulator, ctx } = yield* setup;
        const tx = yield* compile(
          {
            ...EMPTY,
            mints: [
              {
                policy: tcnight,
                assets: new Map([[AssetName("4e49474854"), 1_000n]]),
                redeemer: Option.some(PlutusData.newInteger(0n)),
              },
            ],
            metadata: Option.some("test-mint"),
          },
          ctx,
        );
        expect(tx.witnessSet().redeemers()?.size()).toBe(1);
        expect(yield* accepted(emulator, tx)).toBe(true);
      }),
  );

  it.live(
    "compile runs under a Provider layer that fails every call, and calls none",
    () =>
      Effect.gen(function* () {
        const { bob, ctx } = yield* setup;
        let calls = 0;
        const refuse = <A>() =>
          Effect.suspend((): Effect.Effect<A> => {
            calls += 1;
            return Effect.die("the chain was read");
          });
        const tx = yield* compile(
          { ...EMPTY, outputs: [payment(bob, 5_000_000n)] },
          ctx,
        ).pipe(
          Effect.provide(
            Layer.succeed(Provider)({
              parameters: refuse(),
              unspentOutputs: () => refuse(),
              rewardAccountRegistered: () => refuse(),
              submit: () => refuse(),
              isConfirmed: () => refuse(),
            }),
          ),
        );
        expect(tx.body().outputs()).toHaveLength(2);
        expect(calls).toBe(0);
      }),
  );

  it.live(
    "a failing script is a TxBuildError whose traces name the validator",
    () =>
      Effect.gen(function* () {
        const { ctx } = yield* setup;
        const locked = new TransactionUnspentOutput(
          new TransactionInput(TransactionId("ab".repeat(32)), 0n),
          new TransactionOutput(
            addressFromValidator(NetworkId.Testnet, alwaysFails),
            new Value(10_000_000n),
          ),
        );
        const error = yield* Effect.flip(
          compile(
            {
              ...EMPTY,
              spends: [
                {
                  utxo: locked,
                  redeemer: Option.some(PlutusData.newInteger(0n)),
                },
              ],
              scripts: [alwaysFails],
            },
            {
              ...ctx,
              contracts: [
                {
                  className: "AlwaysFailsAlwaysFailsSpend",
                  hash: alwaysFails.hash(),
                },
              ],
            },
          ),
        );
        expect(error._tag).toBe("TxBuildError");
        expect(error.traces).toContain(
          "spend[0] -> AlwaysFailsAlwaysFailsSpend",
        );
      }),
  );

  it.live(
    "a plan Blaze refuses while it is being added, a duplicate reference input, is a TxBuildError",
    () =>
      Effect.gen(function* () {
        const { bob, ctx } = yield* setup;
        const [reference] = ctx.wallet.utxos;
        const error = yield* Effect.flip(
          compile(
            {
              ...EMPTY,
              references: [reference, reference],
              outputs: [payment(bob, 5_000_000n)],
            },
            ctx,
          ),
        );
        expect(error).toBeInstanceOf(TxBuildError);
        expect(renderError(error)).toBe(
          "test: transaction build failed: Cannot add duplicate reference input to the transaction",
        );
      }),
  );

  it.live(
    "a transaction over the maximum size once it carries its vkey witnesses is a TxBuildError",
    () =>
      Effect.gen(function* () {
        const { bob, ctx } = yield* setup;
        const plan = {
          ...EMPTY,
          outputs: [payment(bob, 5_000_000n)],
          expectedWitnesses: 5,
        };
        // Room for the transaction and Blaze's own witness estimate, not for five signatures.
        const max = (yield* compile(plan, ctx)).toCbor().length / 2 + 200;
        const error = yield* Effect.flip(
          compile(plan, {
            ...ctx,
            parameters: { ...ctx.parameters, maxTxSize: max },
          }),
        );
        expect(error.size).toMatchObject({ witnesses: 5, max });
        expect(error.size?.bytes).toBeGreaterThan(max);
      }),
  );

  it.live(
    "coin selection never spends a reserved UTxO or one carrying a reference script",
    () =>
      Effect.gen(function* () {
        const { emulator, alice, bob, ctx } = yield* setup;
        const extra = (index: bigint, scriptRef: boolean) => {
          const output = new TransactionOutput(alice, new Value(500_000_000n));
          if (scriptRef) output.setScriptRef(tcnight);
          const utxo = new TransactionUnspentOutput(
            new TransactionInput(TransactionId("cd".repeat(32)), index),
            output,
          );
          emulator.addUtxo(utxo);
          return utxo;
        };
        const reserved = extra(0n, false);
        const withScript = extra(1n, true);
        const reservedRef = `${reserved.input().transactionId()}#0`;
        // More than the 100 ADA of the wallet's own UTxO.
        const plan = { ...EMPTY, outputs: [payment(bob, 300_000_000n)] };
        const wallet = {
          address: alice,
          utxos: [...ctx.wallet.utxos, reserved, withScript],
        };
        const error = yield* Effect.flip(
          compile(plan, { ...ctx, wallet, reserved: new Set([reservedRef]) }),
        );
        expect(error._tag).toBe("TxBuildError");
        const tx = yield* compile(plan, { ...ctx, wallet });
        const spent = tx
          .body()
          .inputs()
          .values()
          .map((input) => `${input.transactionId()}#${input.index()}`);
        expect(spent).toContain(reservedRef);
        expect(spent).not.toContain(`${withScript.input().transactionId()}#1`);
      }),
  );
});

describe("compile leaves its plan and context as they were", () => {
  /** What can be observed of a plan and a context: deep copies of each SDK object's toCore() and its CBOR. */
  const observe = (plan: TxPlan, ctx: PlanningContext) => {
    const utxo = (u: TransactionUnspentOutput) => ({
      core: u.toCore(),
      cbor: u.toCbor(),
    });
    const script = (x: Script) => ({ core: x.toCore(), cbor: x.toCbor() });
    const data = (d: PlutusData) => ({ core: d.toCore(), cbor: d.toCbor() });
    const redeemer = (r: Option.Option<PlutusData>) =>
      Option.getOrUndefined(Option.map(r, data));
    return structuredClone({
      spends: plan.spends.map((spend) => ({
        utxo: utxo(spend.utxo),
        redeemer: redeemer(spend.redeemer),
      })),
      references: plan.references.map(utxo),
      scripts: plan.scripts.map(script),
      mints: plan.mints.map((mint) => ({
        policy: script(mint.policy),
        assets: [...mint.assets],
        redeemer: redeemer(mint.redeemer),
      })),
      outputs: plan.outputs.map((o) => ({
        core: o.toCore(),
        cbor: o.toCbor(),
      })),
      withdrawals: plan.withdrawals.map((w) => ({
        rewardAccount: w.rewardAccount,
        script: script(w.script),
        redeemer: data(w.redeemer),
      })),
      registrations: plan.registrations.map(script),
      collateral: plan.collateral.map(utxo),
      metadata: plan.metadata,
      feePadding: plan.feePadding,
      expectedWitnesses: plan.expectedWitnesses,
      wallet: {
        address: ctx.wallet.address.toBech32(),
        utxos: ctx.wallet.utxos.map(utxo),
      },
      reserved: [...ctx.reserved],
      parameters: ctx.parameters,
      slotConfig: ctx.slotConfig,
      contracts: ctx.contracts,
    });
  };

  it.live(
    "Blaze sets min-ADA on an output it is given; toCore shows it, the output's CBOR does not",
    () =>
      Effect.gen(function* () {
        const { bob, ctx } = yield* setup;
        const output = payment(bob, 1n);
        const cbor = output.toCbor();
        new TxBuilder(ctx.parameters)
          .setNetworkId(NetworkId.Testnet)
          .addOutput(output);
        expect(output.amount().coin()).toBeGreaterThan(1n);
        expect(output.toCbor()).toBe(cbor);
      }),
  );

  it.live(
    "the plan and context are unchanged after compile, and compiling them again gives the same transaction",
    () =>
      Effect.gen(function* () {
        const { alice, bob, ctx } = yield* setup;
        // tcnight_mint_infinite's else handler passes for any purpose, so it can spend, mint, withdraw and register.
        const scriptAddress = addressFromValidator(NetworkId.Testnet, tcnight);
        const locked = TransactionUnspentOutput.fromCbor(
          new TransactionUnspentOutput(
            new TransactionInput(TransactionId("ef".repeat(32)), 0n),
            new TransactionOutput(scriptAddress, new Value(10_000_000n)),
          ).toCbor(),
        );
        const referenceOutput = new TransactionOutput(
          alice,
          new Value(20_000_000n),
        );
        referenceOutput.setScriptRef(alwaysFails);
        const reference = TransactionUnspentOutput.fromCbor(
          new TransactionUnspentOutput(
            new TransactionInput(TransactionId("ef".repeat(32)), 1n),
            referenceOutput,
          ).toCbor(),
        );
        const plan: TxPlan = {
          spends: [
            { utxo: locked, redeemer: Option.some(PlutusData.newInteger(2n)) },
          ],
          references: [reference],
          scripts: [tcnight],
          mints: [
            {
              policy: tcnight,
              assets: new Map([[AssetName("4e49474854"), 5n]]),
              redeemer: Option.some(PlutusData.newInteger(1n)),
            },
          ],
          // Below min-ADA, read from CBOR: Blaze raises it on the object it gets.
          outputs: [payment(bob, 1n), payment(bob, 7_000_000n)],
          withdrawals: [
            {
              rewardAccount: RewardAccount.fromCredential(
                { type: CredentialType.ScriptHash, hash: tcnight.hash() },
                NetworkId.Testnet,
              ),
              script: tcnight,
              redeemer: PlutusData.newInteger(3n),
            },
          ],
          registrations: [tcnight],
          collateral: [ctx.wallet.utxos[0]],
          metadata: Option.some("replay"),
          feePadding: 1_000n,
          expectedWitnesses: 1,
        };
        const before = observe(plan, ctx);
        const first = yield* compile(plan, ctx);
        expect(observe(plan, ctx)).toEqual(before);
        const second = yield* compile(plan, ctx);
        expect(second.toCbor()).toBe(first.toCbor());
        expect(observe(plan, ctx)).toEqual(before);
        expect(first.body().outputs()[0].amount().coin()).toBeGreaterThan(1n);
        // Every branch of the plan reached the transaction.
        const body = first.body();
        expect(
          body
            .inputs()
            .values()
            .map((i) => i.transactionId()),
        ).toContain(TransactionId("ef".repeat(32)));
        expect(body.referenceInputs()?.size()).toBe(1);
        expect(body.withdrawals()?.size).toBe(1);
        expect(body.certs()?.size()).toBe(1);
        expect(body.collateral()?.size()).toBe(1);
        expect(body.mint()?.size).toBe(1);
      }),
  );
});

describe("labelValidators", () => {
  const labels: ValidatorLabels = {
    "spend[0]": "CouncilForeverElse",
    "withdraw[0]": "CouncilLogicV2Else",
    "mint[1]": "CouncilWitnessPolicy",
  };

  it.each([
    [
      "names every known index in one message",
      "Failed: spend[0] and mint[1] both failed",
      "Failed: spend[0] (CouncilForeverElse) and mint[1] (CouncilWitnessPolicy) both failed",
    ],
    [
      "leaves an unknown index unchanged",
      "Script failure at spend[5]",
      "Script failure at spend[5]",
    ],
    [
      "matches the purpose in any case, and a reward reference is a withdrawal",
      "Failed at Spend[0] and Reward[0]",
      "Failed at Spend[0] (CouncilForeverElse) and Reward[0] (CouncilLogicV2Else)",
    ],
  ])("%s", (_name, message, expected) => {
    expect(labelValidators(message, labels)).toBe(expected);
  });
});
