/**
 * The rewards batcher's transactions (docs/rewards/spec.md §5.3): a
 * LoadAndPay that opens an epoch with its digest proof and first batch, and
 * a Pay that continues it. A batch reveals one contiguous run of the
 * epoch's sorted leaves, `[cursor, …, lookahead]`, pays every leaf but the
 * lookahead into its deposit, takes the total (and, in the batch that
 * completes the fold, the epoch's Treasury share for the ICS) from the
 * pool, and moves the state's cursor, as lib/rewards/batch.ak checks.
 *
 * The contract finds each paid leaf's deposit by key among the account
 * inputs, sorted by NFT name, so the ledger's input order does not matter;
 * the redeemer names only each deposit's output, strictly increasing in
 * leaf order. Exits (ack leaves) are not built yet.
 */
import {
  addressFromValidator,
  AssetId,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import { buildMultiproof, toPlutusData } from "../bridge/authority-set";
import { createRewardAccount } from "../chain/transaction";

/** A decoded 45-byte reward leaf: ack ‖ skh ‖ amount (u128 BE). */
export interface RewardLeaf {
  readonly bytes: Uint8Array;
  readonly ack: number;
  readonly key: string;
  readonly amount: bigint;
}

/** Decode a 45-byte leaf. */
export const rewardLeaf = (bytes: Uint8Array): RewardLeaf => ({
  bytes,
  ack: bytes[0],
  key: bytesToHex(bytes.slice(1, 29)),
  amount: BigInt(`0x${bytesToHex(bytes.slice(29, 45))}`),
});

/** One batch over the epoch's leaves: the leaves it pays and the one it reveals after them, and the state it leaves. */
export interface BatchPlan {
  readonly paid: readonly number[];
  readonly lookahead: Option.Option<number>;
  readonly cursor: string;
  readonly complete: boolean;
}

/**
 * The run from leaf `from` of an epoch that started at leaf `start`: at
 * most `limit` paid leaves, stopping before `start` or after max_key (the
 * cursor wraps to min_key). max_key is never a lookahead, so a run that
 * reaches the leaf before it pays max_key too.
 */
export const planBatch = (
  leaves: readonly RewardLeaf[],
  from: number,
  start: number,
  limit: number,
): BatchPlan => {
  const last = leaves.length - 1;
  const paid = [from];
  for (;;) {
    const at = paid[paid.length - 1];
    const next = at + 1;
    if (at === last || next === start) break;
    if (next !== last && paid.length >= limit) break;
    paid.push(next);
  }
  const end = paid[paid.length - 1];
  const cursor = end === last ? leaves[0].key : leaves[end + 1].key;
  return {
    paid,
    lookahead: end === last ? Option.none() : Option.some(end + 1),
    cursor,
    complete: cursor === leaves[start].key,
  };
};

/** What every batch spends and references, resolved from the chain. */
export interface BatchChain {
  readonly batcher: Script;
  readonly account: Script;
  readonly poolForever: Script;
  readonly poolLogic: Script;
  readonly poolMitigation: Option.Option<Script>;
  readonly icsForever: Script;
  readonly scriptRefs: readonly TransactionUnspentOutput[];
  readonly poolMain: TransactionUnspentOutput;
  readonly stateUtxo: TransactionUnspentOutput;
  readonly poolUtxos: readonly TransactionUnspentOutput[];
  readonly collateral: TransactionUnspentOutput;
  readonly night: AssetId;
}

/** A batch: its redeemer body, the leaves, the plan, each paid leaf's deposit, the state out and the Treasury share it pays. */
export interface Batch {
  readonly load: Option.Option<{
    readonly digestProof: Contracts.DigestProof;
    readonly bridge: TransactionUnspentOutput;
  }>;
  readonly leaves: readonly RewardLeaf[];
  readonly plan: Option.Option<BatchPlan>;
  readonly deposits: readonly TransactionUnspentOutput[];
  readonly stateOut: Contracts.BatcherState;
  readonly treasury: bigint;
}

const UNIT = PlutusData.fromCore({ constructor: 0n, fields: { items: [] } });

const nightOf = (utxo: TransactionUnspentOutput, night: AssetId) =>
  utxo.output().amount().multiasset()?.get(night) ?? 0n;

const scriptAddress = (script: Script, networkId: NetworkId) =>
  PaymentAddress(addressFromValidator(networkId, script).toBech32());

/** The deposit after its payout: same address and datum, the same ADA (no skim), NIGHT up by the leaf's amount. */
const paidDeposit = (
  deposit: TransactionUnspentOutput,
  amount: bigint,
  night: AssetId,
) => {
  const core = deposit.output().toCore();
  const assets = new Map(core.value.assets ?? []);
  assets.set(night, (assets.get(night) ?? 0n) + amount);
  return TransactionOutput.fromCore({
    ...core,
    value: { coins: core.value.coins, assets },
  });
};

/**
 * The batch transaction and its redeemer. Outputs: 0 the state, 1 the
 * pool, then one deposit per paid leaf in leaf order, then the ICS output
 * when the batch pays a Treasury share; the change goes last. Inputs: the
 * state, the pool's value UTxOs and the paid deposits; coin selection adds
 * the fee.
 */
export const buildBatchTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  chain: BatchChain,
  batch: Batch,
  networkId: NetworkId,
): TxBuilder => {
  const paid = Option.match(batch.plan, {
    onNone: () => [] as number[],
    onSome: (p) => [...p.paid],
  });
  const total = paid.reduce((sum, i) => sum + batch.leaves[i].amount, 0n);
  const proof: PlutusData[] = Option.match(batch.plan, {
    onNone: () => [],
    onSome: (p) => {
      const root = toPlutusData(
        buildMultiproof(
          batch.leaves.map((l) => l.bytes),
          new Set([...p.paid, ...Option.toArray(p.lookahead)]),
        ),
      ).asList()!;
      return Array.from({ length: root.getLength() }, (_, i) => root.get(i));
    },
  });
  const redeemer = serialize(
    Contracts.BatcherRedeemer,
    Option.match(batch.load, {
      onNone: (): Contracts.BatcherRedeemer => ({ Pay: { proof } }),
      onSome: ({ digestProof }): Contracts.BatcherRedeemer => ({
        LoadAndPay: { digest_proof: digestProof, proof },
      }),
    }),
  );
  const unread = PlutusData.newInteger(0n);
  const batcherGate = serialize(Contracts.AccountGate, "Batcher");
  const poolIn = chain.poolUtxos;
  const poolLovelace = poolIn.reduce(
    (s, u) => s + u.output().amount().coin(),
    0n,
  );
  const poolNight = poolIn.reduce((s, u) => s + nightOf(u, chain.night), 0n);

  let tx = chain.scriptRefs.reduce(
    (t, ref) => t.addReferenceInput(ref),
    blaze.newTransaction().addReferenceInput(chain.poolMain),
  );
  tx = Option.match(batch.load, {
    onNone: () => tx,
    onSome: ({ bridge }) => tx.addReferenceInput(bridge),
  });
  tx = tx.addInput(chain.stateUtxo, unread).addOutput(
    TransactionOutput.fromCore({
      ...chain.stateUtxo.output().toCore(),
      datum: serialize(Contracts.BatcherState, batch.stateOut).toCore(),
    }),
  );
  if (poolIn.length > 0) {
    tx = poolIn
      .reduce((t, u) => t.addInput(u, unread), tx)
      .addOutput(
        TransactionOutput.fromCore({
          address: scriptAddress(chain.poolForever, networkId),
          value: {
            coins: poolLovelace,
            assets: new Map([
              [chain.night, poolNight - total - batch.treasury],
            ]),
          },
          datum: UNIT.toCore(),
        }),
      );
  }
  tx = batch.deposits.reduce(
    (t, deposit, j) =>
      t
        .addInput(deposit, batcherGate)
        .addOutput(
          paidDeposit(deposit, batch.leaves[paid[j]].amount, chain.night),
        ),
    tx,
  );
  if (batch.treasury > 0n) {
    tx = tx.addOutput(
      TransactionOutput.fromCore({
        address: scriptAddress(chain.icsForever, networkId),
        value: {
          coins: 2_000_000n,
          assets: new Map([[chain.night, batch.treasury]]),
        },
        datum: UNIT.toCore(),
      }),
    );
  }
  tx = tx.addWithdrawal(
    createRewardAccount(chain.batcher.hash(), networkId),
    0n,
    redeemer,
  );
  if (poolIn.length > 0) {
    const disburse = serialize(Contracts.PoolRedeemer, "Disburse");
    tx = [chain.poolLogic, ...Option.toArray(chain.poolMitigation)].reduce(
      (t, script) =>
        t.addWithdrawal(
          createRewardAccount(script.hash(), networkId),
          0n,
          disburse,
        ),
      tx,
    );
  }
  return tx.provideCollateral([chain.collateral]);
};
