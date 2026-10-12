/**
 * buildTx: completion of a hand-built TxBuilder for the commands not yet on
 * plan/compile. Deleted in phase 08 with its last caller.
 */
import type { TransactionUnspentOutput } from "@blaze-cardano/core";
import type { TxBuilder } from "@blaze-cardano/sdk";
import { Effect, Option } from "effect";
import { type Environment, slotConfigOf } from "../config/network-mapping";
import { Blueprint } from "../contracts/contracts";
import { completeChecked } from "./compile";

/** What buildTx needs beyond the builder. */
interface BuildTxOptions {
  readonly commandName: string;
  readonly environment: Environment;
  /** Inputs the draft spends or references; enables the local UPLC phase. */
  readonly knownUtxos?: readonly TransactionUnspentOutput[];
  /** The vkey witnesses the transaction carries at submit (witnessCount), counted in its size. */
  readonly witnesses: number;
}

/** Complete the builder through completeChecked, the slot configuration of `environment` and, when a Blueprint is provided, its contracts as validator labels. */
export const buildTx = (txBuilder: TxBuilder, options: BuildTxOptions) =>
  completeChecked(txBuilder, {
    commandName: options.commandName,
    slotConfig: slotConfigOf(options.environment),
    knownUtxos: options.knownUtxos ?? [],
    witnesses: options.witnesses,
    contracts: Effect.flatMap(
      Effect.serviceOption(Blueprint),
      Option.match({
        onNone: () => Effect.succeed([]),
        onSome: (blueprint) => blueprint.contracts,
      }),
    ),
  });
