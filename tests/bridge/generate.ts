/**
 * Write the MIP vectors (`tests/vectors/bridge/*.json`) and the generated
 * Aiken fixtures (`lib/fixtures/bridge/vectors.ak`; `signer_cap_vectors.ak`
 * with `--signer-cap`, slow). `tests/bridge/reference.test.ts` fails when
 * the committed files drift from this output.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { signerCapAk, vectorsAk } from "./reference/aiken";
import { toJsonText, vectors } from "./reference/vectors";

export const VECTORS_DIR = resolve(import.meta.dir, "../vectors/bridge");
export const VECTORS_AK = resolve(
  import.meta.dir,
  "../../lib/fixtures/bridge/vectors.ak",
);
export const SIGNER_CAP_AK = resolve(
  import.meta.dir,
  "../../lib/fixtures/bridge/signer_cap_vectors.ak",
);

if (import.meta.main) {
  mkdirSync(VECTORS_DIR, { recursive: true });
  for (const [name, value] of Object.entries(vectors())) {
    writeFileSync(resolve(VECTORS_DIR, `${name}.json`), toJsonText(value));
  }
  writeFileSync(VECTORS_AK, vectorsAk());
  if (process.argv.includes("--signer-cap"))
    writeFileSync(SIGNER_CAP_AK, signerCapAk());
  console.log(`wrote ${Object.keys(vectors()).length} vectors, ${VECTORS_AK}`);
}
