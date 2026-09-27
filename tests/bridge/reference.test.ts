import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { bytesToHex } from "@noble/hashes/utils.js";
import { committee, dummyLeafHash, keysetRoot } from "./reference/fixtures";
import { authorityLeaf, buildMultiproof } from "../../cli/bridge/authority-set";
import { keccak } from "../../cli/bridge/keccak";
import { merkleRoot } from "./reference/keccak";
import { Mmr, verifyMmrLeaf } from "./reference/mmr";
import { walkMultiproof } from "./reference/multiproof";
import { keypair } from "./reference/sign";
import { vectorsAk } from "./reference/aiken";
import { toJsonText, vectors } from "./reference/vectors";
import { VECTORS_AK, VECTORS_DIR } from "./generate";

const hex = bytesToHex;

describe("committed vectors match the reference", () => {
  const generated = vectors();
  for (const name of Object.keys(generated)) {
    test(`${name}.json`, () => {
      const onDisk = JSON.parse(
        readFileSync(resolve(VECTORS_DIR, `${name}.json`), "utf-8"),
      );
      expect(onDisk).toEqual(JSON.parse(toJsonText(generated[name])));
    });
  }
  test("lib/bridge/vectors.ak", () => {
    expect(readFileSync(VECTORS_AK, "utf-8")).toBe(vectorsAk());
  });
});

describe("committee commitment", () => {
  test("seats (1, 2, 1) give seat_count 4 and the nested root", () => {
    const [l1, l2, l3] = committee.leaves.map(keccak);
    expect(committee.commitment.seatCount).toBe(4);
    expect(hex(keysetRoot)).toBe(
      hex(
        keccak(
          new Uint8Array([...keccak(new Uint8Array([...l1, ...l2])), ...l3]),
        ),
      ),
    );
  });
});

describe("multiproof", () => {
  test("every signer subset of committees of 1..7 hashes to merkle_root", () => {
    for (let n = 1; n <= 7; n++) {
      const leaves = Array.from({ length: n }, (_, i) =>
        authorityLeaf(keypair(100n + BigInt(i)).public, i + 1),
      );
      const root = merkleRoot(leaves.map(keccak));
      for (let mask = 1; mask < 1 << n; mask++) {
        const signers = new Set(
          Array.from({ length: n }, (_, i) => i).filter((i) => mask & (1 << i)),
        );
        const walked = walkMultiproof(buildMultiproof(leaves, signers));
        expect(hex(walked.root)).toBe(hex(root));
        expect(walked.leaves.map(hex)).toEqual(
          [...signers].sort((a, b) => a - b).map((i) => hex(leaves[i])),
        );
      }
    }
  });
});

describe("mmr", () => {
  test("every leaf of sizes 1..20 verifies; a tampered item does not", () => {
    for (let n = 1; n <= 20; n++) {
      const mmr = new Mmr(
        Array.from({ length: n }, (_, i) => dummyLeafHash(i)),
      );
      const root = mmr.root();
      for (let i = 0; i < n; i++) {
        const items = mmr.proof(i);
        expect(verifyMmrLeaf(root, mmr.leafHashes[i], i, n, items)).toBe(true);
        if (items.length) {
          const bad = items.map((x) => new Uint8Array(x));
          bad[0][0] ^= 1;
          expect(verifyMmrLeaf(root, mmr.leafHashes[i], i, n, bad)).toBe(false);
        }
        expect(
          verifyMmrLeaf(root, mmr.leafHashes[i], i, n, [
            ...items,
            items[0] ?? root,
          ]),
        ).toBe(false);
      }
    }
  });
});
