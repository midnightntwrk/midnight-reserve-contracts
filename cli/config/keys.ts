/** Private keys: each governance group's keys and the deployer signing key, read from the environment when asked and checked. */
import {
  type Array as Arr,
  Context,
  Effect,
  Either,
  Layer,
  Redacted,
} from "effect";
import {
  parsePrivateKey,
  parsePrivateKeys,
  type PrivateKey,
} from "../datum/signers";
import type { ConfigError } from "../errors";
import { envError, requiredSecret } from "./env";

/** The governance key groups and their private-key variables. */
const KEY_GROUPS = {
  techAuth: "TECH_AUTH_PRIVATE_KEYS",
  council: "COUNCIL_PRIVATE_KEYS",
} as const;

/** A governance key group. */
export type KeyGroup = keyof typeof KEY_GROUPS;

/** The private keys the signing code reads. */
export class Keys extends Context.Tag("cli/Keys")<
  Keys,
  {
    /** The private keys of a governance group; at least one, each checked. */
    readonly privateKeys: (
      group: KeyGroup,
    ) => Effect.Effect<Arr.NonEmptyReadonlyArray<PrivateKey>, ConfigError>;
    /** The deployer signing key in the variable --signing-key names, checked. */
    readonly signingKey: (
      variable: string,
    ) => Effect.Effect<PrivateKey, ConfigError>;
  }
>() {}

export const KeysLive = Layer.succeed(Keys, {
  privateKeys: (group) =>
    Effect.flatMap(requiredSecret(KEY_GROUPS[group]), (secret) =>
      Either.mapLeft(parsePrivateKeys(secret), (reason) =>
        envError(KEY_GROUPS[group], reason),
      ),
    ),
  signingKey: (variable) =>
    Effect.flatMap(requiredSecret(variable), (secret) =>
      Either.mapLeft(parsePrivateKey(Redacted.value(secret).trim()), (reason) =>
        envError(variable, reason),
      ),
    ),
});
