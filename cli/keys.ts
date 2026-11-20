/**
 * The Keys service: each governance group's private keys and the deployer
 * signing key, read from the environment when asked and checked. Only
 * signing.ts and main.ts import this module.
 */
import {
  Ed25519PrivateExtendedKeyHex,
  Ed25519PrivateNormalKeyHex,
} from "@blaze-cardano/core";
import { Array as Arr, Context, Effect, Layer, Redacted, Result } from "effect";
import { envError, requiredSecret } from "./config";
import type { ConfigError } from "./errors";

/** An Ed25519 private key: 64 hex characters, or 128 for a BIP32-Ed25519 extended key (kL ‖ kR) a wallet derives from its recovery phrase. */
export type PrivateKey =
  | Ed25519PrivateNormalKeyHex
  | Ed25519PrivateExtendedKeyHex;

const HEX = /^[0-9a-fA-F]+$/;

/** One private key; the reason for a bad one never quotes the key. */
const parsePrivateKey = (text: string): Result.Result<PrivateKey, string> =>
  !HEX.test(text)
    ? Result.fail("a private key must be hex")
    : text.length === 64
      ? Result.succeed(Ed25519PrivateNormalKeyHex(text))
      : text.length === 128
        ? Result.succeed(Ed25519PrivateExtendedKeyHex(text))
        : Result.fail(
            `a private key must be 64 or 128 hex characters, not ${text.length}`,
          );

/** The governance key groups and their private-key variables. */
const KEY_GROUPS = {
  techAuth: "TECH_AUTH_PRIVATE_KEYS",
  council: "COUNCIL_PRIVATE_KEYS",
} as const;

/** A governance key group. */
export type KeyGroup = keyof typeof KEY_GROUPS;

/** The private keys the signing code reads. */
export class Keys extends Context.Service<
  Keys,
  {
    /** The comma-separated private keys of a governance group, blanks dropped; at least one, each checked. */
    readonly privateKeys: (
      group: KeyGroup,
    ) => Effect.Effect<Arr.NonEmptyReadonlyArray<PrivateKey>, ConfigError>;
    /** The deployer signing key in the variable --signing-key names, trimmed and checked. */
    readonly signingKey: (
      variable: string,
    ) => Effect.Effect<PrivateKey, ConfigError>;
  }
>()("cli/Keys") {
  static readonly layer = Layer.succeed(this)({
    privateKeys: (group) =>
      Effect.flatMap(requiredSecret(KEY_GROUPS[group]), (secret) => {
        const keys = Result.all(
          Redacted.value(secret)
            .split(",")
            .map((key) => key.trim())
            .filter((key) => key.length > 0)
            .map(parsePrivateKey),
        );
        return Effect.mapError(
          Effect.fromResult(
            Result.flatMap(keys, (parsed) =>
              Arr.isReadonlyArrayNonEmpty(parsed)
                ? Result.succeed(parsed)
                : Result.fail("resolved to zero keys"),
            ),
          ),
          (reason) => envError(KEY_GROUPS[group], reason),
        );
      }),
    signingKey: (variable) =>
      Effect.flatMap(requiredSecret(variable), (secret) =>
        Effect.mapError(
          Effect.fromResult(parsePrivateKey(Redacted.value(secret).trim())),
          (reason) => envError(variable, reason),
        ),
      ),
  });
}
