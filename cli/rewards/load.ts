/**
 * rewards-batch: the batcher's next transaction, from the chain and a
 * Midnight node, as the pump lands it. With the state complete it is the
 * Load of the next epoch: the digest's block from the rewards pallet's
 * DigestBlock at the BEEFY-finalized head, its DigestProof under the
 * bridge's latest_height (once that covers the block's leaf), checked
 * against the epoch's leaves in EpochLeaves; it pays the epoch's Treasury
 * share to the ICS. Otherwise it is the next Pay of the loaded epoch.
 * Built unsigned; coin selection adds the fee.
 */
import {
  addressFromValidator,
  AssetId,
  type Script,
  type Transaction,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Effect, Either, Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import { bridgeStateAt, findReferenceScripts } from "../bridge/bridge-chain";
import { keccak, merge } from "../bridge/keccak";
import { beefyFinalizedHash, storageAt } from "../bridge/midnight";
import { buildTx } from "../chain/complete-tx";
import { upgradeScripts, upgradeStateAt } from "../chain/governance-provider";
import { Provider } from "../chain/provider";
import { DEPLOYER_ONLY } from "../chain/transaction";
import { writeTransaction } from "../chain/tx-file";
import { type Environment, environmentOf } from "../config/network-mapping";
import { Settings } from "../config/settings";
import { Blueprint } from "../contracts/contracts";
import { resolveCollateral } from "../deploy/deployment";
import { PreconditionFailed, UtxoNotFound } from "../errors";
import { type TxFileInput, txFilePath } from "../input";
import { Output } from "../output";
import {
  type Batch,
  type BatchPlan,
  buildBatchTx,
  afterPay,
  cursorIndex,
  planBatch,
  plainNight,
  type RewardLeaf,
  rewardLeaf,
} from "./batch";
import { decodeDigest, digestProofAt } from "./digest-proof";
import { decodeDigestBlock, decodeEpochLeaves, epochKey } from "./storage";

/** The least lovelace the fee input carries. */

/** `binary_merkle_tree::merkle_root` over keccak leaves; 32 zero bytes for none. */
export const rewardRoot = (leaves: readonly RewardLeaf[]): string => {
  if (leaves.length === 0) return "00".repeat(32);
  let layer = leaves.map((l) => keccak(l.bytes));
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < layer.length; i += 2)
      next.push(merge(layer[i], layer[i + 1]));
    if (layer.length % 2 === 1) next.push(layer[layer.length - 1]);
    layer = next;
  }
  return bytesToHex(layer[0]);
};

const nothing = (reason: string) =>
  new PreconditionFailed({
    command: "rewards-batch",
    refusal: { _tag: "NothingToBatch", reason },
  });

const notMip = (detail: string) =>
  new PreconditionFailed({
    command: "Midnight node",
    refusal: { _tag: "MidnightNotMip", detail },
  });

const holds = (utxo: TransactionUnspentOutput, unit: string) =>
  (utxo.output().amount().multiasset()?.get(AssetId(unit)) ?? 0n) > 0n;

/** The batcher's next transaction on `network` from the node at `rpc`, paying at most `limit` leaves; NothingToBatch when there is none yet. */
export const batchTx = (network: Environment, rpc: string, limit: number) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const { networkId } = environmentOf(network);
    const settings = yield* Settings;
    const config = yield* settings.profile;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const batcher = (yield* blueprint.optional("rewardsBatcher")).Script;
    const account = (yield* blueprint.optional("virtualAccount")).Script;
    const pool = yield* blueprint.twoStage("rewards-pool");
    const bridge = yield* blueprint.twoStage("committee-bridge");
    const ics = (yield* blueprint.instances).icsForever.Script;
    const at = (script: Script) =>
      provider.unspentOutputs(addressFromValidator(networkId, script));

    const stateUtxo = yield* Effect.flatMap(at(batcher), (utxos) =>
      Either.fromOption(
        Option.fromNullable(utxos.find((u) => holds(u, batcher.hash()))),
        () =>
          UtxoNotFound.carrying(
            addressFromValidator(networkId, batcher).toBech32(),
            batcher.hash(),
          ),
      ),
    );
    const state = parse(
      Contracts.BatcherState,
      stateUtxo.output().datum()!.asInlineData()!,
    );
    const loading = state.complete;
    const epoch = loading ? state.epoch + 1n : state.epoch;
    const head = yield* beefyFinalizedHash(rpc);
    const leavesBytes = yield* storageAt(
      rpc,
      epochKey("EpochLeaves", epoch),
      head,
    );
    if (Option.isNone(leavesBytes))
      return yield* nothing(
        `epoch ${epoch} has no leaves at the BEEFY-finalized head yet`,
      );
    const leaves = decodeEpochLeaves(leavesBytes.value).map(rewardLeaf);
    if (leaves.some((l) => l.ack !== 0))
      return yield* notMip(
        `epoch ${epoch} holds an ack leaf; exits are not built`,
      );

    const found = (script: Script, unit: string) =>
      Effect.flatMap(at(script), (utxos) =>
        Either.fromOption(
          Option.fromNullable(utxos.find((u) => holds(u, unit))),
          () =>
            UtxoNotFound.carrying(
              addressFromValidator(networkId, script).toBech32(),
              unit,
            ),
        ),
      );
    const lightClient = yield* found(
      bridge.forever.Script,
      bridge.forever.Script.hash(),
    );
    const load = loading
      ? yield* Effect.gen(function* () {
          const block = yield* storageAt(
            rpc,
            epochKey("DigestBlock", epoch),
            head,
          );
          if (Option.isNone(block))
            return yield* nothing(`epoch ${epoch} has no digest block yet`);
          const digestBlock = decodeDigestBlock(block.value);
          const height = Number(
            (yield* bridgeStateAt(lightClient)).latest_height,
          );
          if (height < digestBlock + 1)
            return yield* nothing(
              `the bridge is at height ${height}; the digest of epoch ${epoch} in block ${digestBlock} needs ${digestBlock + 1}`,
            );
          const proof = yield* digestProofAt(
            rpc,
            digestBlock,
            height,
            config.rewards_pallet_index,
            config.rewards_call_index,
          );
          const digest = decodeDigest(hexToBytes(proof.extrinsic));
          if (
            digest.epoch !== epoch ||
            digest.leafCount !== BigInt(leaves.length) ||
            digest.root !== rewardRoot(leaves)
          )
            return yield* notMip(
              `the digest in block ${digestBlock} does not match the ${leaves.length} leaves EpochLeaves holds for epoch ${epoch}`,
            );
          return { proof, digest };
        })
      : undefined;

    const deposits = loading
      ? new Map<string, TransactionUnspentOutput>()
      : new Map(
          (yield* at(account)).flatMap((u) =>
            leaves
              .filter((l) => holds(u, `${account.hash()}00${l.key}`))
              .map((l) => [l.key, u] as const),
          ),
        );
    const missing = loading
      ? undefined
      : leaves.find((l) => !deposits.has(l.key));
    if (missing !== undefined)
      return yield* notMip(
        `epoch ${epoch} pays ${missing.key}, which has no deposit in the list`,
      );
    if (!loading && rewardRoot(leaves) !== state.root)
      return yield* notMip(
        `the ${leaves.length} leaves EpochLeaves holds for epoch ${epoch} do not have the loaded root`,
      );
    const plan: Option.Option<BatchPlan> = loading
      ? Option.none()
      : Option.some(
          planBatch(leaves, cursorIndex(leaves, state.cursor), limit),
        );
    const stateOut: Contracts.BatcherState =
      load === undefined
        ? Option.match(plan, {
            onNone: () => state,
            onSome: (p) => afterPay(state, leaves, p),
          })
        : {
            ...state,
            epoch,
            root: load.digest.root,
            min_key: load.digest.minKey,
            max_key: load.digest.maxKey,
            cursor: "",
            complete: load.digest.leafCount === 0n,
          };
    const treasury = load === undefined ? 0n : load.digest.treasuryTotal;
    const batch: Batch = {
      load: Option.map(Option.fromNullable(load), ({ proof }) => ({
        digestProof: proof,
        bridge: lightClient,
      })),
      leaves,
      plan,
      deposits: Option.match(plan, {
        onNone: () => [],
        onSome: (p) => p.paid.map((i) => deposits.get(leaves[i].key)!),
      }),
      stateOut,
      treasury,
    };

    const poolMain = yield* found(
      pool.twoStage.Script,
      `${pool.twoStage.Script.hash()}6d61696e`,
    );
    const poolScripts = yield* upgradeScripts(
      yield* upgradeStateAt(poolMain),
      pool.logic.Script.hash(),
    );
    const night = AssetId(
      config.cnight_policy + Buffer.from(config.cnight_name).toString("hex"),
    );
    const poolUtxos =
      loading && treasury === 0n
        ? []
        : (yield* at(pool.forever.Script)).filter((u) => plainNight(u, night));
    const refHashes = [
      batcher,
      account,
      pool.forever.Script,
      pool.logic.Script,
    ].map((s) => s.hash());
    const { address: deployer, found: refs } =
      yield* findReferenceScripts(refHashes);
    const scriptRefs = yield* Effect.forEach(refs, (utxo, i) =>
      Either.fromOption(utxo, () =>
        UtxoNotFound.carrying(deployer, refHashes[i]),
      ),
    );
    const { collateralPercentage } = yield* provider.use("getParameters", (p) =>
      p.getParameters(),
    );
    const collateral = yield* resolveCollateral(
      "rewards-batch",
      config,
      collateralPercentage,
    );
    const chain = {
      batcher,
      account,
      poolForever: pool.forever.Script,
      poolLogic: poolScripts.logic,
      poolMitigation: poolScripts.mitigationLogic,
      icsForever: ics,
      scriptRefs,
      poolMain,
      stateUtxo,
      poolUtxos,
      collateral,
      night,
    };

    const name = Option.match(plan, {
      onNone: () =>
        `load of epoch ${epoch}: ${leaves.length} leaves, Treasury share ${treasury}`,
      onSome: (p) =>
        `pay of epoch ${epoch}: leaves ${p.paid.join(", ")}${p.paid[p.paid.length - 1] === leaves.length - 1 ? ", completing the fold" : ""}`,
    });
    yield* out.log(`\nRewards batch on ${network}: ${name}`);
    const blaze = yield* provider.blaze;
    const builder = buildBatchTx(blaze, chain, batch, networkId);
    const tx: Transaction = yield* buildTx(builder, {
      commandName: "rewards-batch",
      witnesses: DEPLOYER_ONLY,
      knownUtxos: [
        stateUtxo,
        poolMain,
        lightClient,
        collateral,
        ...poolUtxos,
        ...batch.deposits,
        ...scriptRefs,
      ],
    });
    return { tx, name };
  });

/** Whether a failure is only that there is no batch yet. */
export const nothingToBatch = (error: unknown): boolean =>
  error instanceof PreconditionFailed &&
  error.refusal._tag === "NothingToBatch";

/** The node, the batch size, and where the transaction goes. */
export interface RewardsBatchInput extends TxFileInput {
  readonly rpc: string;
  readonly limit: number;
}

/** Build the batcher's next transaction and write it unsigned. */
export const rewardsBatchProgram = (input: RewardsBatchInput) =>
  Effect.gen(function* () {
    const { tx } = yield* batchTx(input.network, input.rpc, input.limit);
    yield* writeTransaction(
      txFilePath(input),
      tx.toCbor(),
      tx.getId(),
      false,
      "Rewards Batch",
    );
    return tx;
  });
