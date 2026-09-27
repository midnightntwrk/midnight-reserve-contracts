/**
 * SCALE: the little-endian `u32` of the authority leaf, and decoders for the
 * BEEFY bytes a Midnight node returns over RPC (`sp-consensus-beefy`,
 * `pallet-mmr`, `pallet-beefy-mmr`). Each decoder consumes its input exactly;
 * a short, long or malformed input is a Left with the reason.
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import { Either } from "effect";
import type { AuthoritySetCommitment } from "../../contract_blueprint";

export function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

/** A read position over bytes; a read past the end or a compact over 2^30 marks it failed. */
class Cursor {
  private offset = 0;
  private failed = false;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  }

  private at(n: number): number | undefined {
    if (this.failed || this.offset + n > this.bytes.length) {
      this.failed = true;
      return undefined;
    }
    const at = this.offset;
    this.offset += n;
    return at;
  }

  take(n: number): Uint8Array {
    const at = this.at(n);
    return at === undefined ? new Uint8Array(n) : this.bytes.slice(at, at + n);
  }

  u8(): number {
    const at = this.at(1);
    return at === undefined ? 0 : this.view.getUint8(at);
  }

  u32(): number {
    const at = this.at(4);
    return at === undefined ? 0 : this.view.getUint32(at, true);
  }

  u64(): bigint {
    const at = this.at(8);
    return at === undefined ? 0n : this.view.getBigUint64(at, true);
  }

  compact(): number {
    const first = this.bytes[this.offset] ?? 0;
    switch (first & 3) {
      case 0:
        return this.u8() >> 2;
      case 1: {
        const at = this.at(2);
        return at === undefined ? 0 : this.view.getUint16(at, true) >> 2;
      }
      case 2:
        return this.u32() >>> 2;
      default:
        this.failed = true;
        return 0;
    }
  }

  vec<A>(item: () => A): A[] {
    return Array.from({ length: this.compact() }, item);
  }

  bytesVec(): Uint8Array {
    return this.take(this.compact());
  }

  /** The value when every read succeeded and the input is consumed; else Left naming `what`. */
  end<A>(what: string, value: A): Either.Either<A, string> {
    return this.failed || this.offset !== this.bytes.length
      ? Either.left(
          `${what}: ${this.failed ? "input too short" : `${this.bytes.length - this.offset} bytes left over`}`,
        )
      : Either.right(value);
  }
}

/** `BeefyAuthoritySet { id: u64, len: u32, keyset_commitment: H256 }` from its cursor. */
const authoritySet = (c: Cursor): AuthoritySetCommitment => ({
  validator_set_id: c.u64(),
  seat_count: BigInt(c.u32()),
  keyset_commitment: bytesToHex(c.take(32)),
});

/** `BeefyMmrApi_authority_set_proof` / `_next_authority_set_proof`: a committee commitment. */
export const decodeAuthoritySet = (
  bytes: Uint8Array,
): Either.Either<AuthoritySetCommitment, string> => {
  const c = new Cursor(bytes);
  return c.end("authority set", authoritySet(c));
};

/** A BEEFY validator set: the keys in seat order (a key once per seat) under its id. */
export interface ValidatorSet {
  readonly keys: readonly Uint8Array[];
  readonly id: bigint;
}

/** `BeefyApi_validator_set`: `Option<ValidatorSet { validators: Vec<[u8; 33]>, id: u64 }>`; None is a Left. */
export const decodeValidatorSet = (
  bytes: Uint8Array,
): Either.Either<ValidatorSet, string> => {
  const c = new Cursor(bytes);
  if (c.u8() !== 1) return Either.left("no BEEFY validator set");
  const keys = c.vec(() => c.take(33));
  return c.end("validator set", { keys, id: c.u64() });
};

const BEEF = "BEEF";
const CONSENSUS_DIGEST = 4;
const MMR_ROOT_LOG = 3;

/** The `ConsensusLog::MmrRoot` in a header's digest logs (engine `BEEF`); Left when there is none. */
export const mmrRootOfDigest = (
  logs: readonly Uint8Array[],
): Either.Either<Uint8Array, string> => {
  for (const log of logs) {
    const c = new Cursor(log);
    const kind = c.u8();
    const engine = new TextDecoder().decode(c.take(4));
    const data = c.bytesVec();
    if (
      kind === CONSENSUS_DIGEST &&
      engine === BEEF &&
      data[0] === MMR_ROOT_LOG &&
      data.length === 33
    )
      return Either.right(data.slice(1));
  }
  return Either.left("no BEEFY MMR root in the digest");
};

/** A signed BEEFY commitment: its payload entries, block, set, and one signature slot per seat (undefined where the seat did not sign). */
export interface FinalityProof {
  readonly payload: readonly {
    readonly id: string;
    readonly data: Uint8Array;
  }[];
  readonly blockNumber: number;
  readonly validatorSetId: bigint;
  readonly signatures: readonly (Uint8Array | undefined)[];
}

/** `VersionedFinalityProof::V1(SignedCommitment)` in its compact form: commitment, the MSB-first `signatures_from` bitfield, `validator_set_len`, the 65-byte signatures present. */
export const decodeFinalityProof = (
  bytes: Uint8Array,
): Either.Either<FinalityProof, string> => {
  const c = new Cursor(bytes);
  const version = c.u8();
  if (version !== 1)
    return Either.left(`finality proof version ${version}, expected 1`);
  const payload = c.vec(() => ({
    id: new TextDecoder().decode(c.take(2)),
    data: c.bytesVec(),
  }));
  const blockNumber = c.u32();
  const validatorSetId = c.u64();
  const from = c.bytesVec();
  const seats = c.u32();
  const present = c.vec(() => c.take(65));
  const signed = Array.from(
    { length: seats },
    (_, i) => ((from[i >> 3] ?? 0) >> (7 - (i & 7))) & 1,
  );
  const count = signed.reduce((n: number, bit) => n + bit, 0);
  if (count !== present.length)
    return Either.left(
      `the bitfield marks ${count} signers, ${present.length} signatures follow`,
    );
  let next = 0;
  const signatures = signed.map((bit) =>
    bit === 1 ? present[next++] : undefined,
  );
  return c.end("finality proof", {
    payload,
    blockNumber,
    validatorSetId,
    signatures,
  });
};

/** A `pallet-mmr` `LeafProof`: the proven leaf indices, the leaf count and the items. */
export interface LeafProof {
  readonly leafIndices: readonly bigint[];
  readonly leafCount: bigint;
  readonly items: readonly Uint8Array[];
}

/** `mmr_generateProof`'s `proof`: `LeafProof { leaf_indices: Vec<u64>, leaf_count: u64, items: Vec<H256> }`. */
export const decodeLeafProof = (
  bytes: Uint8Array,
): Either.Either<LeafProof, string> => {
  const c = new Cursor(bytes);
  const leafIndices = c.vec(() => c.u64());
  const leafCount = c.u64();
  return c.end("leaf proof", {
    leafIndices,
    leafCount,
    items: c.vec(() => c.take(32)),
  });
};

/** The `pallet-beefy-mmr` leaf: version, parent, the next authority set and `extra`. */
export interface MmrLeaf {
  readonly version: number;
  readonly parentNumber: number;
  readonly parentHash: Uint8Array;
  readonly nextAuthoritySet: AuthoritySetCommitment;
  readonly extra: Uint8Array;
}

/** `mmr_generateProof`'s `leaves` holding one leaf: `Vec<EncodableOpaqueLeaf>` of one `MmrLeaf`. */
export const decodeSingleLeaf = (
  bytes: Uint8Array,
): Either.Either<MmrLeaf, string> => {
  const outer = new Cursor(bytes);
  const leaves = outer.vec(() => outer.bytesVec());
  if (leaves.length !== 1)
    return Either.left(`${leaves.length} leaves, expected 1`);
  const c = new Cursor(leaves[0]);
  const leaf: MmrLeaf = {
    version: c.u8(),
    parentNumber: c.u32(),
    parentHash: c.take(32),
    nextAuthoritySet: authoritySet(c),
    extra: c.bytesVec(),
  };
  return Either.flatMap(outer.end("leaves", leaf), (value) =>
    c.end("leaf", value),
  );
};
