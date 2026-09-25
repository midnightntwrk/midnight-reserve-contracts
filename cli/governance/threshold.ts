/**
 * The threshold rule of validators/thresholds.ak (0 <= numerator < denominator),
 * checked once where a threshold is read, and the signer counts a threshold
 * demands of the tech-auth and council groups, as the on-chain native script
 * computes them.
 */
import { Either } from "effect";
import type { Signers } from "../datum/signers";
import type { MultisigThreshold } from "../../contract_blueprint";

/** A threshold fraction as the threshold validator accepts it: 0 <= numerator < denominator. */
export interface Threshold {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** A fraction by the validators/thresholds.ak rule 0 <= numerator < denominator; the left is the reason. */
const threshold = (
  numerator: bigint,
  denominator: bigint,
): Either.Either<Threshold, string> =>
  denominator <= 0n
    ? Either.left("denominator must be greater than zero")
    : numerator < 0n
      ? Either.left("numerator must be non-negative")
      : numerator >= denominator
        ? Either.left("numerator must be less than denominator")
        : Either.right({ numerator, denominator });

const INTEGER = /^-?[0-9]+$/;

/** Parse "numerator/denominator" by the on-chain rule; the left is the reason. */
export const parseThreshold = (
  text: string,
): Either.Either<Threshold, string> => {
  const parts = text.split("/").map((part) => part.trim());
  const [numeratorText = "", denominatorText = ""] = parts;
  if (
    parts.length !== 2 ||
    !INTEGER.test(numeratorText) ||
    !INTEGER.test(denominatorText)
  ) {
    return Either.left("expected 'numerator/denominator' (e.g. '2/3')");
  }
  return threshold(BigInt(numeratorText), BigInt(denominatorText));
};

/** The tech-auth and council fractions of a threshold datum, each checked by the on-chain rule. */
export interface AuthorityThreshold {
  readonly techAuth: Threshold;
  readonly council: Threshold;
}

/** The fractions of a [tech_num, tech_denom, council_num, council_denom] datum; the left is the reason. */
export const authorityThreshold = ([
  techAuthNum,
  techAuthDenom,
  councilNum,
  councilDenom,
]: MultisigThreshold): Either.Either<AuthorityThreshold, string> => {
  const checked = (numerator: bigint, denominator: bigint) =>
    Either.mapLeft(
      threshold(numerator, denominator),
      (reason) => `invalid threshold ${numerator}/${denominator}: ${reason}`,
    );
  return Either.all({
    techAuth: checked(techAuthNum, techAuthDenom),
    council: checked(councilNum, councilDenom),
  });
};

/** The signer count a fraction requires of `total`: ceil(total * numerator / denominator), as the on-chain native script computes it. */
export const requiredSigners = (
  total: number,
  { numerator, denominator }: Threshold,
): number =>
  Number((BigInt(total) * numerator + (denominator - 1n)) / denominator);

/** How many of a group's signers a threshold demands. */
export interface WitnessRequirement {
  readonly required: number;
  readonly total: number;
}

/** What a threshold demands of each authority. */
export interface WitnessRequirements {
  readonly techAuth: WitnessRequirement;
  readonly council: WitnessRequirement;
}

/** What the threshold demands of the tech-auth and council signers. */
export const witnessRequirements = (
  { techAuth, council }: AuthorityThreshold,
  signers: {
    readonly techAuthSigners: Signers;
    readonly councilSigners: Signers;
  },
): WitnessRequirements => ({
  techAuth: {
    required: requiredSigners(signers.techAuthSigners.length, techAuth),
    total: signers.techAuthSigners.length,
  },
  council: {
    required: requiredSigners(signers.councilSigners.length, council),
    total: signers.councilSigners.length,
  },
});
