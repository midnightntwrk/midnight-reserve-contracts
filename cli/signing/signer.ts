/**
 * Signing: public keys, signatures of a transaction id, witness merging, the
 * signer a command resolves from --sign, and the witness count a transaction
 * carries at submit. signAndWrite is the one Effect.
 */
import {
  CborSet,
  derivePublicKey,
  Ed25519PrivateKey,
  Ed25519PublicKeyHex,
  Ed25519SignatureHex,
  HexBlob,
  signMessage,
  Transaction,
  TxCBOR,
  VkeyWitness,
} from "@blaze-cardano/core";
import { Effect } from "effect";
import type { PrivateKey } from "../datum/signers";
import { writeTransaction } from "./tx-file";
import { Output } from "../output";
import { type KeyGroup, Keys } from "../config/keys";
import type { ConfigError, FileWriteError } from "../errors";

/** The public key of a private key. Blaze's helpers take a key as a seed, so an extended key, whose first half is already the scalar, goes through the SDK. */
export const publicKeyOf = (key: PrivateKey): Ed25519PublicKeyHex =>
  key.length === 128
    ? Ed25519PrivateKey.fromExtendedHex(key).toPublic().hex()
    : derivePublicKey(key);

/** A public key and its signature of a transaction id. */
export type KeySignature = [Ed25519PublicKeyHex, Ed25519SignatureHex];

/** Each key's public key and signature of the transaction id. */
export const signTransaction = (
  txId: string,
  privateKeys: readonly PrivateKey[],
): KeySignature[] =>
  privateKeys.map((key) => [
    publicKeyOf(key),
    key.length === 128
      ? Ed25519PrivateKey.fromExtendedHex(key).sign(HexBlob(txId)).hex()
      : signMessage(HexBlob(txId), key),
  ]);

/** A copy of the transaction with the signatures merged into its vkey witnesses; a key it has takes the new signature. */
export const attachWitnesses = (
  txCbor: string,
  signatures: readonly KeySignature[],
): Transaction => {
  const tx = Transaction.fromCbor(TxCBOR(HexBlob(txCbor)));
  const witnessSet = tx.witnessSet();
  const merged = new Map([
    ...(witnessSet.vkeys()?.values() ?? []).map((v): KeySignature => [
      v.vkey(),
      v.signature(),
    ]),
    ...signatures,
  ]);
  witnessSet.setVkeys(CborSet.fromCore([...merged], VkeyWitness.fromCore));
  tx.setWitnessSet(witnessSet);
  return tx;
};

const KEY_GROUP_LABELS: Record<KeyGroup, string> = {
  techAuth: "tech auth",
  council: "council",
};

/** Who signs a governance transaction: both authorities, or the tech authority alone. */
type Signing = "both" | "tech-auth";

const SIGNING_GROUPS: Record<Signing, readonly KeyGroup[]> = {
  both: ["techAuth", "council"],
  "tech-auth": ["techAuth"],
};

/** The keys of each group that signs a transaction, or no signing. */
export type Signer =
  | { readonly _tag: "Unsigned" }
  | {
      readonly _tag: "Signed";
      readonly groups: readonly {
        readonly group: KeyGroup;
        readonly keys: readonly PrivateKey[];
      }[];
    };

/** A transaction written without witnesses. */
export const UNSIGNED: Signer = { _tag: "Unsigned" };

/** The signer for `--sign`: every key of `signing`'s groups, resolved at once so a missing key fails before any chain access. */
export const signerFor = (
  sign: boolean,
  signing: Signing,
): Effect.Effect<Signer, ConfigError, Keys> =>
  sign
    ? Effect.flatMap(Keys, (keys) =>
        Effect.map(
          Effect.forEach(SIGNING_GROUPS[signing], (group) =>
            Effect.map(keys.privateKeys(group), (keys) => ({
              group,
              keys,
            })),
          ),
          (groups): Signer => ({ _tag: "Signed", groups }),
        ),
      )
    : Effect.succeed(UNSIGNED);

/** A transaction only the deployer signs, at sign-and-submit. */
export const DEPLOYER_ONLY = 1;

/** The vkey witnesses a transaction carries at submit: every key of a Signed signer or, for an unsigned file, the `required` signatures its multisig witnesses need; and the deployer's, which sign-and-submit adds. */
export const witnessCount = (signer: Signer, required: number): number =>
  DEPLOYER_ONLY +
  (signer._tag === "Signed"
    ? signer.groups.reduce((n, { keys }) => n + keys.length, 0)
    : required);

/** Write a transaction file with a witness from every key of `signer`. */
export const signAndWrite = (
  tx: Transaction,
  outputPath: string,
  signer: Signer,
  description: string,
): Effect.Effect<void, FileWriteError, Output> =>
  Effect.gen(function* () {
    const output = yield* Output;
    const txId = tx.getId();
    const signatures: KeySignature[] = [];
    if (signer._tag === "Signed") {
      for (const { group, keys } of signer.groups) {
        yield* output.log(
          `\nSigning with ${keys.length} ${KEY_GROUP_LABELS[group]} private keys...`,
        );
        const created = signTransaction(txId, keys);
        signatures.push(...created);
        yield* output.log(`  Created ${created.length} signatures`);
      }
    }
    const signed = signer._tag === "Signed";
    yield* writeTransaction(
      outputPath,
      (signed ? attachWitnesses(tx.toCbor(), signatures) : tx).toCbor(),
      txId,
      signed,
      description,
    );
    yield* output.log(`\nTransaction ID: ${txId}`);
  });
