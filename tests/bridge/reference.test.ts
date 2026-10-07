import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { committeeCommitment, required } from "./reference/commitment";
import { committee, dummyLeafHash, keysetRoot } from "./reference/fixtures";
import { keccak, merkleRoot } from "./reference/keccak";
import { Mmr, verifyMmrLeaf } from "./reference/mmr";
import { buildMultiproof, walkMultiproof } from "./reference/multiproof";
import { authorityLeaf, encodeCommitment, encodeLeaf } from "./reference/scale";
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
  test("lib/fixtures/bridge/vectors.ak", () => {
    expect(readFileSync(VECTORS_AK, "utf-8")).toBe(vectorsAk());
  });
});

describe("encodings", () => {
  test("MIP signed bytes", () => {
    expect(hex(encodeCommitment(new Uint8Array(32), 1, 0n))).toBe(
      "046d68800000000000000000000000000000000000000000000000000000000000000000010000000000000000000000",
    );
  });
  test("MIP leaf layout", () => {
    const leaf = encodeLeaf({
      parentNumber: 600,
      parentHash: hexToBytes(
        "9b9462bf599ab609ea9917918e6b69b54b2bff8b7be6fc0de8984b55f5fbb057",
      ),
      nextAuthoritySet: {
        validatorSetId: 1n,
        seatCount: 4,
        keysetCommitment: keysetRoot,
      },
    });
    expect(leaf.length).toBe(82);
    expect(hex(leaf)).toBe(
      `00580200009b9462bf599ab609ea9917918e6b69b54b2bff8b7be6fc0de8984b55f5fbb057010000000000000004000000${hex(keysetRoot)}00`,
    );
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
  test("[k2, k1, k2, k3] yields the same root", () => {
    const [k1, k2, k3] = committee.leaves.map((l) => l.subarray(0, 33));
    const permuted = committeeCommitment(
      0n,
      [k2, k1, k2, k3].map((key) => ({ key, seats: 1 })),
    );
    expect(hex(permuted.commitment.keysetCommitment)).toBe(hex(keysetRoot));
    expect(permuted.commitment.seatCount).toBe(4);
  });
  test("required (2, 3)", () => {
    expect([10, 6, 3, 1, 4].map((n) => required(n, 2, 3))).toEqual([
      7, 5, 3, 1, 3,
    ]);
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
  // Golden vectors from a pallet-mmr node: the proven leaf is its own peak.
  test("golden vector 552 of 553", () => {
    const leaf = encodeLeaf({
      parentNumber: 552,
      parentHash: hexToBytes(
        "c40e4fe32fa489a14783829c1e6eb264aec75b012ff58ad82b165386e24a3279",
      ),
      nextAuthoritySet: {
        validatorSetId: 1n,
        seatCount: 1,
        keysetCommitment: hexToBytes(
          "ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
        ),
      },
    });
    expect(
      verifyMmrLeaf(
        hexToBytes(
          "184d38dc3f285e2fda58e07212aec48e479f5d33a491ff805231954bfc5b2af3",
        ),
        keccak(leaf),
        552,
        553,
        [
          "48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
          "9535761693a1e47e66817cdf25371c1d64ef318ee8c85ce67d3d88b12aaa1b83",
          "6403a4149a189e4f9ab21045adee353c5ba4d878600f8d23e6eaba76d0ac6269",
        ].map(hexToBytes),
      ),
    ).toBe(true);
  });
  test("golden vector 600 of 601", () => {
    const leaf = encodeLeaf({
      parentNumber: 600,
      parentHash: hexToBytes(
        "9b9462bf599ab609ea9917918e6b69b54b2bff8b7be6fc0de8984b55f5fbb057",
      ),
      nextAuthoritySet: {
        validatorSetId: 1n,
        seatCount: 1,
        keysetCommitment: hexToBytes(
          "ea5e28e6e07cc0d6ea6978c5c161f0da9f05ad6d5c259bd98a38d5ed63c6d66d",
        ),
      },
    });
    expect(
      verifyMmrLeaf(
        hexToBytes(
          "023bf85dd76a4d6b9d5a5020c083a2a82719c049d4091325e735c5d0fe625c0e",
        ),
        keccak(leaf),
        600,
        601,
        [
          "48d47d5df4bf531f27083bfbff0f55713421f483106065d421cbc43eb6f2cf20",
          "1f86e403238b1ce4aa6cd5c665e09821eb5a77acc6558c3e5d0192ec66bc1dee",
          "d8f44f672c85e903549242cfcfd619432e692386a684d99fce21ca863bc10869",
          "54d7061256cecc20b599f9a3331b9298b607a7f95cf3ee40cd1a50ab66792ae3",
        ].map(hexToBytes),
      ),
    ).toBe(true);
  });
});
