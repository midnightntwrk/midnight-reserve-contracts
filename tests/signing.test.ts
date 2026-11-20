/** Signing: witnesses verify against the transaction id, the transaction file round-trips in the reference's format, witness files are checked before submit, and sign-and-submit and combine-signatures submit to the emulator. */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  Address,
  addressFromCredential,
  Bip32PrivateKey,
  blake2b_256,
  CborSet,
  Credential,
  CredentialType,
  derivePublicKey,
  Ed25519PrivateExtendedKeyHex,
  Ed25519PrivateNormalKeyHex,
  Ed25519PublicKey,
  type Ed25519PublicKeyHex,
  Ed25519Signature,
  type Ed25519SignatureHex,
  HexBlob,
  mnemonicToEntropy,
  NetworkId,
  signMessage,
  SLOT_CONFIG_NETWORK,
  Transaction,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  TransactionWitnessSet,
  TxCBOR,
  Value,
  VkeyWitness,
  wordlist,
} from "@blaze-cardano/core";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option, Result } from "effect";
import { HttpClient } from "effect/http";
import { Provider } from "../cli/chain";
import { Keys } from "../cli/keys";
import {
  combineSignaturesProgram,
  mergeWitnesses,
  readTransactionFile,
  readWitnessFile,
  signAndSubmitProgram,
  signAndWrite,
  signerFor,
  signTransaction,
  writeTransaction,
} from "../cli/signing";
import { compile, type TxPlan } from "../cli/tx";
import { keyToAddress } from "../cli/wallet";
import { captureOutput } from "./helpers/output";

const tmp = mkdtempSync(join(tmpdir(), "signing-"));

const GOLDEN = "tests/golden/simple-tx/preview-simple-tx.json";
const goldenText = readFileSync(GOLDEN, "utf-8");
const golden = JSON.parse(goldenText) as {
  cborHex: string;
  txHash: string;
  description: string;
};
const goldenTx = Transaction.fromCbor(TxCBOR(HexBlob(golden.cborHex)));
const GOLDEN_ID = TransactionId(golden.txHash);

/** A payment key a wallet derives from its recovery phrase (CIP-1852 m/1852'/1815'/0'/0/0): a 128-hex extended key, and its public key derived from the account's public key. */
const walletKey = (() => {
  const hard = (index: number) => index + 0x80000000;
  const account = Bip32PrivateKey.fromBip39Entropy(
    Buffer.from(mnemonicToEntropy(`${"abandon ".repeat(23)}art`, wordlist)),
    "",
  ).derive([hard(1852), hard(1815), hard(0)]);
  return {
    key: Ed25519PrivateExtendedKeyHex(account.derive([0, 0]).toRawKey().hex()),
    publicKey: account.toPublic().derive([0, 0]).toRawKey(),
  };
})();

const TECH_AUTH = ["11".repeat(32), "22".repeat(32)];
const COUNCIL = ["33".repeat(32), "11".repeat(32), walletKey.key];

/** Keys and an Output over `env`, on the local filesystem. */
const keysLayer = (env: Record<string, string>) => {
  const output = captureOutput();
  return {
    output,
    layer: Layer.mergeAll(
      Keys.layer,
      ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
      NodeServices.layer,
      output.layer,
    ),
  };
};

/** Whether the signature is the public key's Ed25519 signature of the transaction id. */
const verifies = (
  txId: string,
  vkey: Ed25519PublicKeyHex,
  signature: Ed25519SignatureHex,
) =>
  Ed25519PublicKey.fromHex(vkey).verify(
    Ed25519Signature.fromHex(signature),
    HexBlob(txId),
  );

describe("signAndWrite", () => {
  it.live(
    "every tech-auth and council key, normal or extended, adds a witness that verifies against the transaction id",
    () =>
      Effect.gen(function* () {
        const path = join(tmp, "signed", "tx.json");
        const { layer } = keysLayer({
          TECH_AUTH_PRIVATE_KEYS: TECH_AUTH.join(","),
          COUNCIL_PRIVATE_KEYS: ` ${COUNCIL.join(" , ")} `,
        });
        const [file] = yield* Effect.provide(
          Effect.gen(function* () {
            const signer = yield* signerFor(true, "both");
            yield* signAndWrite(goldenTx, path, signer, "Change X");
            return yield* readTransactionFile(path);
          }),
          layer,
        );
        // The file the reference (Effect 3 CLI) writes for the same transaction and keys.
        expect(readFileSync(path, "utf-8")).toBe(
          readFileSync(
            "tests/golden/signing/preview-simple-tx-signed.json",
            "utf-8",
          ),
        );
        expect(file).toMatchObject({
          description: "Change X",
          txHash: golden.txHash,
          signed: true,
        });
        const signed = Transaction.fromCbor(TxCBOR(HexBlob(file.cborHex)));
        // The id is the hash of the body, which signing leaves as it was.
        expect(signed.body().toCbor()).toBe(goldenTx.body().toCbor());
        expect(blake2b_256(HexBlob(signed.body().toCbor()))).toBe(
          golden.txHash,
        );
        const witnesses = (signed.witnessSet().vkeys()?.values() ?? []).map(
          (w) => [w.vkey(), w.signature()] as const,
        );
        for (const [vkey, signature] of witnesses) {
          expect(verifies(golden.txHash, vkey, signature)).toBe(true);
        }
        const normal = [...TECH_AUTH, COUNCIL[0]].map((key) =>
          derivePublicKey(Ed25519PrivateNormalKeyHex(key)),
        );
        // The key in both groups signs once.
        expect(witnesses.map(([vkey]) => vkey).sort()).toEqual(
          [...normal, walletKey.publicKey.hex()].sort(),
        );
        // A normal key's signature is RFC 8032's, as @noble/curves makes it.
        for (const key of TECH_AUTH) {
          const vkey = derivePublicKey(Ed25519PrivateNormalKeyHex(key));
          expect(witnesses).toContainEqual([
            vkey,
            signMessage(
              HexBlob(golden.txHash),
              Ed25519PrivateNormalKeyHex(key),
            ),
          ]);
        }
      }),
  );

  it.live(
    "--sign reads only the groups it signs with, before any transaction",
    () =>
      Effect.gen(function* () {
        const { layer } = keysLayer({
          TECH_AUTH_PRIVATE_KEYS: TECH_AUTH.join(","),
        });
        const signer = yield* Effect.provide(
          signerFor(true, "tech-auth"),
          layer,
        );
        expect(
          signer._tag === "Signed" ? signer.groups.map((g) => g.group) : [],
        ).toEqual(["techAuth"]);
        const error = yield* Effect.flip(
          Effect.provide(signerFor(true, "both"), layer),
        );
        expect(error).toMatchObject({ key: "COUNCIL_PRIVATE_KEYS" });
      }),
  );
});

describe("transaction file", () => {
  it.live(
    "writing the golden transaction gives the golden file, in the reference's format",
    () =>
      Effect.gen(function* () {
        const path = join(tmp, "golden", "tx.json");
        const { layer } = keysLayer({});
        const read = yield* Effect.provide(
          Effect.gen(function* () {
            yield* writeTransaction(path, goldenTx, false, golden.description);
            return yield* readTransactionFile(GOLDEN);
          }),
          layer,
        );
        expect(read).toEqual([JSON.parse(goldenText)]);
        expect(readFileSync(path, "utf-8")).toBe(goldenText);
      }),
  );

  it.live("every deployment file in deployments/ reads", () =>
    Effect.gen(function* () {
      const { layer } = keysLayer({});
      const paths = readdirJson("deployments").filter((path) =>
        /deployment[^/]*\.json$/.test(path),
      );
      expect(paths.length).toBeGreaterThan(5);
      const counts = yield* Effect.provide(
        Effect.forEach(paths, (path) =>
          Effect.map(readTransactionFile(path), (txs) => txs.length),
        ),
        layer,
      );
      expect(counts.every((n) => n > 0)).toBe(true);
      expect(counts.some((n) => n > 1)).toBe(true);
    }),
  );

  it.live(
    "a malformed deployment entry is refused by the path of each bad field",
    () =>
      Effect.gen(function* () {
        const path = join(tmp, "broken-deployment.json");
        writeFileSync(
          path,
          JSON.stringify({
            transactions: [
              {
                type: "Tx ConwayEra",
                description: "x",
                txHash: "00",
                signed: "no",
              },
            ],
          }),
        );
        const { layer } = keysLayer({});
        const error = yield* Effect.flip(
          Effect.provide(readTransactionFile(path), layer),
        );
        expect(error.source).toBe(path);
        expect(error.issues.map((issue) => issue.split(":")[0])).toEqual([
          "transactions.0.cborHex",
          "transactions.0.signed",
        ]);
      }),
  );

  it.live("a path under a file is a FileWriteError naming it", () =>
    Effect.gen(function* () {
      const { layer } = keysLayer({});
      const path = join(tmp, "broken-deployment.json", "tx.json");
      writeFileSync(join(tmp, "broken-deployment.json"), "{}");
      const error = yield* Effect.flip(
        Effect.provide(writeTransaction(path, goldenTx, false, "x"), layer),
      );
      expect(error).toMatchObject({ _tag: "FileWriteError", path });
    }),
  );
});

/** Every .json file under `dir`, recursively. */
function readdirJson(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".json"))
    .map((file) => join(dir, file));
}

const envelope = (cborHex: string) =>
  JSON.stringify({ type: "TxWitness ConwayEra", description: "", cborHex });

/** A CIP-30 witness set holding the signatures. */
const witnessSet = (signatures: readonly (readonly [string, string])[]) => {
  const set = new TransactionWitnessSet();
  set.setVkeys(
    CborSet.fromCore(
      signatures.map(
        ([vkey, sig]) =>
          [vkey as Ed25519PublicKeyHex, sig as Ed25519SignatureHex] as const,
      ),
      (core) => VkeyWitness.fromCore(core),
    ),
  );
  return set.toCbor();
};

/** Write a witness file. */
const witnessFile = (name: string, content: string) => {
  const path = join(tmp, name);
  writeFileSync(path, content);
  return path;
};

describe("readWitnessFile", () => {
  const signature = Effect.map(
    signTransaction(GOLDEN_ID, [Ed25519PrivateNormalKeyHex(TECH_AUTH[0])]),
    ([s]) => s,
  );

  it.live.each<[string, (vkey: string, sig: string) => string]>([
    [
      "a tagged cardano-cli key witness",
      (v: string, s: string) => envelope(`8200825820${v}5840${s}`),
    ],
    [
      "an untagged cardano-cli key witness (cardano-cli 10.14)",
      (v: string, s: string) => envelope(`825820${v}5840${s}`),
    ],
    ["a CIP-30 witness set", (v: string, s: string) => witnessSet([[v, s]])],
  ])("reads the signature from %s", ([, encode]) =>
    Effect.gen(function* () {
      const [vkey, sig] = yield* signature;
      const { layer } = keysLayer({});
      const read = yield* Effect.provide(
        readWitnessFile(
          witnessFile("ok.witness", encode(vkey, sig)),
          GOLDEN_ID,
        ),
        layer,
      );
      expect(read).toEqual([[vkey, sig]]);
    }),
  );

  /** The issue a refused witness file gives. */
  const refusal = (content: (vkey: string, sig: string) => string) =>
    Effect.gen(function* () {
      const [vkey, sig] = yield* signature;
      const path = witnessFile("refused.witness", content(vkey, sig));
      const { layer } = keysLayer({});
      const error = yield* Effect.flip(
        Effect.provide(readWitnessFile(path, GOLDEN_ID), layer),
      );
      expect(error.source).toBe(path);
      expect(error.issues).toHaveLength(1);
      return error.issues[0];
    });

  it.live.each<[string, (vkey: string, sig: string) => string]>([
    [
      "another tag",
      (v: string, s: string) => envelope(`8201825820${v}5840${s}`),
    ],
    [
      "a 63-byte signature",
      (v: string, s: string) => envelope(`825820${v}583f${s.slice(0, -2)}`),
    ],
    [
      "a trailing byte",
      (v: string, s: string) => envelope(`825820${v}5840${s}00`),
    ],
  ])("refuses a cardano-cli witness with %s", ([, content]) =>
    Effect.map(refusal(content), (issue) =>
      expect(issue).toMatch(/^Failed to parse cardano-cli witness/),
    ),
  );

  it.live(
    "refuses a file that is neither an envelope nor witness-set CBOR",
    () =>
      Effect.map(
        refusal(() => "not a witness"),
        (issue) => expect(issue).toMatch(/^Invalid CBOR witness set/),
      ),
  );

  it.live("refuses a witness set with a 31-byte vkey", () =>
    Effect.map(
      refusal(() => `a1008182581f${"11".repeat(31)}5840${"22".repeat(64)}`),
      (issue) => expect(issue).toMatch(/^Invalid CBOR witness set/),
    ),
  );

  it.live("refuses a signature by another key, or of another transaction", () =>
    Effect.gen(function* () {
      const [other] = yield* signTransaction(GOLDEN_ID, [
        Ed25519PrivateNormalKeyHex(TECH_AUTH[1]),
      ]);
      const issue = yield* refusal((_, sig) =>
        envelope(`825820${other[0]}5840${sig}`),
      );
      expect(issue).toBe(
        `The signature by ${other[0]} does not verify against transaction ${GOLDEN_ID}`,
      );
      // A witness committed to the repository signs another transaction.
      const { layer } = keysLayer({});
      const error = yield* Effect.flip(
        Effect.provide(
          readWitnessFile("witnesses/witness-1.json", GOLDEN_ID),
          layer,
        ),
      );
      expect(error.issues[0]).toMatch(/^The signature by /);
    }),
  );

  it.live(
    "refuses a small-order key, which only ZIP-215 verification accepts",
    () => {
      // The identity point with the signature (R = identity, S = 0) verifies for every message under ZIP-215.
      const identity = `01${"00".repeat(31)}`;
      return Effect.map(
        refusal(() =>
          envelope(`825820${identity}5840${identity}${"00".repeat(32)}`),
        ),
        (issue) => expect(issue).toMatch(/^The signature by /),
      );
    },
  );
});

describe("mergeWitnesses", () => {
  const vkey = "aa".repeat(32) as Ed25519PublicKeyHex;
  const sig = "bb".repeat(64) as Ed25519SignatureHex;

  it("keeps a signature given twice once", () => {
    const merged = mergeWitnesses(new Map([[vkey, sig]]), [[vkey, sig]]);
    expect(Result.map(merged, (m) => [...m])).toEqual(
      Result.succeed([[vkey, sig]]),
    );
  });

  it("refuses the same key with another signature", () => {
    const other = "cc".repeat(64) as Ed25519SignatureHex;
    expect(
      Result.isFailure(mergeWitnesses(new Map([[vkey, sig]]), [[vkey, other]])),
    ).toBe(true);
  });
});

describe("submission on the emulator", () => {
  const DEPLOYER = "a1".repeat(32);

  /** An address of a key on the test network. */
  const keyAddress = (publicKey: Ed25519PublicKey) =>
    addressFromCredential(
      NetworkId.Testnet,
      Credential.fromCore({
        type: CredentialType.KeyHash,
        hash: publicKey.hash().hex(),
      }),
    );

  /** A UTxO of `lovelace` at `address`, from transaction `byte` repeated. */
  const utxo = (byte: string, address: Address, lovelace: bigint) =>
    new TransactionUnspentOutput(
      new TransactionInput(TransactionId(byte.repeat(32)), 0n),
      new TransactionOutput(address, new Value(lovelace)),
    );

  /** The emulator behind a rate limiter that refuses the first submission with a 429. */
  class RateLimitedOnce extends EmulatorProvider {
    private limited = false;
    override postTransactionToChain(tx: Transaction) {
      if (this.limited) return super.postTransactionToChain(tx);
      this.limited = true;
      return Promise.reject(
        Object.assign(new Error("Too Many Requests"), { status: 429 }),
      );
    }
  }

  /**
   * An emulator holding 50 ADA at the deployer's address and 2 ADA at the
   * wallet key's, an unsigned transaction paying 5 ADA from the deployer
   * (`withWallet`: also spending the wallet key's UTxO), and the layers a
   * program runs on; `rateLimited` puts the emulator behind RateLimitedOnce.
   */
  const setup = (withWallet: boolean, rateLimited = false) =>
    Effect.gen(function* () {
      const deployer = Address.fromBech32(
        keyToAddress(DEPLOYER, NetworkId.Testnet).address,
      );
      const wallet = keyAddress(walletKey.publicKey);
      const emulator = new Emulator([]);
      emulator.addUtxo(utxo("d1", deployer, 50_000_000n));
      const walletUtxo = utxo("d2", wallet, 2_000_000n);
      emulator.addUtxo(walletUtxo);
      const provider = rateLimited
        ? new RateLimitedOnce(emulator)
        : new EmulatorProvider(emulator);
      const parameters = yield* Effect.promise(() => provider.getParameters());
      const plan: TxPlan = {
        spends: withWallet
          ? [{ utxo: walletUtxo, redeemer: Option.none() }]
          : [],
        references: [],
        scripts: [],
        mints: [],
        outputs: [new TransactionOutput(deployer, new Value(5_000_000n))],
        withdrawals: [],
        registrations: [],
        collateral: [],
        metadata: Option.none(),
        feePadding: 0n,
        expectedWitnesses: withWallet ? 2 : 1,
      };
      const tx = yield* compile(plan, {
        command: "test",
        networkId: NetworkId.Testnet,
        slotConfig: SLOT_CONFIG_NETWORK.Preview,
        parameters,
        wallet: {
          address: deployer,
          utxos: [utxo("d1", deployer, 50_000_000n)],
        },
        reserved: new Set(),
        contracts: [],
        resolved: undefined,
      });
      const output = captureOutput();
      const layer = Layer.mergeAll(
        Layer.provide(
          Provider.over(provider),
          Layer.succeed(HttpClient.HttpClient)(
            HttpClient.make(() => Effect.die("no HTTP in this test")),
          ),
        ),
        Keys.layer,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ SIGNING_PRIVATE_KEY: DEPLOYER }),
        ),
        NodeServices.layer,
        output.layer,
      );
      const onChain = Effect.provide(
        Effect.gen(function* () {
          const chain = yield* Provider;
          return yield* chain.isConfirmed(tx.getId());
        }),
        layer,
      );
      return { tx, layer, output, onChain };
    });

  const DEPLOYER_SIGNS = {
    signingKey: "SIGNING_PRIVATE_KEY",
    signDeployer: true,
  } as const;

  it.live(
    "a submission the rate limiter refuses is tried again and confirmed",
    () =>
      Effect.gen(function* () {
        const { tx, layer, output, onChain } = yield* setup(false, true);
        const jsonFile = join(tmp, "rate-limited", "tx.json");
        yield* Effect.provide(
          Effect.andThen(
            writeTransaction(jsonFile, tx, false, "Simple Transaction"),
            signAndSubmitProgram({ ...DEPLOYER_SIGNS, jsonFile }),
          ),
          layer,
        );
        expect(yield* onChain).toBe(true);
        expect(
          output.lines.filter((line) => line.startsWith("Submitting")),
        ).toEqual([
          "Submitting: Simple Transaction",
          "Submitting (attempt 2/3): Simple Transaction",
        ]);
      }),
  );

  it.live(
    "sign-and-submit signs a file's transaction as the deployer and confirms it",
    () =>
      Effect.gen(function* () {
        const { tx, layer, output, onChain } = yield* setup(false);
        const jsonFile = join(tmp, "submit", "tx.json");
        yield* Effect.provide(
          Effect.andThen(
            writeTransaction(jsonFile, tx, false, "Simple Transaction"),
            signAndSubmitProgram({ ...DEPLOYER_SIGNS, jsonFile }),
          ),
          layer,
        );
        expect(yield* onChain).toBe(true);
        expect(output.lines).toContain(
          `Confirmed: Simple Transaction - ${tx.getId()}`,
        );
      }),
  );

  it.live(
    "sign-and-submit --no-sign-deployer submits the transaction as it is; the ledger refuses it once and the command fails",
    () =>
      Effect.gen(function* () {
        const { tx, layer, output, onChain } = yield* setup(false);
        const jsonFile = join(tmp, "unsigned", "tx.json");
        const error = yield* Effect.flip(
          Effect.provide(
            Effect.andThen(
              writeTransaction(jsonFile, tx, false, "Simple Transaction"),
              signAndSubmitProgram({
                ...DEPLOYER_SIGNS,
                signDeployer: false,
                jsonFile,
              }),
            ),
            layer,
          ),
        );
        expect(error._tag).toBe("SubmitError");
        expect(yield* onChain).toBe(false);
        expect(
          output.lines.filter((line) => line.startsWith("Submitting:")),
        ).toEqual(["Submitting: Simple Transaction"]);
        expect(output.lines).toContainEqual(
          expect.stringMatching(
            /^Failed to submit Simple Transaction: Submission failed after 1 attempt\(s\)/,
          ),
        );
      }),
  );

  it.live(
    "combine-signatures merges a wallet's witness with the deployer's signature and confirms the transaction",
    () =>
      Effect.gen(function* () {
        const { tx, layer, output, onChain } = yield* setup(true);
        const txFile = join(tmp, "combine", "tx.json");
        const [walletSignature] = yield* signTransaction(tx.getId(), [
          walletKey.key,
        ]);
        const witness = witnessFile(
          "wallet.witness",
          witnessSet([walletSignature]),
        );
        yield* Effect.provide(
          Effect.andThen(
            writeTransaction(txFile, tx, false, "Combined"),
            combineSignaturesProgram({
              ...DEPLOYER_SIGNS,
              tx: txFile,
              witnessFiles: [witness],
            }),
          ),
          layer,
        );
        expect(yield* onChain).toBe(true);
        expect(output.lines).toContain(`Confirmed: ${tx.getId()}`);
      }),
  );

  it.live(
    "combine-signatures refuses a witness of another transaction before anything is submitted",
    () =>
      Effect.gen(function* () {
        const { tx, layer, output, onChain } = yield* setup(true);
        const txFile = join(tmp, "combine-refused", "tx.json");
        const [stale] = yield* signTransaction(GOLDEN_ID, [walletKey.key]);
        const witness = witnessFile("stale.witness", witnessSet([stale]));
        const error = yield* Effect.flip(
          Effect.provide(
            Effect.andThen(
              writeTransaction(txFile, tx, false, "Combined"),
              combineSignaturesProgram({
                ...DEPLOYER_SIGNS,
                tx: txFile,
                witnessFiles: [witness],
              }),
            ),
            layer,
          ),
        );
        expect(error).toMatchObject({
          _tag: "InputParseError",
          source: witness,
        });
        expect(output.lines.some((line) => line.startsWith("Submitting"))).toBe(
          false,
        );
        expect(yield* onChain).toBe(false);
      }),
  );

  it.live(
    "combine-signatures refuses a deployment file of several transactions",
    () =>
      Effect.gen(function* () {
        const { layer } = yield* setup(false);
        const path = readdirJson("deployments").find((file) =>
          file.endsWith("deployment-transactions.json"),
        )!;
        const error = yield* Effect.flip(
          Effect.provide(
            combineSignaturesProgram({
              ...DEPLOYER_SIGNS,
              tx: path,
              witnessFiles: [witnessFile("unused.witness", "")],
            }),
            layer,
          ),
        );
        expect(error).toMatchObject({ _tag: "InputParseError", source: path });
      }),
  );
});
