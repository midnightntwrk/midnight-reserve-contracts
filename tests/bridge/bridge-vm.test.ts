/**
 * The bridge transactions of `cli/bridge/bridge-tx.ts` in the Blaze emulator
 * (UPLC evaluator), with the TypeScript reference producing each update: the
 * light client spent under the two-stage `main` reference, the logic
 * withdrawing with the `BridgeUpdate`, the scripts from reference-script
 * UTxOs; a funded handover, a top-up and a BEEFY threshold edit.
 */
import { describe, expect, test } from "bun:test";
import {
  addressFromValidator,
  NetworkId,
  PaymentAddress,
  type Script,
  TransactionId,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { type Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import { Option } from "effect";
import * as C from "../../contract_blueprint";
import {
  buildBridgeThresholdTx,
  buildBridgeTopupTx,
  buildBridgeUpdateTx,
  type BridgeUpdateInputs,
} from "../../cli/bridge/bridge-tx";
import { nextBridgeState } from "../../cli/datum/bridge";
import { MAIN_TOKEN_HEX } from "../../cli/chain/governance-provider";
import {
  asFunded,
  authorityForevers,
  councilSigners,
  keyAddress,
  randomHash,
  registerRewardAccount,
  requirementsOf,
  scriptAddress,
  scriptUtxo,
  techAuthSigners,
  thresholdUtxo,
  upgradeState,
} from "../helpers/fixtures";
import { concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { Either } from "effect";
import { updateFromJustification } from "../../cli/bridge/fetch-justification";
import { keccak } from "../../cli/bridge/keccak";
import {
  decodeAuthoritySet,
  decodeFinalityProof,
  decodeLeafProof,
  decodeSingleLeaf,
  decodeValidatorSet,
} from "../../cli/bridge/scale";
import nodeHandover from "../vectors/bridge/node-handover.json";
import {
  dummyLeafHash,
  parentHash,
  scenarioByName,
  type Scenario,
} from "./reference/fixtures";
import { Mmr } from "./reference/mmr";
import { encodeCommitment, encodeLeaf } from "./reference/scale";
import { committeeOf, renumbered } from "./reference/session";
import { sign } from "./reference/sign";
import { bridgeUpdate, toCommitment } from "./reference/update";
import { handoverState } from "./reference/vectors";

const forever = new C.CommitteeBridgeCommitteeBridgeForeverElse();
const logic = new C.CommitteeBridgeCommitteeBridgeLogicElse();
const twoStage = new C.CommitteeBridgeCommitteeBridgeTwoStageUpgradeElse();
const threshold = new C.ThresholdsBeefySignerThresholdElse();
const pool = new C.CommitteeBridgePoolCommitteeBridgePoolElse();

const FEE_CAP: C.BeefyThreshold = {
  numerator: 2n,
  denominator: 3n,
  base: 650_000n,
  per_signer: 13_000n,
};

/** A UTxO at a key address carrying `script` as its reference script. */
const scriptRefUtxo = (script: Script) =>
  TransactionUnspentOutput.fromCore([
    { index: 0, txId: TransactionId(randomHash(32)) },
    {
      address: PaymentAddress(keyAddress("ee".repeat(28)).toBech32()),
      value: { coins: 50_000_000n },
      scriptReference: script.toCore(),
    },
  ]);

/** An ADA-only UTxO at the pool address. */
const poolUtxo = (coins: bigint) =>
  TransactionUnspentOutput.fromCore([
    { index: 0, txId: TransactionId(randomHash(32)) },
    { address: scriptAddress(pool.Script), value: { coins } },
  ]);

/** The light client at `stateIn`, its two-stage main, the BEEFY threshold, the reference scripts (the pool's when funded) and the logic's reward account. */
function seed(
  emulator: Emulator,
  stateIn: C.BeefyConsensusState,
  funded: boolean,
): BridgeUpdateInputs {
  registerRewardAccount(emulator, logic.Script.hash());
  const inputs: BridgeUpdateInputs = {
    forever: forever.Script,
    logic: logic.Script,
    mitigationLogic: Option.none(),
    pool: pool.Script,
    foreverUtxo: scriptUtxo(
      "aa".repeat(32),
      forever.Script,
      "",
      serialize(C.BeefyConsensusState, stateIn),
      5_000_000n,
    ),
    mainUtxo: scriptUtxo(
      "bb".repeat(32),
      twoStage.Script,
      MAIN_TOKEN_HEX,
      upgradeState(logic.Script.hash(), ""),
    ),
    thresholdUtxo: scriptUtxo(
      "cc".repeat(32),
      threshold.Script,
      "",
      serialize(C.BeefyThreshold, FEE_CAP),
    ),
    scriptRefs: [forever, logic, ...(funded ? [pool] : [])].map((c) =>
      scriptRefUtxo(c.Script),
    ),
  };
  for (const u of [
    inputs.foreverUtxo,
    inputs.mainUtxo,
    inputs.thresholdUtxo,
    ...inputs.scriptRefs,
  ])
    emulator.addUtxo(u);
  return inputs;
}

/** The logic script (the withdrawal) rejected; not the forever spend, not balancing. */
const logicRejected = /failed script execution\s+Withdraw\[0\]/;

interface UpdateOptions {
  signers?: number[];
  stateOut?: C.BeefyConsensusState;
  mutate?: (u: C.BridgeUpdate) => void;
  /** The pool's lovelace and the debit of a funded update. */
  funding?: { poolLovelace: bigint; debit: bigint };
}

/** The update for `s` over the handover state on a fresh emulator. */
const updateTx = (s: Scenario, opts: UpdateOptions) =>
  asFunded(async (emulator, blaze) => {
    const stateIn = handoverState();
    const inputs = seed(emulator, stateIn, opts.funding !== undefined);
    const update = bridgeUpdate(s, [0, 1, 2], opts.signers ?? [0, 1]);
    opts.mutate?.(update);
    const funding = Option.map(
      Option.fromNullable(opts.funding),
      ({ poolLovelace, debit }) => {
        const utxo = poolUtxo(poolLovelace);
        emulator.addUtxo(utxo);
        return { poolUtxos: [utxo], debit };
      },
    );
    const tx = buildBridgeUpdateTx(
      blaze,
      inputs,
      update,
      opts.stateOut ?? nextBridgeState(stateIn, update),
      funding,
      NetworkId.Testnet,
    );
    return { emulator, blaze, tx };
  });

const accepted = async (s: Scenario, opts: UpdateOptions = {}) => {
  const { emulator, blaze, tx } = await updateTx(s, opts);
  await emulator.expectValidTransaction(blaze, tx);
};

describe("buildBridgeUpdateTx in the Blaze VM", () => {
  test("a_no_handover: committee 4 signs a leaf naming 5", async () => {
    await accepted(scenarioByName("a_no_handover"));
  });
  test("b_handover: committee 5 signs a leaf naming 6, state rotates", async () => {
    const s = scenarioByName("b_handover");
    expect(
      nextBridgeState(handoverState(), bridgeUpdate(s, [0, 1, 2], [0, 1]))
        .current_committee.validator_set_id,
    ).toBe(5n);
    await accepted(s);
  });
  test("b_handover funded: the pool pays a debit within the cap, and the fee covers it", async () => {
    await accepted(scenarioByName("b_handover"), {
      funding: { poolLovelace: 20_000_000n, debit: 650_000n },
    });
  });
  test.each<[string, string, UpdateOptions]>([
    [
      "one flipped signature byte",
      "a_no_handover",
      {
        mutate: (u) => {
          const sig = Buffer.from(u.signatures[0], "hex");
          sig[5] ^= 1;
          u.signatures[0] = sig.toString("hex");
        },
      },
    ],
    [
      "one signer of seat 1 is below the quorum of 3",
      "a_no_handover",
      { signers: [0] },
    ],
    ["stale state_out", "a_no_handover", { stateOut: handoverState() }],
    [
      "a funded update that is no handover (rule 15)",
      "a_no_handover",
      { funding: { poolLovelace: 20_000_000n, debit: 650_000n } },
    ],
  ])("%s is rejected by the logic", async (_name, scenario, opts) => {
    const { emulator, tx } = await updateTx(scenarioByName(scenario), opts);
    await emulator.expectScriptFailure(tx, logicRejected);
  });
});

describe("buildBridgeTopupTx", () => {
  test("pays the lovelace to the pool address with no datum", async () => {
    await asFunded(async (emulator, blaze) => {
      await emulator.expectValidTransaction(
        blaze,
        buildBridgeTopupTx(blaze, pool.Script, 7_000_000n, NetworkId.Testnet),
      );
      const held = await new EmulatorProvider(emulator).getUnspentOutputs(
        addressFromValidator(NetworkId.Testnet, pool.Script),
      );
      expect(
        held.map((u) => [u.output().amount().coin(), u.output().datum()]),
      ).toEqual([[7_000_000n, undefined]]);
    });
  });
});

describe("buildBridgeThresholdTx", () => {
  test("moves the BEEFY threshold NFT to a new fee cap under both authorities' witnesses", async () => {
    await asFunded(async (emulator, blaze, addr, userUtxo) => {
      const seeded = {
        thresholdUtxo: scriptUtxo(
          "cc".repeat(32),
          threshold.Script,
          "",
          serialize(C.BeefyThreshold, FEE_CAP),
        ),
        mainGovThresholdUtxo: thresholdUtxo(
          "c0".repeat(32),
          new C.ThresholdsMainGovThresholdElse().Script,
        ),
        ...authorityForevers(
          new C.PermissionedCouncilForeverElse().Script,
          new C.PermissionedTechAuthForeverElse().Script,
        ),
      };
      for (const u of Object.values(seeded)) emulator.addUtxo(u);
      await emulator.expectValidTransaction(
        blaze,
        buildBridgeThresholdTx(
          blaze,
          {
            threshold: threshold.Script,
            ...seeded,
            userUtxo,
            councilSigners,
            techAuthSigners,
            requirements: requirementsOf({ councilSigners, techAuthSigners }),
          },
          { ...FEE_CAP, base: 700_000n, per_signer: 14_000n },
          {
            networkId: NetworkId.Testnet,
            changeAddress: addr,
            feePadding: 0n,
            txType: "bridge-set-fee",
          },
        ),
      );
    });
  });
});

const bytes = (hex: string) => hexToBytes(hex.replace(/^0x/, ""));

/** The light client over `current` and `next`, just before block `block`. */
const stateBefore = (
  block: number,
  current: C.AuthoritySetCommitment,
  next: C.AuthoritySetCommitment,
): C.BeefyConsensusState => ({
  latest_mmr_root: "00".repeat(32),
  latest_height: BigInt(block - 1),
  beefy_activation_block: 100n,
  current_committee: current,
  next_committee: next,
});

describe("updateFromJustification in the Blaze VM", () => {
  test("a dev node's first block of a session is a funded handover", async () => {
    const v = nodeHandover;
    const { update } = Either.getOrThrow(
      updateFromJustification(
        v.block,
        Either.getOrThrow(decodeFinalityProof(bytes(v.justification))),
        Either.getOrThrow(decodeValidatorSet(bytes(v.validator_set))),
        Either.getOrThrow(decodeSingleLeaf(bytes(v.mmr_leaves))),
        Either.getOrThrow(decodeLeafProof(bytes(v.mmr_proof))),
        FEE_CAP,
      ),
    );
    const stateIn = stateBefore(
      v.block,
      Either.getOrThrow(decodeAuthoritySet(bytes(v.authority_set_before))),
      Either.getOrThrow(decodeAuthoritySet(bytes(v.next_authority_set_before))),
    );
    const stateOut = nextBridgeState(stateIn, update);
    expect(stateOut.current_committee).toEqual(stateIn.next_committee);
    await asFunded(async (emulator, blaze) => {
      const inputs = seed(emulator, stateIn, true);
      const utxo = poolUtxo(20_000_000n);
      emulator.addUtxo(utxo);
      await emulator.expectValidTransaction(
        blaze,
        buildBridgeUpdateTx(
          blaze,
          inputs,
          update,
          stateOut,
          Option.some({ poolUtxos: [utxo], debit: 650_000n }),
          NetworkId.Testnet,
        ),
      );
    });
  });

  test("every seat of three keys signs; the update keeps a minimal cover the logic accepts", async () => {
    const block = 9;
    const committee = committeeOf(4n, [1n, 2n, 3n], [1, 2, 1]);
    const next = renumbered(committee, 5n);
    const leaf = {
      parentNumber: block - 1,
      parentHash: parentHash(block),
      nextAuthoritySet: next.commitment,
    };
    const mmr = new Mmr([
      ...Array.from({ length: block - 1 }, (_, i) => dummyLeafHash(i)),
      keccak(encodeLeaf(leaf)),
    ]);
    const message = keccak(encodeCommitment(mmr.root(), block, 4n));
    // One slot per seat, in reverse key order.
    const seats = committee.members
      .flatMap((m) => Array.from({ length: m.seats }, () => m.kp))
      .reverse();
    const { update, signers } = Either.getOrThrow(
      updateFromJustification(
        block,
        {
          payload: [{ id: "mh", data: mmr.root() }],
          blockNumber: block,
          validatorSetId: 4n,
          signatures: seats.map((kp) =>
            concatBytes(sign(kp, message), new Uint8Array([1])),
          ),
        },
        { keys: seats.map((kp) => kp.public), id: 4n },
        {
          version: 0,
          parentNumber: leaf.parentNumber,
          parentHash: leaf.parentHash,
          nextAuthoritySet: toCommitment(next.commitment),
          extra: new Uint8Array(),
        },
        {
          leafIndices: [BigInt(block - 1)],
          leafCount: BigInt(block),
          items: mmr.proof(block - 1),
        },
        FEE_CAP,
      ),
    );
    expect(signers).toBe(2);
    const stateIn = stateBefore(
      block,
      toCommitment(committee.commitment),
      toCommitment(next.commitment),
    );
    await asFunded(async (emulator, blaze) => {
      await emulator.expectValidTransaction(
        blaze,
        buildBridgeUpdateTx(
          blaze,
          seed(emulator, stateIn, false),
          update,
          nextBridgeState(stateIn, update),
          Option.none(),
          NetworkId.Testnet,
        ),
      );
    });
  });
});
