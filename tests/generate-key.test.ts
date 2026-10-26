import { expect, test } from "bun:test";
import { NetworkId } from "@blaze-cardano/core";
import { keyToAddress } from "../cli/wallet/generate-key";

// Reference vector from cardano-cli 10.14 (`key verification-key`, `address key-hash`, `address build`).
const KEY = "4d".repeat(32);
const HASH = "e9ef70e6ec55c6588356ac6255bfb379512c2c311555deceaae65a24";

test.each([
  [
    NetworkId.Testnet,
    "addr_test1vr577u8xa32uvkyr26kxy4dlkdu4ztpvxy24thkw4tn95fq5vxpvk",
  ],
  [
    NetworkId.Mainnet,
    "addr1v8577u8xa32uvkyr26kxy4dlkdu4ztpvxy24thkw4tn95fq0yjarn",
  ],
])("keyToAddress matches cardano-cli on network %i", (networkId, address) => {
  expect(keyToAddress(KEY, networkId)).toEqual({
    privateKeyHex: KEY,
    publicKeyHash: HASH,
    address,
  });
});
