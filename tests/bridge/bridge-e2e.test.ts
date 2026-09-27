/**
 * The committee bridge end to end in the Blaze emulator (plan 06 task 3):
 * deployed through the deploy steps, then driven through the bridge builders
 * with updates the TS reference signs. Committee c holds four keys with
 * seats (1, 2, 1, 1); c + 1 (the same keys) is next at bootstrap. The tests
 * run in order on one chain: the deploy, the activation-block justification,
 * two small top-ups, the rejections (each a valid update with one field
 * broken, pinned to its guard's trace), three funded handovers (the second
 * changes membership; by the third the pool holds less than the fee above
 * its minimum, so it pays that and the submitter the rest) and a stale
 * datum. Rule 0's address and value, rule 12 and rule 16 cannot be built
 * through the builder; the Aiken tests cover them. The emulator does not
 * check the min UTxO, so an empty pool is bridge-update's refusal, not a
 * chain failure here.
 */
import { describe, expect, test } from "bun:test";
import {
  NetworkId,
  PaymentAddress,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Layer, Option } from "effect";
import type {
  BeefyConsensusState,
  BridgeUpdate,
} from "../../contract_blueprint";
import {
  beefyThresholdAt,
  bridgeScripts,
  bridgeStateAt,
  bridgeUtxos,
  referenceScripts,
} from "../../cli/bridge/bridge-chain";
import {
  buildBridgeTopupTx,
  buildBridgeUpdateTx,
  type PoolFunding,
  poolDebit,
  poolMinimum,
} from "../../cli/bridge/bridge-tx";
import { ProviderOver } from "../../cli/chain/provider";
import { BlueprintLive } from "../../cli/contracts/contracts";
import { nextBridgeState } from "../../cli/datum/bridge";
import {
  DEPLOY_STEPS,
  type DeployComponent,
  type DeployInput,
} from "../../cli/deploy/deploy";
import {
  buildInstances,
  emulatorProfile,
  PlatformLive,
  runTest,
  SettingsWith,
} from "../helpers/effect";
import {
  addCollateral,
  councilSigners,
  FEE_TX,
  feeUtxo,
  keyAddress,
  techAuthSigners,
} from "../helpers/fixtures";
import { hex } from "./reference/update";
import {
  bootstrapOf,
  type Committee,
  committeeOf,
  quorum,
  renumbered,
  signedUpdate,
} from "./reference/session";

const ACTIVATION = 10;
const FEE_BASE = 650_000n;
const FEE_PER_SIGNER = 13_000n;

const c4 = committeeOf(4n, [11n, 12n, 13n, 14n], [1, 2, 1, 1]);
const c5 = renumbered(c4, 5n);
const c6 = renumbered(c4, 6n);
const d7 = committeeOf(7n, [21n, 22n, 23n, 24n], [1, 1, 1, 1]);
const d8 = renumbered(d7, 8n);

const committeeVar = (c: Committee) =>
  `${c.commitment.validatorSetId}:${c.commitment.seatCount}:${hex(c.commitment.keysetCommitment)}`;

/** The reference scripts' holder: not the wallet, whose coin selection would spend them. */
const holder = keyAddress("ee".repeat(28));
const bootstrap = bootstrapOf(c4, c5, ACTIVATION);

const emulator = new Emulator([]);
const layer = Layer.mergeAll(
  SettingsWith("emulator", {
    DEPLOYER_ADDRESS: holder.toBech32(),
    BRIDGE_ACTIVATION_BLOCK: String(ACTIVATION),
    BRIDGE_MMR_ROOT: bootstrap.latest_mmr_root,
    BRIDGE_CURRENT_COMMITTEE: committeeVar(c4),
    BRIDGE_NEXT_COMMITTEE: committeeVar(c5),
    BRIDGE_MAX_FEE_BASE: String(FEE_BASE),
    BRIDGE_MAX_FEE_PER_SIGNER: String(FEE_PER_SIGNER),
  }),
  BlueprintLive("emulator", "build"),
  ProviderOver(new EmulatorProvider(emulator)),
  PlatformLive,
);
const [blaze, wallet] = await emulator.as(
  "wallet",
  async (b, a) => [b, a] as const,
);
emulator.addUtxo(feeUtxo(wallet, FEE_TX));
const profile = await emulatorProfile();
const contracts = await buildInstances();
const scripts = await runTest(layer, bridgeScripts);
const networkId = NetworkId.Testnet;
const minimum = poolMinimum(
  scripts.pool,
  networkId,
  emulator.params.coinsPerUtxoByte,
);

const deployInput: DeployInput = {
  network: "emulator",
  outputDir: "/tmp/bridge-e2e",
  techAuthThreshold: { numerator: 2n, denominator: 3n },
  councilThreshold: { numerator: 2n, denominator: 3n },
  councilStagingThreshold: { numerator: 0n, denominator: 1n },
  techAuthStagingThreshold: { numerator: 1n, denominator: 2n },
  bridgeThreshold: { numerator: 2n, denominator: 3n },
  components: Option.none(),
};

/** Build and submit a component's deployment over the wallet's one-shots. */
const deploy = async (component: DeployComponent) => {
  const step = DEPLOY_STEPS[component];
  const oneShots = step.oneShots(profile).map(([hash, index]) => {
    const utxo = feeUtxo(wallet, hash, index);
    emulator.addUtxo(utxo);
    return utxo;
  });
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
          collateral: addCollateral(emulator, wallet),
        },
        maxTxSize: emulator.params.maxTxSize,
      },
      oneShots,
    ),
  );
  await emulator.expectValidTransaction(blaze, builder);
};

/** The light client, main, threshold and pool UTxOs and the state, read through the CLI's lookups. */
const chain = () =>
  runTest(
    layer,
    Effect.gen(function* () {
      const utxos = yield* bridgeUtxos(scripts, networkId);
      return {
        ...utxos,
        state: yield* bridgeStateAt(utxos.lightClient),
        cap: yield* Effect.map(
          beefyThresholdAt(utxos.threshold),
          (t) => (signers: bigint) => t.base + t.per_signer * signers,
        ),
      };
    }),
  );

const lovelaceOf = (utxos: readonly TransactionUnspentOutput[]) =>
  utxos.reduce((sum, u) => sum + u.output().amount().coin(), 0n);

const signersOf = (update: BridgeUpdate) =>
  BigInt(update.signatures.filter((sig) => sig !== "").length);

interface UpdateOptions {
  readonly stateOut?: BeefyConsensusState;
  /** Spend the pool; the debit is poolDebit's, as bridge-update sets it, unless given. */
  readonly funded?: { readonly debit?: bigint };
}

/** The update over the current chain, built as bridge-update builds it. */
const updateTx = async (update: BridgeUpdate, opts: UpdateOptions = {}) => {
  const { lightClient, main, threshold, pool, state, cap } = await chain();
  const funded = opts.funded !== undefined;
  const scriptRefs = await runTest(
    layer,
    referenceScripts([
      scripts.forever.hash(),
      scripts.logic.hash(),
      ...(funded ? [scripts.pool.hash()] : []),
    ]),
  );
  const build = (funding: Option.Option<PoolFunding>) =>
    buildBridgeUpdateTx(
      blaze,
      {
        forever: scripts.forever,
        logic: scripts.logic,
        mitigationLogic: Option.none(),
        pool: scripts.pool,
        foreverUtxo: lightClient,
        mainUtxo: main,
        thresholdUtxo: threshold,
        scriptRefs,
      },
      update,
      opts.stateOut ?? nextBridgeState(state, update),
      funding,
      networkId,
    );
  if (opts.funded === undefined) return build(Option.none());
  const fee = (
    await build(Option.some({ poolUtxos: pool, debit: 0n })).complete()
  )
    .body()
    .fee();
  return build(
    Option.some({
      poolUtxos: pool,
      debit:
        opts.funded.debit ??
        poolDebit(fee, cap(signersOf(update)), lovelaceOf(pool), minimum),
    }),
  );
};

/** Submit a funded handover: the pool merges into one output, pays at most the cap and keeps its minimum, and the state rotates. */
const fundedHandover = async (update: BridgeUpdate) => {
  const before = await chain();
  const tx = await updateTx(update, { funded: {} });
  const fee = (await tx.complete()).body().fee();
  await emulator.expectValidTransaction(
    blaze,
    await updateTx(update, { funded: {} }),
  );
  const after = await chain();
  const paid = lovelaceOf(before.pool) - lovelaceOf(after.pool);
  expect(paid).toBeGreaterThan(0n);
  expect(paid).toBeLessThanOrEqual(before.cap(signersOf(update)));
  expect(paid).toBeLessThanOrEqual(fee);
  expect(after.pool).toHaveLength(1);
  expect(lovelaceOf(after.pool)).toBeGreaterThanOrEqual(minimum);
  expect(after.state).toEqual(nextBridgeState(before.state, update));
  return { state: after.state, paid, fee, pool: lovelaceOf(after.pool) };
};

const topup = async (lovelace: bigint) =>
  emulator.expectValidTransaction(
    blaze,
    buildBridgeTopupTx(blaze, scripts.pool, lovelace, networkId),
  );

/** The logic script (the withdrawal) rejected. */
const logicRejected = /failed script execution\s+Withdraw\[0\]/;

/** The first handover: c + 1 signs block 11, naming c + 2. */
const h1 = signedUpdate(c5, ACTIVATION + 1, c6.commitment, quorum(c5));

describe("the committee bridge in the Blaze emulator", () => {
  test("deploys: the light client holds the bootstrap of c and c + 1 from the env, the threshold transaction registers the logic, and the reference scripts sit at the holder", async () => {
    await deploy("committee-bridge");
    await deploy("committee-bridge-threshold");
    await deploy("committee-bridge-scripts");
    expect((await chain()).state).toEqual(bootstrap);
    await runTest(
      layer,
      referenceScripts([
        scripts.forever.hash(),
        scripts.logic.hash(),
        scripts.pool.hash(),
      ]),
    );
  });

  test("two top-ups land at the pool address", async () => {
    await topup(1_200_000n);
    await topup(900_000n);
    expect(lovelaceOf((await chain()).pool)).toBe(2_100_000n);
  });

  test("the activation-block justification by c is accepted unfunded; the pool is untouched", async () => {
    const pool = lovelaceOf((await chain()).pool);
    const justification = signedUpdate(
      c4,
      ACTIVATION,
      c5.commitment,
      quorum(c4),
    );
    await emulator.expectValidTransaction(blaze, await updateTx(justification));
    const after = await chain();
    expect(after.state.latest_height).toBe(BigInt(ACTIVATION));
    expect(lovelaceOf(after.pool)).toBe(pool);
  });

  const withSignatures = (
    update: BridgeUpdate,
    f: (sigs: string[]) => string[],
  ): BridgeUpdate => ({ ...update, signatures: f([...update.signatures]) });

  const flipByte = (hexText: string) => {
    const bytes = Buffer.from(hexText, "hex");
    bytes[5] ^= 1;
    return bytes.toString("hex");
  };

  test.each<[string, RegExp, () => Promise<TxBuilder>]>([
    [
      "rule 0: a stale state_out",
      /Trace expect state_out == next_state/,
      async () => updateTx(h1, { stateOut: (await chain()).state }),
    ],
    [
      "rule 1: a block at the latest height",
      /Trace expect block_number > latest_height/,
      () => updateTx(signedUpdate(c5, ACTIVATION, c6.commitment, quorum(c5))),
    ],
    [
      "rule 2: a set that is neither current nor next",
      /Trace expect validator_set_id == next_committee\.validator_set_id/,
      () =>
        updateTx(
          signedUpdate(
            renumbered(c4, 9n),
            ACTIVATION + 1,
            c5.commitment,
            quorum(c4),
          ),
        ),
    ],
    [
      "rule 3: signers outside the set's keyset",
      /Trace expect calculated_hash == root/,
      () =>
        updateTx(
          signedUpdate(
            renumbered(d7, 5n),
            ACTIVATION + 1,
            c6.commitment,
            quorum(d7),
          ),
        ),
    ],
    [
      "rule 5: one flipped signature byte",
      /Trace expect\s+builtin\.verify_ecdsa_secp256k1_signature/,
      () =>
        updateTx(
          withSignatures(h1, (sigs) => [flipByte(sigs[0]), ...sigs.slice(1)]),
        ),
    ],
    [
      "rule 5: one signature fewer than the leaves",
      /Trace expect \[\] = leaves/,
      () => updateTx(withSignatures(h1, (sigs) => sigs.slice(0, -1))),
    ],
    [
      "rule 6: signers below the quorum",
      /Trace expect remaining <= 0/,
      () =>
        updateTx(
          signedUpdate(c5, ACTIVATION + 1, c6.commitment, quorum(c5).slice(1)),
        ),
    ],
    [
      "rule 6: a surplus signer",
      /Trace expect remaining \+ min_seats > 0/,
      () =>
        updateTx(signedUpdate(c5, ACTIVATION + 1, c6.commitment, [0, 1, 2, 3])),
    ],
    [
      "rule 7: a leaf whose parent is not the block before",
      /Trace expect leaf\.parent_number == block_number - 1/,
      () =>
        updateTx(
          signedUpdate(
            c5,
            ACTIVATION + 1,
            c6.commitment,
            quorum(c5),
            undefined,
            ACTIVATION + 1,
          ),
        ),
    ],
    [
      "rule 8: a broken MMR proof",
      /Trace expect\s+verify_mmr_leaf/,
      () =>
        updateTx({
          ...h1,
          mmr_proof: [flipByte(h1.mmr_proof[0]), ...h1.mmr_proof.slice(1)],
        }),
    ],
    [
      "rule 9: a leaf naming next + 2",
      /Trace expect leaf_next_id == next_id \|\| leaf_next_id == next_id \+ 1/,
      () =>
        updateTx(
          signedUpdate(
            c4,
            ACTIVATION + 1,
            renumbered(c4, 7n).commitment,
            quorum(c4),
          ),
        ),
    ],
    [
      "rule 10: next signing a leaf that hands nothing over",
      /Trace expect validator_set_id != next_id \|\| leaf_next_id == next_id \+ 1/,
      () =>
        updateTx(signedUpdate(c5, ACTIVATION + 1, c5.commitment, quorum(c5))),
    ],
    [
      "rule 15: a funded update that is no handover",
      /Validator returned false/,
      () =>
        updateTx(signedUpdate(c4, ACTIVATION + 1, c5.commitment, quorum(c4)), {
          funded: { debit: 100_000n },
        }),
    ],
    [
      "rule 17: a debit above the cap",
      /Validator returned false/,
      async () =>
        updateTx(h1, {
          funded: { debit: (await chain()).cap(signersOf(h1)) + 1n },
        }),
    ],
  ])("%s is rejected by its guard in the logic", async (_name, guard, tx) => {
    const failed = new RegExp(
      `${logicRejected.source}[\\s\\S]*${guard.source}`,
    );
    await emulator.expectScriptFailure(await tx(), failed);
  });

  test("after the top-up the same handover is accepted: the pool's two UTxOs merge into one, and it pays at most the cap", async () => {
    expect((await chain()).pool).toHaveLength(2);
    await fundedHandover(h1);
  });

  test("the second funded handover changes membership; the new keys sign the third, which the pool funds only above its minimum", async () => {
    const second = await fundedHandover(
      signedUpdate(c6, ACTIVATION + 2, d7.commitment, quorum(c6)),
    );
    expect(second.state.next_committee.keyset_commitment).toBe(
      hex(d7.commitment.keysetCommitment),
    );
    const third = await fundedHandover(
      signedUpdate(d7, ACTIVATION + 3, d8.commitment, quorum(d7)),
    );
    expect(third.state.current_committee.validator_set_id).toBe(7n);
    expect(third.paid).toBeLessThan(third.fee);
    expect(third.pool).toBe(minimum);
  });

  test("a stale datum: a transaction built against the light client fails phase 1 once an update lands", async () => {
    const { lightClient } = await chain();
    const consumer = await blaze
      .newTransaction()
      .addReferenceInput(lightClient)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(wallet.toBech32()),
          value: { coins: 2_000_000n },
        }),
      )
      .complete();
    const signed = await blaze.signTransaction(consumer);
    await emulator.expectValidTransaction(
      blaze,
      await updateTx(
        signedUpdate(d7, ACTIVATION + 4, d8.commitment, quorum(d7)),
      ),
    );
    await expect(emulator.submitTransaction(signed)).rejects.toThrow();
  });
});
