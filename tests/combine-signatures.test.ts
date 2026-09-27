/** combine-signatures' functions: each accepted witness form parses and verifies against the transaction id; malformed or unverified witnesses and conflicting signers are refused. */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  CborSet,
  type Ed25519PublicKeyHex,
  type Ed25519SignatureHex,
  TransactionId,
  TransactionWitnessSet,
  VkeyWitness,
} from "@blaze-cardano/core";
import { Either, Layer } from "effect";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToNumberLE } from "@noble/curves/utils.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { readTransactionFile } from "../cli/chain/tx-file";
import {
  mergeWitnesses,
  readSingleTransaction,
  readWitnessFile,
} from "../cli/chain/combine-signatures";
import { signTransaction } from "../cli/chain/transaction";
import {
  captureOutput,
  expectFailure,
  OutputCaptured,
  PlatformLive,
  runTest,
  testEnv,
} from "./helpers/effect";
import { PREVIEW_DEPLOYMENT_TX } from "./helpers/fixtures";

const TX_ID = TransactionId(PREVIEW_DEPLOYMENT_TX);
const layer = Layer.merge(PlatformLive, OutputCaptured(captureOutput()));
const dir = mkdtempSync(join(tmpdir(), "combine-signatures-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Write a witness file; the name keeps the tests' files apart. */
const witnessFile = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

const envelope = (description: string, cborHex: string) =>
  JSON.stringify({ type: "TxWitness ConwayEra", description, cborHex });

const untagged = (vkey: string, sig: string) =>
  envelope("Key Witness ShelleyEra", `825820${vkey}5840${sig}`);

/** The deployer's signature of the transaction id, as signTransaction makes it. */
const deployer = signTransaction(TX_ID, [testEnv("SIGNING_PRIVATE_KEY")])[0]!;

/** A valid Ed25519 signature with a nonce other than RFC 8032's, so not the one signTransaction makes. */
const otherSignature = (secretKey: string, message: string) => {
  const { Fn } = ed25519.Point;
  const { scalar, pointBytes } = ed25519.utils.getExtendedPublicKey(
    hexToBytes(secretKey.slice(0, 64)),
  );
  const r = Fn.create(0x5eedn);
  const R = ed25519.Point.BASE.multiply(r).toBytes();
  const k = Fn.create(
    bytesToNumberLE(sha512(concatBytes(R, pointBytes, hexToBytes(message)))),
  );
  return bytesToHex(
    concatBytes(R, Fn.toBytes(Fn.create(r + k * scalar))),
  ) as Ed25519SignatureHex;
};

/** The refusals a witness file can meet, by the start of its issue. */
const CLI_SHAPE = "Failed to parse cardano-cli witness";
const WITNESS_SET = "Invalid CBOR witness set";
const UNVERIFIED = "The signature by ";

const refused = async (path: string, issue: string) => {
  const error = await expectFailure(
    layer,
    readWitnessFile(path, TX_ID),
    "InputParseError",
  );
  expect(error.source).toBe(path);
  expect(error.issues).toHaveLength(1);
  expect(error.issues[0]).toStartWith(issue);
};

describe("readWitnessFile", () => {
  test.each([
    [
      "a tagged cardano-cli key witness",
      (vkey: Ed25519PublicKeyHex, sig: Ed25519SignatureHex) =>
        envelope("", `8200825820${vkey}5840${sig}`),
    ],
    ["an untagged cardano-cli key witness (cardano-cli 10.14)", untagged],
    [
      "a CIP-30 witness set",
      (vkey: Ed25519PublicKeyHex, sig: Ed25519SignatureHex) => {
        const set = new TransactionWitnessSet();
        set.setVkeys(CborSet.fromCore([[vkey, sig]], VkeyWitness.fromCore));
        return set.toCbor();
      },
    ],
  ])("reads the deployer's signature from %s", async (_form, encode) => {
    const path = witnessFile("deployer.witness", encode(...deployer));
    expect(await runTest(layer, readWitnessFile(path, TX_ID))).toEqual([
      deployer,
    ]);
  });

  test.each([
    ["another tag", (w: string) => `8201${w}`],
    ["a 63-byte signature", (w: string) => w.slice(0, -2)],
    ["a trailing byte", (w: string) => `${w}00`],
  ])("refuses a cardano-cli witness with %s", (_shape, reshape) =>
    refused(
      witnessFile(
        "malformed.witness",
        envelope("", reshape(`825820${deployer[0]}5840${deployer[1]}`)),
      ),
      CLI_SHAPE,
    ),
  );

  test("refuses a file that is neither an envelope nor witness-set CBOR", () =>
    refused(witnessFile("garbage.witness", "not a witness"), WITNESS_SET));

  test("refuses a witness set with a 31-byte vkey", () =>
    refused(
      witnessFile(
        "short-key.witness",
        `a100818258` + `1f${"11".repeat(31)}` + `5840${"22".repeat(64)}`,
      ),
      WITNESS_SET,
    ));

  test("refuses a small-order key, which only ZIP-215 verification accepts", () => {
    const identity = `01${"00".repeat(31)}`;
    return refused(
      witnessFile(
        "small-order.witness",
        untagged(identity, `${identity}${"00".repeat(32)}`),
      ),
      UNVERIFIED,
    );
  });

  test("refuses a committed witness, which signs another transaction", () =>
    refused("witnesses/witness-1.json", UNVERIFIED));
});

describe("mergeWitnesses", () => {
  test("a signature present twice is kept once", () => {
    const merged = Either.getOrThrow(
      mergeWitnesses(new Map([deployer]), [deployer]),
    );
    expect([...merged]).toEqual([deployer]);
  });

  test("the same key with another valid signature is refused", async () => {
    const [vkey] = deployer;
    const other = otherSignature(testEnv("SIGNING_PRIVATE_KEY"), TX_ID);
    expect(other).not.toBe(deployer[1]);
    const path = witnessFile("other.witness", untagged(vkey, other));
    const read = await runTest(layer, readWitnessFile(path, TX_ID));
    expect(read).toEqual([[vkey, other]]);
    expect(Either.isLeft(mergeWitnesses(new Map([deployer]), read))).toBe(true);
  });
});

describe("readSingleTransaction", () => {
  test("returns the transaction of a single-transaction file", async () => {
    const tx = await runTest(
      layer,
      readSingleTransaction("tests/golden/simple-tx/preview-simple-tx.json"),
    );
    expect(tx.description).toBe("Simple Transaction");
  });

  test("refuses a deployment file of several transactions", async () => {
    const path =
      "tests/golden/deploy/preview-bridge-deployment-transactions.json";
    expect(
      (await runTest(layer, readTransactionFile(path))).length,
    ).toBeGreaterThan(1);
    const error = await expectFailure(
      layer,
      readSingleTransaction(path),
      "InputParseError",
    );
    expect(error.source).toBe(path);
    expect(error.issues).toEqual([
      "combine-signatures only supports single-transaction files. " +
        "For multi-transaction deployments, use sign-and-submit instead.",
    ]);
  });
});
