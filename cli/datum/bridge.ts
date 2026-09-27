/**
 * The committee bridge's datums: the bootstrap BeefyConsensusState from its
 * four .env values, checked by the rules the forever mint runs
 * (`validators/committee_bridge.ak`), the state an update moves it to, and
 * the fee cap of the BEEFY threshold.
 */
import { HexBlob, PlutusData } from "@blaze-cardano/core";
import { Either, ParseResult, Schema } from "effect";
import type {
  AuthoritySetCommitment,
  BeefyConsensusState,
  BridgeUpdate,
} from "../../contract_blueprint";
import { type Hash32, parseHash32 } from "../input";

const DECIMAL = /^[0-9]+$/;
const U32_MAX = 2n ** 32n - 1n;
const U64_MAX = 2n ** 64n - 1n;

/** A base-10 integer from `min` to `max`; Left is the reason. */
const integerIn =
  (min: bigint, max: bigint) =>
  (text: string): Either.Either<bigint, string> =>
    DECIMAL.test(text) && BigInt(text) >= min && BigInt(text) <= max
      ? Either.right(BigInt(text))
      : Either.left(`'${text}' is not a base-10 integer from ${min} to ${max}`);

/** The first block BEEFY finalises: a u32 from 1, since the state starts at the block before it. */
export const parseActivationBlock = integerIn(1n, U32_MAX);

/** A fee-cap amount in lovelace. */
export const parseLovelace = integerIn(0n, U64_MAX);

/** `<validator_set_id>:<seat_count>:<keyset_commitment>`: a u64 id, a u32 seat count above zero and a 32-byte keyset commitment. */
export const parseCommittee = (
  text: string,
): Either.Either<AuthoritySetCommitment, string> => {
  const fields = text.split(":").map((field) => field.trim());
  const [id = "", seats = "", keyset = ""] = fields;
  return fields.length !== 3
    ? Either.left(
        `'${text}' must be <validator_set_id>:<seat_count>:<keyset_commitment>`,
      )
    : Either.all({
        validator_set_id: integerIn(0n, U64_MAX)(id),
        seat_count: integerIn(1n, U32_MAX)(seats),
        keyset_commitment: parseHash32(keyset),
      });
};

/** A committee as parseCommittee reads it: `<validator_set_id>:<seat_count>:<keyset_commitment>`. */
export const committeeEnv = (committee: AuthoritySetCommitment): string =>
  `${committee.validator_set_id}:${committee.seat_count}:${committee.keyset_commitment}`;

/** A Midnight block number: a u32 from 1. */
export const parseBlockNumber = integerIn(1n, U32_MAX);

/** The four bootstrap values, each parsed. */
export interface BootstrapValues {
  readonly activationBlock: bigint;
  readonly mmrRoot: Hash32;
  readonly current: AuthoritySetCommitment;
  readonly next: AuthoritySetCommitment;
}

/** The state the forever mint accepts: the next committee's id follows the current one's, and latest_height is the block before activation. */
export const bootstrapState = (
  values: BootstrapValues,
): Either.Either<BeefyConsensusState, string> =>
  values.next.validator_set_id !== values.current.validator_set_id + 1n
    ? Either.left(
        `the next committee's id ${values.next.validator_set_id} must be the current committee's id ${values.current.validator_set_id} + 1`,
      )
    : Either.right({
        latest_mmr_root: values.mmrRoot,
        latest_height: values.activationBlock - 1n,
        beefy_activation_block: values.activationBlock,
        current_committee: values.current,
        next_committee: values.next,
      });

/** `bytes` bytes of lower-case hex. */
const hexBytes = (bytes: number) =>
  Schema.String.pipe(
    Schema.pattern(new RegExp(`^(?:[0-9a-f]{2}){${bytes}}$`), {
      message: () => `expected ${bytes} bytes of lower-case hex`,
    }),
  );

const natural = Schema.BigIntFromNumber.pipe(Schema.nonNegativeBigInt());

const PlutusDataSelf = Schema.declare(
  (value: unknown): value is PlutusData => value instanceof PlutusData,
);

/** A PlutusData from its CBOR hex. */
const PlutusDataFromCbor = Schema.transformOrFail(
  Schema.String,
  PlutusDataSelf,
  {
    strict: true,
    decode: (cbor, _, ast) =>
      Either.try({
        try: () => PlutusData.fromCbor(HexBlob(cbor)),
        catch: () =>
          new ParseResult.Type(ast, cbor, "expected the CBOR hex of a Data"),
      }),
    encode: (data) => ParseResult.succeed(data.toCbor()),
  },
);

/** The --update file: a BridgeUpdate with the blueprint's field names, integers as JSON numbers, byte strings as lower-case hex (a non-signer's signature empty) and the multiproof as the CBOR hex of its Data. */
export const BridgeUpdateJson = Schema.Struct({
  mmr_root: hexBytes(32),
  block_number: natural,
  validator_set_id: natural,
  signatures: Schema.mutable(
    Schema.Array(Schema.Union(hexBytes(64), Schema.Literal(""))),
  ),
  leaf: Schema.Struct({
    version: natural,
    parent_number: natural,
    parent_hash: hexBytes(32),
    next_authority_set: Schema.Struct({
      validator_set_id: natural,
      seat_count: natural,
      keyset_commitment: hexBytes(32),
    }),
    extra: Schema.Literal(""),
  }),
  mmr_proof: Schema.mutable(Schema.Array(hexBytes(32))),
  multiproof: PlutusDataFromCbor,
});

/** The state after `update` (spec §5): the signed root and height; a handover (the leaf names next + 1) makes the next committee current and the leaf's the next. */
export const nextBridgeState = (
  state: BeefyConsensusState,
  update: BridgeUpdate,
): BeefyConsensusState => {
  const named = update.leaf.next_authority_set;
  const handover =
    named.validator_set_id === state.next_committee.validator_set_id + 1n;
  return {
    ...state,
    latest_mmr_root: update.mmr_root,
    latest_height: update.block_number,
    current_committee: handover
      ? state.next_committee
      : state.current_committee,
    next_committee: handover ? named : state.next_committee,
  };
};

/** The fee cap of the BEEFY threshold: `base + per_signer × signers`, in lovelace. */
export interface BridgeMaxFee {
  readonly base: bigint;
  readonly perSigner: bigint;
}
