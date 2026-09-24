/** secp256k1 keys from fixed scalars and low-S signatures over a 32-byte hash. */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hexToBytes } from "@noble/hashes/utils.js";

export type Keypair = { secret: Uint8Array; public: Uint8Array };

export function keypair(scalar: bigint): Keypair {
  const secret = hexToBytes(scalar.toString(16).padStart(64, "0"));
  return { secret, public: secp256k1.getPublicKey(secret, true) };
}

/** 64-byte `r ‖ s`, low-S, over an already hashed message. */
export function sign(kp: Keypair, msgHash: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(msgHash, kp.secret, {
    prehash: false,
    lowS: true,
  });
  if (!secp256k1.verify(sig, msgHash, kp.public, { prehash: false }))
    throw new Error("signature does not verify");
  return sig;
}

export const byKey = (a: Keypair, b: Keypair): number =>
  Buffer.compare(Buffer.from(a.public), Buffer.from(b.public));
