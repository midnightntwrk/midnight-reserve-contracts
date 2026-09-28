/**
 * The rewards batch path (docs/rewards/spec.md §4.3, §5.3) end to end in
 * the emulator through the real scripts: the pool,
 * batcher, account list and reference scripts deployed by the deploy
 * steps; a committee bridge whose bootstrap root is a synthetic MMR of 14
 * leaves, where leaf 10 commits a digest block with a three-leaf epoch and
 * leaf 12 an empty epoch, each block's extrinsics trie holding its 125-byte
 * submit_rewards_digest; three accounts registered through
 * buildRegisterTx; the pool funded with test NIGHT. The epoch loads at its
 * first leaf and pays the whole run in one batch, whatever order the
 * ledger gives the deposits; that batch completes the fold and pays the
 * Treasury share to the ICS, and the empty epoch's load pays its share.
 * The digest proofs come from digestProofOf, the pump's code path.
 */
import { describe, expect, test } from "bun:test";
import {
  addressFromValidator,
  AssetId,
  derivePublicKey,
  Ed25519PrivateNormalKeyHex,
  Ed25519PublicKey,
  NetworkId,
  PaymentAddress,
  PlutusData,
  type Script,
  Transaction,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { Effect, Either, Layer, Option } from "effect";
import * as Contracts from "../contract_blueprint";
import { keccak } from "../cli/bridge/keccak";
import type { MmrLeaf } from "../cli/bridge/scale";
import { ProviderOver } from "../cli/chain/provider";
import { attachWitnesses, signTransaction } from "../cli/chain/transaction";
import { Blueprint, BlueprintLive } from "../cli/contracts/contracts";
import {
  DEPLOY_STEPS,
  type DeployComponent,
  type DeployInput,
} from "../cli/deploy/deploy";
import {
  type Batch,
  type BatchPlan,
  buildBatchTx,
  planBatch,
  type RewardLeaf,
  rewardLeaf,
} from "../cli/rewards/batch";
import { digestProofOf, encodeHeader } from "../cli/rewards/digest-proof";
import { buildRegisterTx, listNodes } from "../cli/rewards/register";
import { compactEncode, extrinsicsTrie, trieRoot } from "../cli/rewards/trie";
import { merkleRoot } from "./bridge/reference/keccak";
import { Mmr } from "./bridge/reference/mmr";
import { encodeLeaf } from "./bridge/reference/scale";
import { committeeOf, renumbered } from "./bridge/reference/session";
import {
  buildInstances,
  emulatorProfile,
  PlatformLive,
  runTest,
  SettingsWith,
} from "./helpers/effect";
import {
  addCollateral,
  councilSigners,
  FEE_TX,
  feeUtxo,
  keyAddress,
  techAuthSigners,
} from "./helpers/fixtures";

const leafOf = (key: string, amount: bigint): RewardLeaf =>
  rewardLeaf(
    concatBytes(
      Uint8Array.of(0),
      hexToBytes(key),
      hexToBytes(amount.toString(16).padStart(32, "0")),
    ),
  );

// -- end to end ---------------------------------------------------------------------

const networkId = NetworkId.Testnet;
const profile = await emulatorProfile();
const contracts = await buildInstances();
const emulator = new Emulator([]);
const [blaze, wallet] = await emulator.as(
  "wallet",
  async (b, a) => [b, a] as const,
);
emulator.addUtxo(feeUtxo(wallet, FEE_TX));
/** The reference scripts' holder: not the wallet, whose coin selection would spend them. */
const holder = keyAddress("ee".repeat(28));
const collateral = addCollateral(emulator, wallet);
const night = AssetId(
  profile.cnight_policy + Buffer.from(profile.cnight_name).toString("hex"),
);

const u64le = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};
const u128le = (n: bigint) =>
  concatBytes(u64le(n & ((1n << 64n) - 1n)), u64le(n >> 64n));

/** The 125-byte bare submit_rewards_digest. */
const digestExtrinsic = (
  epoch: bigint,
  leaves: readonly RewardLeaf[],
  treasury: bigint,
) => {
  const root =
    leaves.length === 0
      ? new Uint8Array(32)
      : merkleRoot(leaves.map((l) => keccak(l.bytes)));
  const key = (l: RewardLeaf | undefined) =>
    l === undefined ? new Uint8Array(28) : hexToBytes(l.key);
  const body = concatBytes(
    Uint8Array.of(
      0x05,
      profile.rewards_pallet_index,
      profile.rewards_call_index,
    ),
    u64le(epoch),
    u64le(BigInt(leaves.length)),
    root,
    key(leaves[0]),
    key(leaves[leaves.length - 1]),
    u128le(treasury),
  );
  return concatBytes(compactEncode(body.length), body);
};

const committee = {
  validator_set_id: 1n,
  seat_count: 1n,
  keyset_commitment: "ee".repeat(32),
};

/** A digest block `number` and its MMR leaf (the one block `number + 1` adds). */
const digestBlock = (number: number, extrinsic: Uint8Array) => {
  const extrinsics = [
    concatBytes(compactEncode(12), hexToBytes("0403" + "11".repeat(10))),
    extrinsic,
  ];
  const header = {
    parentHash: blake2b(Uint8Array.of(number), { dkLen: 32 }),
    number,
    stateRoot: blake2b(Uint8Array.of(number, 1), { dkLen: 32 }),
    extrinsicsRoot: trieRoot(extrinsicsTrie(extrinsics)),
    digest: { logs: [] },
  };
  const hash = blake2b(encodeHeader(header), { dkLen: 32 });
  const leaf: MmrLeaf = {
    version: 0,
    parentNumber: number,
    parentHash: hash,
    nextAuthoritySet: committee,
    extra: new Uint8Array(0),
  };
  const leafHash = keccak(
    encodeLeaf({
      parentNumber: number,
      parentHash: hash,
      nextAuthoritySet: {
        validatorSetId: 1n,
        seatCount: 1,
        keysetCommitment: hexToBytes(committee.keyset_commitment),
      },
    }),
  );
  return {
    number,
    hash: `0x${bytesToHex(hash)}`,
    header,
    extrinsics,
    leaf,
    leafHash,
  };
};

// Stake keys and the epoch-5 leaves over them, sorted by stake key hash.
const stakeKeys = ["21", "22", "23"].map((b) =>
  Ed25519PrivateNormalKeyHex(b.repeat(32)),
);
const skhOf = (key: Ed25519PrivateNormalKeyHex) =>
  Ed25519PublicKey.fromHex(derivePublicKey(key)).hash().hex();
const epoch5 = stakeKeys
  .map((key, i) => leafOf(skhOf(key), 1_000n * BigInt(i + 1)))
  .sort((a, b) => (a.key < b.key ? -1 : 1));
const TREASURY_5 = 40_000n;
const TREASURY_6 = 7_000n;

const block10 = digestBlock(10, digestExtrinsic(5n, epoch5, TREASURY_5));
const block12 = digestBlock(12, digestExtrinsic(6n, [], TREASURY_6));
const HEIGHT = 14;
const mmr = new Mmr(
  Array.from({ length: HEIGHT }, (_, i) =>
    i === 10
      ? block10.leafHash
      : i === 12
        ? block12.leafHash
        : keccak(Uint8Array.of(0xaa, i)),
  ),
);
const proofOf = (block: typeof block10) =>
  Either.getOrThrow(
    digestProofOf(
      {
        ...block,
        leafProof: {
          leafIndices: [BigInt(block.number)],
          leafCount: BigInt(HEIGHT),
          items: mmr.proof(block.number),
        },
      },
      profile.rewards_pallet_index,
      profile.rewards_call_index,
    ),
  );

const c4 = committeeOf(4n, [11n, 12n, 13n, 14n], [1, 2, 1, 1]);
const committeeVar = (c: typeof c4) =>
  `${c.commitment.validatorSetId}:${c.commitment.seatCount}:${bytesToHex(c.commitment.keysetCommitment)}`;
const layer = Layer.mergeAll(
  SettingsWith("emulator", {
    DEPLOYER_ADDRESS: wallet.toBech32(),
    BRIDGE_ACTIVATION_BLOCK: String(HEIGHT + 1),
    BRIDGE_MMR_ROOT: bytesToHex(mmr.root()),
    BRIDGE_CURRENT_COMMITTEE: committeeVar(c4),
    BRIDGE_NEXT_COMMITTEE: committeeVar(renumbered(c4, 5n)),
    BRIDGE_MAX_FEE_BASE: "650000",
    BRIDGE_MAX_FEE_PER_SIGNER: "13000",
    REWARDS_FIRST_EPOCH: "5",
  }),
  BlueprintLive("emulator", "build"),
  ProviderOver(new EmulatorProvider(emulator)),
  PlatformLive,
);

const deployInput: DeployInput = {
  network: "emulator",
  outputDir: "/tmp/rewards-batch",
  techAuthThreshold: { numerator: 2n, denominator: 3n },
  councilThreshold: { numerator: 2n, denominator: 3n },
  councilStagingThreshold: { numerator: 0n, denominator: 1n },
  techAuthStagingThreshold: { numerator: 1n, denominator: 2n },
  bridgeThreshold: { numerator: 2n, denominator: 3n },
  components: Option.none(),
};

const MAX_TX_SIZE = emulator.params.maxTxSize;

/** Build and submit a component's deployment over fresh one-shots; the verbose-trace batcher (18 KB) needs a larger limit than the silent deploy build. */
const deploy = async (component: DeployComponent) => {
  const step = DEPLOY_STEPS[component];
  const oneShots = step.oneShots(profile).map(([hash, index]) => {
    const utxo = feeUtxo(wallet, hash, index);
    emulator.addUtxo(utxo);
    return utxo;
  });
  emulator.params.maxTxSize = component.startsWith("rewards-batcher")
    ? 32_768
    : MAX_TX_SIZE;
  const builder = await runTest(
    layer,
    step.build(
      {
        input: deployInput,
        config: profile,
        contracts,
        deployer: holder.toBech32(),
        techAuthSigners,
        councilSigners,
        blaze,
        params: {
          networkId,
          coinsPerUtxoByte: emulator.params.coinsPerUtxoByte,
          collateral,
        },
        maxTxSize: MAX_TX_SIZE,
      },
      oneShots,
    ),
  );
  await emulator.expectValidTransaction(blaze, builder);
  emulator.params.maxTxSize = MAX_TX_SIZE;
};

const scripts = await runTest(
  layer,
  Effect.flatMap(Blueprint, (b) =>
    Effect.all({
      batcher: b.optional("rewardsBatcher"),
      account: b.optional("virtualAccount"),
      pool: b.twoStage("rewards-pool"),
      bridge: b.twoStage("committee-bridge"),
    }),
  ),
);
const at = (script: Script) =>
  emulator
    .utxos()
    .filter(
      (u) =>
        u.output().address().toBech32() ===
        addressFromValidator(networkId, script).toBech32(),
    );
const withToken = (utxos: TransactionUnspentOutput[], unit: string) =>
  utxos.find(
    (u) => (u.output().amount().multiasset()?.get(AssetId(unit)) ?? 0n) > 0n,
  )!;
const referenceTo = (script: Script) =>
  emulator
    .utxos()
    .find((u) => u.output().scriptRef()?.hash() === script.hash())!;
const nightAt = (script: Script) =>
  at(script).reduce(
    (sum, u) => sum + (u.output().amount().multiasset()?.get(night) ?? 0n),
    0n,
  );

/** Complete, sign with the wallet (and `keys`), submit and confirm; the size and budget of the transaction. */
const land = async (
  builder: TxBuilder,
  keys: readonly Ed25519PrivateNormalKeyHex[] = [],
) => {
  const tx = await builder.complete();
  const signed = await blaze.signTransaction(tx);
  const withKeys: Transaction =
    keys.length === 0
      ? signed
      : attachWitnesses(signed.toCbor(), signTransaction(signed.getId(), keys));
  emulator.awaitTransactionConfirmation(
    await emulator.submitTransaction(withKeys),
  );
  const redeemers = withKeys.witnessSet().redeemers()?.values() ?? [];
  return {
    bytes: withKeys.toCbor().length / 2,
    mem: redeemers.reduce((s, r) => s + r.exUnits().mem(), 0n),
    steps: redeemers.reduce((s, r) => s + r.exUnits().steps(), 0n),
  };
};

const stateOf = () => {
  const utxo = withToken(
    at(scripts.batcher.Script),
    scripts.batcher.Script.hash(),
  );
  return {
    utxo,
    state: parse(
      Contracts.BatcherState,
      utxo.output().datum()!.asInlineData()!,
    ),
  };
};

const chainOf = () => {
  const { utxo } = stateOf();
  return {
    batcher: scripts.batcher.Script,
    account: scripts.account.Script,
    poolForever: scripts.pool.forever.Script,
    poolLogic: scripts.pool.logic.Script,
    poolMitigation: Option.none<Script>(),
    icsForever: contracts.icsForever.Script,
    scriptRefs: [
      referenceTo(scripts.batcher.Script),
      referenceTo(scripts.account.Script),
      referenceTo(scripts.pool.forever.Script),
      referenceTo(scripts.pool.logic.Script),
    ],
    poolMain: withToken(
      at(scripts.pool.twoStage.Script),
      scripts.pool.twoStage.Script.hash() + "6d61696e",
    ),
    stateUtxo: utxo,
    poolUtxos: at(scripts.pool.forever.Script).filter(
      (u) =>
        (u
          .output()
          .amount()
          .multiasset()
          ?.get(AssetId(scripts.pool.forever.Script.hash())) ?? 0n) === 0n,
    ),
    collateral,
    night,
  };
};

const depositOf = (key: string) =>
  withToken(
    at(scripts.account.Script),
    scripts.account.Script.hash() + "00" + key,
  );

const measured: Record<string, { bytes: number; mem: bigint; steps: bigint }> =
  {};

describe("the rewards batch path in the emulator", () => {
  test("deploys the bridge, pool, batcher, account list and reference scripts", async () => {
    for (const component of [
      "committee-bridge",
      "rewards-pool",
      "rewards-batcher",
      "virtual-account-stake",
      "virtual-account",
      "rewards-batcher-script",
      "rewards-scripts",
    ] as const)
      await deploy(component);
    expect(stateOf().state.epoch).toBe(4n);
  });

  test("registers three accounts through buildRegisterTx", async () => {
    for (const key of stakeKeys) {
      const skh = skhOf(key);
      const nodes = Either.getOrThrow(
        listNodes(at(scripts.account.Script), scripts.account.Script.hash()),
      );
      const anchor = nodes.find((n) => n.key < skh && skh < n.next)!;
      measured[`register ${skh.slice(0, 6)}`] = await land(
        buildRegisterTx(
          blaze,
          {
            account: scripts.account.Script,
            accountRef: referenceTo(scripts.account.Script),
            anchor,
            skh,
            deposit: 10_000_000n,
            destinations: { ["01" + skh]: 1000n },
            operatorKeys: {},
            payoutThreshold: 0n,
            collateral,
          },
          networkId,
        ),
        [key],
      );
    }
    expect(epoch5.every((l) => depositOf(l.key) !== undefined)).toBe(true);
  });

  test("funds the pool with test NIGHT", () => {
    emulator.addUtxo(
      new TransactionUnspentOutput(
        new TransactionInput(TransactionId("9a".repeat(32)), 0n),
        TransactionOutput.fromCore({
          address: PaymentAddress(
            addressFromValidator(
              networkId,
              scripts.pool.forever.Script,
            ).toBech32(),
          ),
          value: { coins: 5_000_000n, assets: new Map([[night, 1_000_000n]]) },
          datum: PlutusData.fromCore({
            constructor: 0n,
            fields: { items: [] },
          }).toCore(),
        }),
      ),
    );
    expect(nightAt(scripts.pool.forever.Script)).toBe(1_000_000n);
  });

  /** Land one batch of the fold and return its plan. */
  const batch = async (
    name: string,
    load: Option.Option<{ proof: Contracts.DigestProof }>,
    leaves: readonly RewardLeaf[],
    treasuryTotal: bigint,
    limit: number,
  ): Promise<Option.Option<BatchPlan>> => {
    const chain = chainOf();
    const { state } = stateOf();
    const loading = Option.isSome(load);
    const start = loading
      ? 0
      : leaves.findIndex((l) => l.key === state.start_key);
    const from = loading
      ? start
      : leaves.findIndex((l) => l.key === state.cursor);
    const plan =
      leaves.length === 0
        ? Option.none<BatchPlan>()
        : Option.some(planBatch(leaves, from, start, limit));
    const loaded: Contracts.BatcherState = loading
      ? {
          ...state,
          epoch: state.epoch + 1n,
          root:
            leaves.length === 0
              ? "00".repeat(32)
              : bytesToHex(merkleRoot(leaves.map((l) => keccak(l.bytes)))),
          min_key: leaves[0]?.key ?? "00".repeat(28),
          max_key: leaves[leaves.length - 1]?.key ?? "00".repeat(28),
          treasury_total: treasuryTotal,
        }
      : state;
    const stateOut: Contracts.BatcherState = Option.match(plan, {
      onNone: () => loaded,
      onSome: (p) => ({
        ...loaded,
        ...(loading ? { start_key: leaves[start].key } : {}),
        cursor: p.cursor,
        complete: p.complete,
      }),
    });
    const completes = Option.match(plan, {
      onNone: () => true,
      onSome: (p) => p.complete,
    });
    const b: Batch = {
      load: Option.map(load, ({ proof }) => ({
        digestProof: proof,
        bridge: withToken(
          at(scripts.bridge.forever.Script),
          scripts.bridge.forever.Script.hash(),
        ),
      })),
      leaves,
      plan,
      deposits: Option.match(plan, {
        onNone: () => [],
        onSome: (p) => p.paid.map((i) => depositOf(leaves[i].key)),
      }),
      stateOut,
      treasury: completes ? treasuryTotal : 0n,
    };
    const builder = buildBatchTx(
      blaze,
      {
        ...chain,
        poolUtxos:
          b.treasury === 0n && leaves.length === 0 ? [] : chain.poolUtxos,
      },
      b,
      networkId,
    );
    measured[name] = await land(builder);
    return plan;
  };

  test("loads epoch 5 at its first leaf, pays the run in one batch in any deposit order, and pays the Treasury share to the ICS", async () => {
    const icsBefore = nightAt(contracts.icsForever.Script);
    await batch(
      "load epoch 5",
      Option.some({ proof: proofOf(block10) }),
      epoch5,
      TREASURY_5,
      2,
    );
    for (let i = 1; !stateOf().state.complete; i++) {
      expect(i).toBeLessThan(5);
      await batch(`pay ${i}`, Option.none(), epoch5, TREASURY_5, 2);
    }
    const total = epoch5.reduce((s, l) => s + l.amount, 0n);
    expect(nightAt(scripts.pool.forever.Script)).toBe(
      1_000_000n - total - TREASURY_5,
    );
    expect(nightAt(contracts.icsForever.Script) - icsBefore).toBe(TREASURY_5);
    for (const leaf of epoch5)
      expect(
        depositOf(leaf.key).output().amount().multiasset()?.get(night),
      ).toBe(leaf.amount);
  });

  test("loads the empty epoch 6, paying its Treasury share from the pool", async () => {
    const icsBefore = nightAt(contracts.icsForever.Script);
    await batch(
      "load empty epoch 6",
      Option.some({ proof: proofOf(block12) }),
      [],
      TREASURY_6,
      2,
    );
    expect(stateOf().state.epoch).toBe(6n);
    expect(nightAt(contracts.icsForever.Script) - icsBefore).toBe(TREASURY_6);
    console.log(
      Object.entries(measured)
        .map(([k, v]) => `${k}: ${v.bytes} B, ${v.mem} mem, ${v.steps} steps`)
        .join("\n"),
    );
  });
});
