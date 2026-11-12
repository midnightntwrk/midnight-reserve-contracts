/** Values a command installs that come from the environment: new signers, permissioned candidates and the first terms and conditions. Plain effects over the fiber's ConfigProvider, not a service. */
import { Effect, Either, Option } from "effect";
import {
  parseCandidates,
  type PermissionedCandidate,
} from "../datum/federated-ops";
import { parseSigners, type Signers } from "../datum/signers";
import type { ConfigError, InputParseError } from "../errors";
import { type Hash32, parseHash32, ZERO_HASH32 } from "../input";
import { envError, optionalString, requiredString } from "./env";

/** A variable holding the signers a change command installs. */
export type SignersVariable = "COUNCIL_SIGNERS" | "TECH_AUTH_SIGNERS";

/** The signers in COUNCIL_SIGNERS or TECH_AUTH_SIGNERS: the ones deploy installs, or a change command's new set. */
export const newSigners = (
  variable: SignersVariable,
): Effect.Effect<Signers, ConfigError | InputParseError> =>
  Effect.flatMap(requiredString(variable), (value) =>
    parseSigners(variable, value),
  );

/** PERMISSIONED_CANDIDATES, parsed. */
export const permissionedCandidates: Effect.Effect<
  PermissionedCandidate[],
  ConfigError | InputParseError
> = Effect.flatMap(requiredString("PERMISSIONED_CANDIDATES"), parseCandidates);

/** The first terms-and-conditions datum: TERMS_AND_CONDITIONS_INITIAL_HASH (zeros when unset) and the hex of TERMS_AND_CONDITIONS_INITIAL_LINK (empty when unset). */
export const initialTermsAndConditions: Effect.Effect<
  { readonly hash: Hash32; readonly link: string },
  ConfigError
> = Effect.all({
  hash: Effect.flatMap(
    optionalString("TERMS_AND_CONDITIONS_INITIAL_HASH"),
    Option.match({
      onNone: () => Effect.succeed(ZERO_HASH32),
      onSome: (text) =>
        Either.mapLeft(parseHash32(text), (reason) =>
          envError("TERMS_AND_CONDITIONS_INITIAL_HASH", reason),
        ),
    }),
  ),
  link: Effect.map(
    optionalString("TERMS_AND_CONDITIONS_INITIAL_LINK"),
    Option.match({
      onNone: () => "",
      onSome: (text) => Buffer.from(text).toString("hex"),
    }),
  ),
});
