/** The MIP §Test vectors as JSON-ready objects, one entry per file in `tests/vectors/bridge/`. */
import { serialize } from "@blaze-cardano/data";
import { hexToBytes } from "@noble/hashes/utils.js";
import {
  BeefyConsensusState,
  BridgeUpdate,
  type BeefyConsensusState as State,
} from "../../../contract_blueprint";
import { buildMultiproof, required } from "../../../cli/bridge/authority-set";
import { keccak } from "../../../cli/bridge/keccak";
import { committeeCommitment } from "./commitment";
import {
  committee,
  dummyLeafHash,
  keypairs,
  keysetRoot,
  leafNext,
  scenarioByName,
  scenarios,
  seats,
} from "./fixtures";
import { Mmr } from "./mmr";
import { toJson } from "./multiproof";
import { encodeCommitment, encodeLeaf, type MmrLeaf } from "./scale";
import { bridgeUpdate, hex, nextState, toCommitment } from "./update";

const MIP_PARENT_HASH = hexToBytes(
  "9b9462bf599ab609ea9917918e6b69b54b2bff8b7be6fc0de8984b55f5fbb057",
);

/** Bootstrap state: activation 1000, committee 4 (the fixture keys) current, 5 next. */
function bootstrapState(): State {
  return {
    latest_mmr_root: hex(
      keccak(new TextEncoder().encode("digest of block 999")),
    ),
    latest_height: 999n,
    beefy_activation_block: 1000n,
    current_committee: toCommitment({
      ...committee.commitment,
      validatorSetId: 4n,
    }),
    next_committee: toCommitment(leafNext(5n)),
  };
}

/** State the handover scenarios start from: the fixture keyset as committee 4 (current) and 5 (next), height 6. */
export function handoverState(): State {
  return {
    ...bootstrapState(),
    latest_height: 6n,
    beefy_activation_block: 1n,
    next_committee: toCommitment({
      ...committee.commitment,
      validatorSetId: 5n,
    }),
  };
}

const mmrVector = (count: number, index: number) => {
  const mmr = new Mmr(
    Array.from({ length: count }, (_, i) => dummyLeafHash(i)),
  );
  return {
    leaf_count: count,
    leaf_index: index,
    leaf_hash: hex(mmr.leafHashes[index]),
    peaks: mmr.peaks().map(hex),
    items: mmr.proof(index).map(hex),
    root: hex(mmr.root()),
  };
};

export function vectors(): Record<string, unknown> {
  const scenarioJson = (name: string) => {
    const s = scenarioByName(name);
    return {
      name,
      validator_set_id: Number(s.setId),
      block_number: s.blockNumber,
      leaf_next_id: Number(s.nextId),
      parent_hash: hex(s.parentHash),
      leaf_bytes: hex(encodeLeaf(s.leaf)),
      mmr_root: hex(s.mmrRoot),
      signed_bytes: hex(encodeCommitment(s.mmrRoot, s.blockNumber, s.setId)),
      msg_hash: hex(s.msgHash),
      mmr_proof: s.mmr.proof(s.blockNumber - 1).map(hex),
      signatures: s.sigs.map(hex),
    };
  };
  const permutation = [keypairs[1], keypairs[0], keypairs[1], keypairs[2]].map(
    (kp) => ({ key: kp.public, seats: 1 }),
  );
  const permuted = committeeCommitment(0n, permutation);
  const mipLeaf: MmrLeaf = {
    parentNumber: 600,
    parentHash: MIP_PARENT_HASH,
    nextAuthoritySet: {
      validatorSetId: 1n,
      seatCount: 4,
      keysetCommitment: keysetRoot,
    },
  };
  const signedBytes = encodeCommitment(new Uint8Array(32), 1, 0n);
  const handoverCase = (name: string, quorum: number[]) => {
    const s = scenarioByName(name);
    const state = handoverState();
    const next = nextState(state, s);
    const update = bridgeUpdate(s, [0, 1, 2], quorum);
    return {
      scenario: name,
      signed_by: Number(s.setId),
      leaf_next_id: Number(s.nextId),
      signers: quorum,
      expect: next ? "accepted" : "rejected",
      handover: next
        ? next.current_committee.validator_set_id !==
          state.current_committee.validator_set_id
        : null,
      update: {
        ...update,
        multiproof: toJson(
          buildMultiproof(committee.leaves, new Set([0, 1, 2])),
        ),
      },
      redeemer_cbor: serialize(BridgeUpdate, update).toCbor(),
      state_out: next,
    };
  };
  return {
    keys: {
      note: "secp256k1 keys from the scalars, sorted by compressed public key; k1 < k2 < k3",
      keys: keypairs.map((kp) => ({
        secret: hex(kp.secret),
        public: hex(kp.public),
      })),
    },
    commitment: {
      seats,
      leaves: committee.leaves.map(hex),
      leaf_hashes: committee.leaves.map((l) => hex(keccak(l))),
      seat_count: committee.commitment.seatCount,
      keyset_commitment: hex(keysetRoot),
      permutation: {
        members: permutation.map((m) => hex(m.key)),
        seat_count: permuted.commitment.seatCount,
        keyset_commitment: hex(permuted.commitment.keysetCommitment),
      },
    },
    "signed-bytes": {
      mmr_root: "00".repeat(32),
      block_number: 1,
      validator_set_id: 0,
      bytes: hex(signedBytes),
      hash: hex(keccak(signedBytes)),
    },
    leaf: {
      version: 0,
      parent_number: 600,
      parent_hash: hex(MIP_PARENT_HASH),
      next_authority_set: {
        validator_set_id: 1,
        seat_count: 4,
        keyset_commitment: hex(keysetRoot),
      },
      extra: "",
      bytes: hex(encodeLeaf(mipLeaf)),
      hash: hex(keccak(encodeLeaf(mipLeaf))),
    },
    quorum: {
      numerator: 2,
      denominator: 3,
      cases: [10, 6, 3, 1].map((n) => ({
        seat_count: n,
        required: required(n, 2, 3),
        accepted: required(n, 2, 3),
        rejected: n === 1 ? null : required(n, 2, 3) - 1,
      })),
    },
    height: { latest_height: 600, rejected: 600, accepted: 601 },
    "mmr-three-peaks": {
      note: "leaf 5 of 7 sits under the middle peak; items = P1, sibling, P3; root = H(H(P3 || P2) || P1)",
      ...mmrVector(7, 5),
    },
    "mmr-edges": [
      { note: "one leaf: no items, root = leaf hash", ...mmrVector(1, 0) },
      { note: "leaf is its own peak: left peaks only", ...mmrVector(5, 4) },
      { note: "leaf is its own peak: left peaks only", ...mmrVector(9, 8) },
    ],
    bootstrap: {
      note: "latest_height = activation - 1, next = current + 1; block 1000 accepted but unfunded",
      datum: bootstrapState(),
      datum_cbor: serialize(BeefyConsensusState, bootstrapState()).toCbor(),
    },
    handover: {
      state_in: handoverState(),
      cases: [
        handoverCase("a_no_handover", [0, 1]),
        handoverCase("b_handover", [0, 1]),
        handoverCase("c_next_signs_same", [0, 1]),
        handoverCase("d_skip_two", [0, 1]),
      ],
    },
    signatures: { scenarios: scenarios.map((s) => scenarioJson(s.name)) },
  };
}

/** JSON text with bigints as numbers, stable key order as inserted. */
export const toJsonText = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x), 2) +
  "\n";
