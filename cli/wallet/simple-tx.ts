/**
 * simple-tx: `count` payments of `amount` lovelace to one address, built
 * (never submitted) and written to a file. The builder is pure over the
 * parsed inputs. --count and --amount fall back to SIMPLE_TX_COUNT and
 * SIMPLE_TX_AMOUNT through their options; the recipient falls back to
 * DEPLOYER_ADDRESS through Settings.
 */
import type { Address } from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Either, Option } from "effect";
import { formatLovelaceToAda, Output } from "../output";
import { writeTransaction } from "../chain/tx-file";
import { buildTx } from "../chain/complete-tx";
import {
  addressOn,
  type KeyAddress,
  parsePositiveBigInt,
  parsePositiveInteger,
  type TxFileInput,
  txFilePath,
} from "../input";
import { envFallback, Settings } from "../config/settings";
import { Provider } from "../chain/provider";
import { InputParseError } from "../errors";
import { DEPLOYER_ONLY } from "../chain/transaction";

/** SIMPLE_TX_COUNT, the --count fallback: 16 when unset. */
export const SIMPLE_TX_COUNT = envFallback(
  "SIMPLE_TX_COUNT",
  parsePositiveInteger,
  16,
);

/** SIMPLE_TX_AMOUNT in lovelace, the --amount fallback: 20 ADA when unset. */
export const SIMPLE_TX_AMOUNT = envFallback(
  "SIMPLE_TX_AMOUNT",
  parsePositiveBigInt,
  20_000_000n,
);

/** The payments to build and where the file goes; an absent recipient is the deployer. */
export interface SimpleTxInput extends TxFileInput {
  readonly count: number;
  readonly amount: bigint;
  readonly to: Option.Option<KeyAddress>;
}

/** The recipient and the payments to it. */
export interface SimpleTxInputs {
  readonly recipient: Address;
  readonly count: number;
  readonly amount: bigint;
}

/** `count` outputs of `amount` lovelace to one address. */
export const buildSimpleTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: SimpleTxInputs,
): TxBuilder => {
  const builder = blaze.newTransaction();
  for (let i = 0; i < inputs.count; i++)
    builder.payLovelace(inputs.recipient, inputs.amount);
  return builder;
};

/** Build (never submit) one transaction paying the deployer or --to several times, and write it to a file. */
export const simpleTxProgram = (input: SimpleTxInput) =>
  Effect.gen(function* () {
    const { network } = input;
    const config = yield* Settings;
    const out = yield* Output;
    const { count, amount } = input;
    const outputPath = txFilePath(input);
    const recipient = Option.isNone(input.to)
      ? yield* config.deployerAddress
      : yield* Either.mapLeft(
          addressOn(input.to.value, network),
          (issue) => new InputParseError({ source: "--to", issues: [issue] }),
        );

    yield* out.log(`\nGenerating simple transaction on ${network} network`);
    yield* out.log(`Creating ${count} outputs of ${amount} lovelace each`);
    yield* out.log(`Recipient: ${recipient.toBech32()}`);

    const blaze = yield* Effect.flatMap(Provider, (p) => p.blaze);
    const tx = yield* buildTx(
      buildSimpleTx(blaze, { recipient, count, amount }),
      {
        commandName: "simple-tx",
        environment: network,
        witnesses: DEPLOYER_ONLY,
      },
    );

    yield* out.log("\nTransaction details:");
    yield* out.log(`  - Outputs: ${count}`);
    yield* out.log(`  - Amount per output: ${formatLovelaceToAda(amount)} ADA`);
    yield* out.log(
      `  - Total sent: ${formatLovelaceToAda(amount * BigInt(count))} ADA\n`,
    );
    yield* writeTransaction(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      "Simple Transaction",
    );
    return { tx, outputPath };
  });
