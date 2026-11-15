/**
 * Two-stage contracts: the main and staging NFTs, the UpgradeState in a
 * two-stage UTxO's inline datum, and which validator names are a track's
 * logic.
 */
import {
  AssetId,
  toHex,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { Effect } from "effect";
import * as Contracts from "../../contract_blueprint";
import { decodeInlineDatum } from "../datum";
import type { DatumParseError } from "../errors";

/** Hex of the "main" NFT name every two-stage contract mints. */
export const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));
/** Hex of the "staging" NFT name every two-stage contract mints. */
export const STAGING_TOKEN_HEX = toHex(new TextEncoder().encode("staging"));

/** The UTxO holding the "main" NFT of this two-stage policy. */
export const findMainUtxo = (
  utxos: readonly TransactionUnspentOutput[],
  policyId: string,
): TransactionUnspentOutput | undefined =>
  utxos.find(
    (utxo) =>
      utxo
        .output()
        .amount()
        .multiasset()
        ?.get(AssetId(policyId + MAIN_TOKEN_HEX)) === 1n,
  );

/** The UpgradeState fields the CLI reads. */
export interface UpgradeState {
  readonly logicHash: string;
  readonly mitigationLogicHash: string;
  readonly authHash: string;
  readonly logicRound: number;
}

/** The blueprint UpgradeState tuple in a two-stage UTxO's inline datum. */
export const rawUpgradeStateAt = (
  utxo: TransactionUnspentOutput,
): Effect.Effect<Contracts.UpgradeState, DatumParseError> =>
  decodeInlineDatum(utxo, "UpgradeState", (data) =>
    parse(Contracts.UpgradeState, data),
  );

/** The UpgradeState in a two-stage UTxO's inline datum. */
export const upgradeStateAt = (
  utxo: TransactionUnspentOutput,
): Effect.Effect<UpgradeState, DatumParseError> =>
  Effect.map(
    rawUpgradeStateAt(utxo),
    ([logicHash, mitigationLogicHash, authHash, , , logicRound]) => ({
      logicHash,
      mitigationLogicHash,
      authHash,
      logicRound: Number(logicRound),
    }),
  );

/** Whether `name` is a logic of `track`: `<track>_logic`, or `<track>_logic_v<N>` for any N from 2 up. */
export const isTrackLogic = (track: string, name: string): boolean =>
  name === `${track}_logic` ||
  new RegExp(`^${track}_logic_v([2-9]|[1-9][0-9]+)$`).test(name);
