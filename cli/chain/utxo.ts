/** UTxO references, lookup by reference, and the contract and deployer UTxOs through the Provider service. */
import {
  type Address,
  addressFromValidator,
  type NetworkId,
  type Script,
  type TransactionInput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect, Either, Record } from "effect";
import { DeployerAddress } from "../config/deployer";
import { findMainUtxo } from "../governance/two-stage";
import { type TxHash, type TxIndex, type TxRef, txRef } from "../input";
import { Provider } from "./provider";
import {
  type ConfigError,
  InputParseError,
  type ProviderError,
  UtxoNotFound,
} from "../errors";

/** A UTxO reference as `txId#index`. */
export const refOf = (input: TransactionInput): TxRef =>
  txRef(input.transactionId(), input.index());

/** The UTxO with this reference among `utxos`. */
export function findUtxoByTxRef(
  utxos: readonly TransactionUnspentOutput[],
  txHash: TxHash,
  txIndex: TxIndex,
): TransactionUnspentOutput | undefined {
  return utxos.find(
    (utxo) =>
      utxo.input().transactionId() === txHash &&
      utxo.input().index() === BigInt(txIndex),
  );
}

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

/** The deployer's address and its UTxO with this reference, which carries no reference script. */
export const deployerUtxo = (
  txHash: TxHash,
  txIndex: TxIndex,
): Effect.Effect<
  { readonly address: Address; readonly utxo: TransactionUnspentOutput },
  ConfigError | ProviderError | UtxoNotFound | InputParseError,
  DeployerAddress | Provider
> =>
  Effect.gen(function* () {
    const address = yield* DeployerAddress.address;
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
