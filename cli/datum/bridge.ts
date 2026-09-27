/**
 * The committee bridge's deploy values: the bootstrap BeefyConsensusState
 * from its four .env values, checked by the rules the forever mint runs
 * (`validators/committee_bridge.ak`), and the fee cap of the BEEFY
 * threshold.
 */
import { Either } from "effect";
import type {
  AuthoritySetCommitment,
  BeefyConsensusState,
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

/** The fee cap of the BEEFY threshold: `base + per_signer × signers`, in lovelace. */
export interface BridgeMaxFee {
  readonly base: bigint;
  readonly perSigner: bigint;
}
