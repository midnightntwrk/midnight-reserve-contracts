import { describe, test, expect } from "bun:test";
import { PlutusData, PlutusList } from "@blaze-cardano/core";
import { getDatumHandler } from "../cli-yargs/lib/datum-versions";

// change-federated-ops re-encodes the permissioned-candidates list with this
// handler, so a babe key must survive set → encode → decode.
describe("FederatedOps babe key", () => {
  const candidate = {
    sidechain_pub_key: "1122",
    aura_pub_key: "aabb",
    grandpa_pub_key: "ccdd",
    beefy_pub_key: "eeff",
    babe_pub_key: "b0b0",
  };

  for (const round of [1, 2]) {
    test(`v${round} round-trip keeps babe_pub_key`, () => {
      const items = new PlutusList();
      items.add(
        PlutusData.fromCore({ constructor: 0n, fields: { items: [] } }),
      );
      if (round === 2)
        items.add(PlutusData.newBytes(Buffer.from("cafe", "hex")));
      items.add(PlutusData.newList(new PlutusList()));
      items.add(PlutusData.newInteger(BigInt(round)));

      const handler = getDatumHandler("federated-ops", round);
      const updated = handler.setCandidates!(
        handler.decode(PlutusData.newList(items)),
        [candidate],
      );
      const roundTripped = handler.decode(handler.encode(updated));

      expect(roundTripped.candidates[0]).toEqual(candidate);
    });
  }
});
