/**
 * Chain reads governance commands share: contract, two-stage and deployer
 * UTxOs through the Provider service; the UpgradeState, signer and threshold
 * datums of those UTxOs; reward-account registration through Blockfrost.
 */
import {
  Address,
  addressFromValidator,
  AssetId,
  type NetworkId,
  PlutusData,
  type RewardAccount,
  type Script,
  toHex,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import type { HttpClient } from "@effect/platform";
import { Effect, Either, Option, Record, Schema } from "effect";
import * as Contracts from "../../contract_blueprint";
import { type Environment, publicNetworkOf } from "../config/network-mapping";
import { blockfrostApiKeyVariable, Settings } from "../config/settings";
import { Blueprint } from "../contracts/contracts";
import { decodeSigners, type Signers } from "../datum/signers";
import { blockfrostAccessTo, blockfrostGet } from "./blockfrost";
import { Provider } from "./provider";
import type { TxHash, TxIndex } from "../input";
import {
  decodeDatum,
  decodeInlineDatum,
  findUtxoByTxRef,
  inlineDatum,
} from "./transaction";
import {
  type AuthorityThreshold,
  authorityThreshold,
} from "../governance/threshold";
import {
  ConfigError,
  DatumParseError,
  InputParseError,
  type ProviderError,
  StakeNotRegistered,
  UtxoNotFound,
} from "../errors";

/** The UTxOs at each contract, by name, with lookups that fail as UtxoNotFound. */
export interface ContractUtxos<K extends string> {
  /** Every UTxO at the contract. */
  readonly at: (name: K) => readonly TransactionUnspentOutput[];
  /** The first UTxO at the contract. */
  readonly first: (
    name: K,
  ) => Either.Either<TransactionUnspentOutput, UtxoNotFound>;
  /** The UTxO holding the main NFT of a two-stage contract. */
  readonly main: (
    name: K,
  ) => Either.Either<TransactionUnspentOutput, UtxoNotFound>;
}

/** UTxOs at every contract address, by name, queried in parallel. */
export const contractUtxos = <K extends string>(
  contracts: Record<K, Script>,
  networkId: NetworkId,
): Effect.Effect<ContractUtxos<K>, ProviderError | ConfigError, Provider> =>
  Effect.flatMap(Provider, (provider) => {
    const queries: Record<
      string,
      Effect.Effect<TransactionUnspentOutput[], ProviderError | ConfigError>
    > = Record.map(contracts, (script) =>
      provider.unspentOutputs(addressFromValidator(networkId, script)),
    );
    return Effect.map(
      Effect.all(queries, { concurrency: "unbounded" }),
      (utxos): ContractUtxos<K> => ({
        at: (name) => utxos[name],
        first: (name) => firstUtxo(utxos[name], contracts[name], networkId),
        main: (name) => mainUtxo(utxos[name], contracts[name], networkId),
      }),
    );
  });

/** The deployer's address (Settings) and its UTxO with this reference, which carries no reference script. */
export const deployerUtxo = (
  txHash: TxHash,
  txIndex: TxIndex,
): Effect.Effect<
  { readonly address: Address; readonly utxo: TransactionUnspentOutput },
  ConfigError | ProviderError | UtxoNotFound | InputParseError,
  Settings | Provider
> =>
  Effect.gen(function* () {
    const address = yield* Effect.flatMap(
      Settings,
      (settings) => settings.deployerAddress,
    );
    const utxos = yield* Effect.flatMap(Provider, (provider) =>
      provider.unspentOutputs(address),
    );
    const utxo = yield* Either.fromNullable(
      findUtxoByTxRef(utxos, txHash, txIndex),
      () => UtxoNotFound.byRef(`${txHash}#${txIndex}`, address.toBech32()),
    );
    const script = utxo.output().scriptRef();
    if (script !== undefined) {
      return yield* new InputParseError({
        source: "--tx-hash/--tx-index",
        issues: [
          `${txHash}#${txIndex} carries reference script ${script.hash()}; the CLI never spends a reference script, so pick another fee UTxO`,
        ],
      });
    }
    return { address, utxo };
  });

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

/** The first UTxO at the script, or UtxoNotFound at its address. */
const firstUtxo = (
  utxos: readonly TransactionUnspentOutput[],
  script: Script,
  networkId: NetworkId,
) =>
  Either.fromNullable(utxos[0], () =>
    UtxoNotFound.at(addressFromValidator(networkId, script).toBech32()),
  );

/** The UTxO holding the main NFT of a two-stage script, or UtxoNotFound at its address. */
const mainUtxo = (
  utxos: readonly TransactionUnspentOutput[],
  twoStage: Script,
  networkId: NetworkId,
) =>
  Either.fromNullable(findMainUtxo(utxos, twoStage.hash()), () =>
    UtxoNotFound.holding(
      addressFromValidator(networkId, twoStage).toBech32(),
      `${twoStage.hash()}.main`,
    ),
  );

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

const parseUpgradeState = (data: PlutusData) =>
  parse(Contracts.UpgradeState, data);

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
  decodeInlineDatum(utxo, "UpgradeState", parseUpgradeState);

/** The UpgradeState in a two-stage UTxO's inline datum. */
export const upgradeStateAt = (
  utxo: TransactionUnspentOutput,
): Either.Either<UpgradeState, DatumParseError> =>
  Either.map(rawUpgradeStateAt(utxo), upgradeStateOf);

/** The current signers in a multisig authority's forever UTxO. */
export const signersAt = (
  utxo: TransactionUnspentOutput,
): Either.Either<Signers, DatumParseError> =>
  Either.flatMap(inlineDatum(utxo, "VersionedMultisig"), decodeSigners);

/** The fractions of a threshold UTxO's MultisigThreshold datum, each checked. */
export const thresholdAt = (
  utxo: TransactionUnspentOutput,
): Either.Either<AuthorityThreshold, DatumParseError> =>
  Either.flatMap(inlineDatum(utxo, "MultisigThreshold"), (data) =>
    Either.flatMap(
      decodeDatum(data, "MultisigThreshold", (d) =>
        parse(Contracts.MultisigThreshold, d),
      ),
      (datum) =>
        Either.mapLeft(
          authorityThreshold(datum),
          (reason) =>
            new DatumParseError({
              what: "MultisigThreshold",
              cbor: data.toCbor(),
              reason,
            }),
        ),
    ),
  );

/** The part of Blockfrost's `/accounts/{stake_address}` answer read here; a deregistered account also answers, with `registered: false`. */
const BlockfrostAccount = Schema.Struct({ registered: Schema.Boolean });

/** Whether Blockfrost reports a reward account registered; None where no chain can be queried (local, emulator). */
export const registrationOnChain = (
  rewardAccount: RewardAccount,
  environment: Environment,
): Effect.Effect<
  Option.Option<boolean>,
  ConfigError | ProviderError,
  Settings | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const network = publicNetworkOf(environment);
    if (Option.isNone(network)) return Option.none();
    const access = yield* blockfrostAccessTo(network.value);
    const account = yield* blockfrostGet(
      access.baseUrl,
      access.apiKey,
      `/accounts/${rewardAccount}`,
      BlockfrostAccount,
    ).pipe(
      Effect.catchIf(
        (error) => error.status === 401 || error.status === 403,
        (error) =>
          Effect.fail(
            new ConfigError({
              source: "env",
              key: blockfrostApiKeyVariable(access.cardanoNetwork),
              reason: `Blockfrost auth error (${error.status}) checking reward account ${rewardAccount}`,
            }),
          ),
      ),
    );
    return Option.some(Option.exists(account, (a) => a.registered));
  });

/** Whether a reward account is registered on chain; local and emulator count as registered. */
export const rewardAccountRegistered = (
  rewardAccount: RewardAccount,
  environment: Environment,
): Effect.Effect<
  boolean,
  ConfigError | ProviderError,
  Settings | HttpClient.HttpClient
> =>
  Effect.map(
    registrationOnChain(rewardAccount, environment),
    Option.getOrElse(() => true),
  );

/** Every account must be registered; the failure lists the ones that are not. */
export const ensureRegistered = (
  accounts: readonly {
    label: string;
    rewardAccount: RewardAccount;
    scriptHash: string;
  }[],
  environment: Environment,
): Effect.Effect<
  void,
  ConfigError | ProviderError | StakeNotRegistered,
  Settings | HttpClient.HttpClient
> =>
  Effect.flatMap(
    Effect.all(
      accounts.map((account) =>
        Effect.map(
          rewardAccountRegistered(account.rewardAccount, environment),
          (registered) => ({
            ...account,
            registered,
          }),
        ),
      ),
      { concurrency: "unbounded" },
    ),
    (results) => {
      const unregistered = results.filter((r) => !r.registered);
      return unregistered.length === 0
        ? Effect.void
        : Effect.fail(
            new StakeNotRegistered({ environment, accounts: unregistered }),
          );
    },
  );
