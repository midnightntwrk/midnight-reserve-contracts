/**
 * Chain reads the bridge commands share: the bridge scripts of the
 * blueprint; the light client and BEEFY threshold (each by its NFT), the
 * two-stage main and the pool UTxOs; their datums; and the reference-script
 * UTxOs at the deployer address.
 */
import type {
  NetworkId,
  Script,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { Effect, Either, Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import { contractUtxos } from "../chain/governance-provider";
import { Provider } from "../chain/provider";
import { decodeInlineDatum } from "../chain/transaction";
import { Settings } from "../config/settings";
import { Blueprint } from "../contracts/contracts";
import { UtxoNotFound } from "../errors";

/** The committee bridge scripts. */
export interface BridgeScripts {
  readonly forever: Script;
  readonly twoStage: Script;
  readonly logic: Script;
  readonly pool: Script;
  readonly threshold: Script;
}

/** The committee bridge scripts of the blueprint. */
export const bridgeScripts = Effect.gen(function* () {
  const blueprint = yield* Blueprint;
  const triple = yield* blueprint.twoStage("committee-bridge");
  const pool = yield* blueprint.optional("committeeBridgePool");
  const threshold = yield* blueprint.optional("beefySignerThreshold");
  const scripts: BridgeScripts = {
    forever: triple.forever.Script,
    twoStage: triple.twoStage.Script,
    logic: triple.logic.Script,
    pool: pool.Script,
    threshold: threshold.Script,
  };
  return scripts;
});

/** The light client, the two-stage main and the BEEFY threshold UTxOs, and the pool UTxOs: those at the pool address with no datum hash, which no spend can witness. */
export const bridgeUtxos = (scripts: BridgeScripts, networkId: NetworkId) =>
  Effect.gen(function* () {
    const found = yield* contractUtxos(
      {
        forever: scripts.forever,
        twoStage: scripts.twoStage,
        threshold: scripts.threshold,
        pool: scripts.pool,
      },
      networkId,
    );
    return {
      lightClient: yield* found.nft("forever"),
      main: yield* found.main("twoStage"),
      threshold: yield* found.nft("threshold"),
      pool: found
        .at("pool")
        .filter((utxo) => utxo.output().datum()?.asDataHash() === undefined),
    };
  });

/** The light client's BeefyConsensusState. */
export const bridgeStateAt = (utxo: TransactionUnspentOutput) =>
  decodeInlineDatum(utxo, "BeefyConsensusState", (data) =>
    parse(Contracts.BeefyConsensusState, data),
  );

/** The BEEFY threshold's datum. */
export const beefyThresholdAt = (utxo: TransactionUnspentOutput) =>
  decodeInlineDatum(utxo, "BeefyThreshold", (data) =>
    parse(Contracts.BeefyThreshold, data),
  );

/** The deployer's UTxO carrying the script of each hash as its reference script, in order; None where there is none. */
export const findReferenceScripts = (hashes: readonly string[]) =>
  Effect.gen(function* () {
    const address = yield* Effect.flatMap(Settings, (s) => s.deployerAddress);
    const utxos = yield* Effect.flatMap(Provider, (p) =>
      p.unspentOutputs(address),
    );
    return {
      address: address.toBech32(),
      found: hashes.map((hash) =>
        Option.fromNullable(
          utxos.find((u) => u.output().scriptRef()?.hash() === hash),
        ),
      ),
    };
  });

/** The deployer's UTxO carrying the script of each hash as its reference script, in order; UtxoNotFound naming the first one missing. */
export const referenceScripts = (hashes: readonly string[]) =>
  Effect.flatMap(findReferenceScripts(hashes), ({ address, found }) =>
    Effect.forEach(found, (utxo, i) =>
      Either.fromOption(utxo, () => UtxoNotFound.carrying(address, hashes[i])),
    ),
  );
