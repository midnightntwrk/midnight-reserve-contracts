import { describe, expect, test } from "bun:test";
import {
  Bip32PrivateKey,
  Ed25519PrivateExtendedKeyHex,
  Ed25519Signature,
  HexBlob,
  initCrypto,
  mnemonicToEntropy,
  wordlist,
} from "@blaze-cardano/core";
import { Array as Arr, Either, Redacted } from "effect";
import { signTransaction } from "../cli/chain/transaction";
import {
  decodeSigners,
  encodeMultisigState,
  encodeRedeemerMap,
  parsePrivateKeys,
  parseSigners,
  type Signer,
} from "../cli/datum/signers";
import { leftOf } from "./helpers/effect";

const SOURCE = "TEST_SIGNERS";
const HASH_A = "a".repeat(56);
const HASH_B = "b".repeat(56);
const KEY_A = "1".repeat(64);
const KEY_B = "2".repeat(64);

describe("parseSigners", () => {
  test("trims entries and keeps duplicate hashes", () => {
    expect(
      Either.getOrThrow(
        parseSigners(
          SOURCE,
          ` ${HASH_A} : ${KEY_A} , ${HASH_B}:${KEY_B}, ${HASH_A}:${KEY_B} `,
        ),
      ),
    ).toEqual([
      { paymentHash: HASH_A, sr25519Key: KEY_A },
      { paymentHash: HASH_B, sr25519Key: KEY_B },
      { paymentHash: HASH_A, sr25519Key: KEY_B },
    ]);
  });

  test("lower-cases the hex", () => {
    expect(
      Either.getOrThrow(
        parseSigners(SOURCE, `${HASH_A.toUpperCase()}:${KEY_A.toUpperCase()}`),
      ),
    ).toEqual([{ paymentHash: HASH_A, sr25519Key: KEY_A }]);
  });

  test.each([
    ["no delimiter", HASH_A, "must contain exactly one ':' delimiter"],
    [
      "extra colon delimiter",
      `${HASH_A}:${KEY_A}:abcd`,
      "must contain exactly one ':' delimiter",
    ],
    [
      "missing sr25519 key",
      `${HASH_A}:`,
      "must include non-empty payment hash and sr25519 key",
    ],
    ["short payment hash", `abcd:${KEY_A}`, "must be 56 hex characters"],
    ["non-hex key", `${HASH_A}:zz`, "must be valid hex"],
    ["a trailing comma", `${HASH_A}:${KEY_A},`, "position 2 is empty"],
    [
      "an empty middle entry",
      `${HASH_A}:${KEY_A},,${HASH_B}:${KEY_B}`,
      "position 2 is empty",
    ],
    ["only blank entries", " , ,", "position 1 is empty"],
    ["unset", undefined, "required"],
  ])("rejects %s", (_name, value, issue) => {
    const error = leftOf(parseSigners(SOURCE, value));
    expect(error.source).toBe(SOURCE);
    expect(error.issues.join("\n")).toContain(issue);
  });
});

const signers = (count: number) =>
  Arr.makeBy(count, (i): Signer => ({
    paymentHash: i.toString(16).padStart(56, "0"),
    sr25519Key: (i + 0x1000).toString(16).padStart(64, "0"),
  }));

test.each([
  [23, "b7"],
  [24, "b818"],
])("%d signers round-trip through a map with header %s", (count, header) => {
  const all = signers(count);
  const datum = Either.getOrThrow(encodeMultisigState(all));
  const map = datum.asList()!.get(0).asList()!.get(1).toCbor();
  expect(map.slice(0, header.length)).toBe(header);
  expect(decodeSigners(datum)).toEqual(Either.right(all));
});

test("a 25-signer redeemer map has the one-byte length header b819", () => {
  expect(
    Either.map(encodeRedeemerMap(signers(25)), (map) =>
      map.toCbor().slice(0, 4),
    ),
  ).toEqual(Either.right("b819"));
});

describe("parsePrivateKeys", () => {
  const parse = (text: string) => parsePrivateKeys(Redacted.make(text));

  test("keeps each 64-hex key, blanks and spaces dropped", () => {
    expect(parse(` ${KEY_A}, ,${KEY_B.toUpperCase()} `)).toEqual(
      Either.right([KEY_A, KEY_B.toUpperCase()]),
    );
  });

  test.each([
    [
      "a short key",
      `${KEY_A},abcd`,
      "a private key must be 64 or 128 hex characters, not 4",
    ],
    ["a non-hex key", "z".repeat(64), "a private key must be hex"],
    ["no key", " , ", "resolved to zero keys"],
  ])("refuses %s", (_name, text, reason) => {
    expect(parse(text)).toEqual(Either.left(reason));
  });
});

describe("signTransaction with a wallet key", () => {
  const PHRASE = `${"abandon ".repeat(23)}art`;
  const hard = (index: number) => index + 0x80000000;

  test("a stake key derived from a recovery phrase signs as the wallet's public key", async () => {
    await initCrypto();
    const account = Bip32PrivateKey.fromBip39Entropy(
      Buffer.from(mnemonicToEntropy(PHRASE, wordlist)),
      "",
    ).derive([hard(1852), hard(1815), hard(0)]);
    const stake = account.derive([2, 0]).toRawKey();
    const expected = account.toPublic().derive([2, 0]).toRawKey();
    const txId = "ab".repeat(32);
    const [[publicKey, signature]] = signTransaction(txId, [
      Ed25519PrivateExtendedKeyHex(stake.hex()),
    ]);
    expect(publicKey).toBe(expected.hex());
    expect(
      expected.verify(Ed25519Signature.fromHex(signature), HexBlob(txId)),
    ).toBe(true);
  });
});
