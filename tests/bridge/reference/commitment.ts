/** Committee commitment (MIP): deduplicated, key-sorted authority leaves. */
import { authorityLeaf } from "../../../cli/bridge/authority-set";
import { keccak } from "../../../cli/bridge/keccak";
import { merkleRoot } from "./keccak";
import type { Commitment } from "./scale";

export type Member = { key: Uint8Array; seats: number };

/** Sum seats per key, sort by key bytes, hash the 37-byte leaves. */
export function committeeCommitment(
  validatorSetId: bigint,
  members: readonly Member[],
): { commitment: Commitment; leaves: Uint8Array[] } {
  const seats = new Map<string, Member>();
  for (const m of members) {
    const k = Buffer.from(m.key).toString("hex");
    const prev = seats.get(k);
    seats.set(k, prev ? { key: m.key, seats: prev.seats + m.seats } : { ...m });
  }
  const sorted = [...seats.values()].sort((a, b) =>
    Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)),
  );
  const leaves = sorted.map((m) => authorityLeaf(m.key, m.seats));
  const seatCount = sorted.reduce((n, m) => n + m.seats, 0);
  return {
    commitment: {
      validatorSetId,
      seatCount,
      keysetCommitment: merkleRoot(leaves.map(keccak)),
    },
    leaves,
  };
}
