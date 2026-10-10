import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Effect, Layer } from "effect";
import {
  derivePublicKey,
  Ed25519PrivateNormalKeyHex,
  Ed25519PublicKey,
  Ed25519Signature,
  HexBlob,
  initCrypto,
  Transaction,
  TxCBOR,
} from "@blaze-cardano/core";
import { OutputLive, Output } from "../cli/output";
import { signAndWrite, signerFor } from "../cli/chain/transaction";
import {
  OutputCaptured,
  captureOutput,
  expectFailure,
  PlatformLive,
  runTest,
  SettingsOver,
  SettingsWith,
  testEnv,
} from "./helpers/effect";

const goldenPath = "tests/golden/simple-tx/preview-simple-tx.json";
const golden = JSON.parse(readFileSync(goldenPath, "utf-8")) as {
  cborHex: string;
  txHash: string;
  description: string;
};
const goldenTx = Transaction.fromCbor(TxCBOR(HexBlob(golden.cborHex)));

describe("signerFor", () => {
  const techAuthOnly = SettingsWith("emulator", {
    TECH_AUTH_PRIVATE_KEYS: testEnv("TECH_AUTH_PRIVATE_KEYS"),
  });

  test("tech-auth reads only the tech-auth keys; both also needs the council keys", async () => {
    const signer = await runTest(techAuthOnly, signerFor(true, "tech-auth"));
    expect(
      signer._tag === "Signed" ? signer.groups.map((g) => g.group) : [],
    ).toEqual(["techAuth"]);
    const error = await expectFailure(
      techAuthOnly,
      signerFor(true, "both"),
      "ConfigError",
    );
    expect(error.key).toBe("COUNCIL_PRIVATE_KEYS");
  });
});

describe("signAndWrite", () => {
  test("signed: attaches a verifying witness for every tech-auth and council key in the env", async () => {
    // Verify goes through libsodium, which cli/index.ts initialises; this test bypasses it.
    await initCrypto();
    const capture = captureOutput();
    await runTest(
      Layer.mergeAll(OutputCaptured(capture), SettingsOver("emulator")),
      Effect.flatMap(signerFor(true, "both"), (signer) =>
        signAndWrite(goldenTx, "out/tx.json", signer, "Change X"),
      ),
    );
    const written = capture.files.get("out/tx.json") as {
      cborHex: string;
      signed: boolean;
    };
    expect(written.signed).toBe(true);
    const signed = Transaction.fromCbor(TxCBOR(HexBlob(written.cborHex)));
    const witnesses = [...(signed.witnessSet().vkeys()?.values() ?? [])];
    for (const witness of witnesses) {
      expect(
        Ed25519PublicKey.fromHex(witness.vkey()).verify(
          Ed25519Signature.fromHex(witness.signature()),
          HexBlob(golden.txHash),
        ),
      ).toBe(true);
    }
    const keysOf = (key: string) =>
      testEnv(key)
        .split(",")
        .map((k) => k.trim());
    const techAuth = keysOf("TECH_AUTH_PRIVATE_KEYS");
    const council = keysOf("COUNCIL_PRIVATE_KEYS");
    expect(new Set(witnesses.map((w) => w.vkey()))).toEqual(
      new Set(
        [...techAuth, ...council].map((key) =>
          derivePublicKey(Ed25519PrivateNormalKeyHex(key)),
        ),
      ),
    );
  });
});

describe("LoggingLive", () => {
  /** The real stdout and stderr of a child process that logs one warning and one debug record through LoggingLive. */
  const logged = (level: "Info" | "Debug", tty: boolean) => {
    const script = `
      import { Effect, LogLevel } from "effect";
      import { LoggingLive } from "./cli/run";
      Effect.runPromise(
        Effect.provide(
          Effect.zipRight(
            Effect.logWarning("falling back").pipe(Effect.annotateLogs({ family: "council" })),
            Effect.logDebug("detail"),
          ),
          LoggingLive(LogLevel.${level}, ${tty}),
        ),
      );`;
    const run = Bun.spawnSync(["bun", "-e", script]);
    return { out: run.stdout.toString(), err: run.stderr.toString() };
  };

  test("off a TTY: logfmt on stderr, from the minimum level up", () => {
    const { out, err } = logged("Info", false);
    expect(out).toBe("");
    for (const field of [
      "level=WARN",
      'message="falling back"',
      "family=council",
    ]) {
      expect(err).toContain(field);
    }
    expect(err).not.toContain("detail");
  });

  test("on a TTY: pretty on stderr", () => {
    const { out, err } = logged("Debug", true);
    expect(out).toBe("");
    expect(err).toContain("falling back");
    expect(err).toContain("detail");
  });
});

describe("OutputLive files", () => {
  const layer = Layer.provide(OutputLive, PlatformLive);

  test("writeJson creates the directory; a path under a file is a FileWriteError naming it", async () => {
    const nested = join(mkdtempSync(join(tmpdir(), "output-")), "a", "tx.json");
    await runTest(
      layer,
      Effect.flatMap(Output, (output) =>
        output.writeJson(nested, { ok: true }),
      ),
    );
    expect(JSON.parse(readFileSync(nested, "utf-8"))).toEqual({ ok: true });
    const blocked = join(nested, "child.txt");
    const error = await expectFailure(
      layer,
      Effect.flatMap(Output, (output) => output.writeText(blocked, "x")),
      "FileWriteError",
    );
    expect(error.path).toBe(blocked);
  });
});
