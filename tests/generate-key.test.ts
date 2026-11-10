import { NetworkId } from "@blaze-cardano/core";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { Environment } from "../cli/config";
import { Output } from "../cli/output";
import { generateKeyProgram, keyToAddress } from "../cli/wallet";

// Reference vector from cardano-cli 10.14 (`key verification-key`, `address key-hash`, `address build`); the Effect 3 CLI derives the same.
const KEY = "4d".repeat(32);
const HASH = "e9ef70e6ec55c6588356ac6255bfb379512c2c311555deceaae65a24";

describe("keyToAddress", () => {
  it.each([
    [
      NetworkId.Testnet,
      "addr_test1vr577u8xa32uvkyr26kxy4dlkdu4ztpvxy24thkw4tn95fq5vxpvk",
    ],
    [
      NetworkId.Mainnet,
      "addr1v8577u8xa32uvkyr26kxy4dlkdu4ztpvxy24thkw4tn95fq0yjarn",
    ],
  ])("matches cardano-cli on network %i", (networkId, address) => {
    expect(keyToAddress(KEY, networkId)).toEqual({
      privateKeyHex: KEY,
      publicKeyHash: HASH,
      address,
    });
  });
});

describe("generate-key", () => {
  it.live.each<[Environment, NetworkId]>([
    ["mainnet", NetworkId.Mainnet],
    ["emulator", NetworkId.Testnet],
  ])(
    "prints a fresh key with the address it derives on the network",
    ([network, networkId]) =>
      Effect.gen(function* () {
        const lines: string[] = [];
        yield* generateKeyProgram({ network }).pipe(
          Effect.provide(
            Layer.succeed(Output, {
              log: (line) => Effect.sync(() => void lines.push(line)),
              error: () => Effect.void,
            }),
          ),
        );
        const env = Object.fromEntries(lines.map((line) => line.split("=")));
        const key: string = env.SIGNING_PRIVATE_KEY;
        expect(key).toMatch(/^[0-9a-f]{64}$/);
        const derived = keyToAddress(key, networkId);
        expect(env.DEPLOYER_ADDRESS).toBe(derived.address);
        expect(env["# PUBLIC_KEY_HASH"]).toBe(derived.publicKeyHash);
      }),
  );
});
