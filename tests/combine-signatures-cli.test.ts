import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handler } from "../cli-yargs/commands/combine-signatures";

describe("combine-signatures witness parsing", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects direct-format cardano-cli witnesses whose vkey bytestring is not 32 bytes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "combine-signatures-"));
    tempDirs.push(tempDir);

    const txPath = join(tempDir, "tx.json");
    const witnessPath = join(tempDir, "malformed.witness.json");
    writeFileSync(txPath, JSON.stringify({ unused: true }));
    writeFileSync(
      witnessPath,
      JSON.stringify({
        type: "TxWitness ShelleyEra",
        description: "malformed direct witness",
        cborHex: `82581f${"11".repeat(31)}5840${"22".repeat(64)}`,
      }),
    );

    await expect(
      handler({
        network: "local",
        output: tempDir,
        provider: "emulator",
        tx: txPath,
        signatures: [witnessPath],
        "signing-key": "IGNORED",
        "sign-deployer": false,
      }),
    ).rejects.toThrow(
      `Failed to parse witness file ${witnessPath}: Failed to parse cardano-cli witness: Expected byte string of length 32 (0x5820) for vkey, got 0x581f`,
    );
  });
});
