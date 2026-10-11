/**
 * Two-stage contracts: the main and staging NFTs, their UTxOs through the
 * Provider service, the UpgradeState of a main or staging UTxO and the logic
 * scripts it names. twoStageLogic serves change-council, change-tech-auth,
 * change-terms and change-federated-ops.
 */
import {
  addressFromValidator,
  AssetId,
  type NetworkId,
  type Script,
  toHex,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { Effect, Either, Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import { Provider } from "../chain/provider";
import { Blueprint } from "../contracts/contracts";
import { decodeInlineDatum } from "../datum/inline";
import { createRewardAccount } from "../tx/scripts";
import { Output } from "../output";
import {
  type ConfigError,
  type DatumParseError,
  type ProviderError,
  UtxoNotFound,
} from "../errors";

/** Hex of the "main" NFT name every two-stage contract mints. */
export const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));
/** Hex of the "staging" NFT name every two-stage contract mints. */
export const STAGING_TOKEN_HEX = toHex(new TextEncoder().encode("staging"));

const holdsOne = (utxo: TransactionUnspentOutput, assetId: AssetId) =>
  (utxo.output().amount().multiasset()?.get(assetId) ?? 0n) === 1n;

/** The UTxO holding the "main" NFT of this two-stage policy. */
export const findMainUtxo = (
  utxos: readonly TransactionUnspentOutput[],
  policyId: string,
): TransactionUnspentOutput | undefined =>
  utxos.find((u) => holdsOne(u, AssetId(policyId + MAIN_TOKEN_HEX)));

/** The logic and mitigation logic scripts an UpgradeState names; `expected` describes the logic the unknown-logic error asks for. */
export const upgradeScripts = (
  state: Pick<UpgradeState, "logicHash" | "mitigationLogicHash">,
  expected: string,
) =>
  Effect.flatMap(Blueprint, (blueprint) =>
    Effect.all({
      logic: blueprint.scriptByHash(
        state.logicHash,
        `Unknown logic script hash in UpgradeState: ${state.logicHash}. Expected: ${expected}`,
      ),
      mitigationLogic: state.mitigationLogicHash
        ? Effect.map(
            blueprint.scriptByHash(
              state.mitigationLogicHash,
              `Unknown mitigation logic script hash in UpgradeState: ${state.mitigationLogicHash}`,
            ),
            Option.some,
          )
        : Effect.succeed(Option.none<Script>()),
    }),
  );

/** The main and staging UTxOs of a two-stage contract, found by their NFT names. */
export const twoStageUtxos = (
  twoStageScript: Script,
  networkId: NetworkId,
): Effect.Effect<
  {
    main: TransactionUnspentOutput;
    staging: TransactionUnspentOutput;
  },
  ProviderError | ConfigError | UtxoNotFound,
  Provider
> =>
  Effect.flatMap(Provider, (provider) => {
    const address = addressFromValidator(networkId, twoStageScript);
    const policyId = twoStageScript.hash();
    return Effect.flatMap(provider.unspentOutputs(address), (utxos) => {
      const main = findMainUtxo(utxos, policyId);
      const staging = utxos.find((u) =>
        holdsOne(u, AssetId(policyId + STAGING_TOKEN_HEX)),
      );
      return main && staging
        ? Effect.succeed({ main, staging })
        : Effect.fail(
            UtxoNotFound.holding(
              address.toBech32(),
              [
                ...(main ? [] : [`${policyId}.main`]),
                ...(staging ? [] : [`${policyId}.staging`]),
              ].join(" and "),
            ),
          );
    });
  });

export interface UpgradeState {
  logicHash: string;
  mitigationLogicHash: string;
  authHash: string;
  logicRound: number;
}

/** The upgrade state a two-stage deployment starts from. */
export function createUpgradeState(
  logicScriptHash: string,
  govAuthScriptHash: string,
): Contracts.UpgradeState {
  return [logicScriptHash, "", govAuthScriptHash, "", 0n, 0n];
}

const upgradeStateOf = ([
  logicHash,
  mitigationLogicHash,
  authHash,
  ,
  ,
  logicRound,
]: Contracts.UpgradeState): UpgradeState => ({
  logicHash,
  mitigationLogicHash,
  authHash,
  logicRound: Number(logicRound),
});

/** The blueprint UpgradeState tuple in a two-stage UTxO's inline datum. */
export const rawUpgradeStateAt = (
  utxo: TransactionUnspentOutput,
): Either.Either<Contracts.UpgradeState, DatumParseError> =>
  decodeInlineDatum(utxo, "UpgradeState", (data) =>
    parse(Contracts.UpgradeState, data),
  );

/** The UpgradeState in a two-stage UTxO's inline datum. */
export const upgradeStateAt = (
  utxo: TransactionUnspentOutput,
): Either.Either<UpgradeState, DatumParseError> =>
  Either.map(rawUpgradeStateAt(utxo), upgradeStateOf);

/** The logic scripts a two-stage main state names, logged with the reward accounts the transaction withdraws from. */
export const twoStageLogic = (
  label: string,
  twoStageMain: TransactionUnspentOutput,
  expectedLogic: string,
  networkId: NetworkId,
) =>
  Effect.gen(function* () {
    const out = yield* Output;
    yield* out.log(`\nReading ${label} two-stage upgrade state...`);
    const state = yield* upgradeStateAt(twoStageMain);
    yield* out.log(`  Logic hash: ${state.logicHash}`);
    yield* out.log(
      `  Mitigation logic hash: ${state.mitigationLogicHash || "(empty)"}`,
    );
    yield* out.log(`  Logic round: ${state.logicRound}`);
    const { logic, mitigationLogic } = yield* upgradeScripts(
      state,
      expectedLogic,
    );
    yield* out.log(
      `\nLogic reward account: ${createRewardAccount(state.logicHash, networkId)}`,
    );
    if (Option.isSome(mitigationLogic)) {
      yield* out.log(
        `Mitigation logic reward account: ${createRewardAccount(state.mitigationLogicHash, networkId)}`,
      );
      yield* out.log("  Adding mitigation logic withdrawal...");
    }
    return {
      logicRound: state.logicRound,
      logicScript: logic,
      mitigationLogicScript: mitigationLogic,
    };
  });
