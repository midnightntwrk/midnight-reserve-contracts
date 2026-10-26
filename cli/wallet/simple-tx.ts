/**
 * simple-tx: `count` payments of `amount` lovelace to one address, built
 * (never submitted) and written to a file. The plan is pure over the
 * parsed inputs and has no spends: coin selection funds it, so there is no
 * local UPLC check. --count and --amount fall back to SIMPLE_TX_COUNT and
 * SIMPLE_TX_AMOUNT through their options; the recipient falls back to
 * DEPLOYER_ADDRESS.
 */
import { type Address, TransactionOutput, Value } from "@blaze-cardano/core";
import { Effect, Either, Option } from "effect";
import { formatLovelaceToAda, Output } from "../output";
import { writeTransaction } from "../signing/tx-file";
import { compile } from "../tx/compile";
import type { TxPlan } from "../tx/plan";
import {
  addressOn,
  type KeyAddress,
  parsePositiveBigInt,
  parsePositiveInteger,
  type TxFileInput,
  txFilePath,
} from "../input";
import { envFallback } from "../config/env";
import { DeployerAddress } from "../config/deployer";
import { slotConfigOf } from "../config/network-mapping";
import { deployerWallet } from "../chain/utxo";
import { InputParseError } from "../errors";
import { DEPLOYER_ONLY } from "../signing/signer";

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

/** `count` outputs of `amount` lovelace to one address; Blaze raises each to its min ADA. */
export const planSimpleTx = (inputs: SimpleTxInputs): TxPlan => ({
  spends: [],
  references: [],
  scripts: [],
  mints: [],
  outputs: Array.from(
    { length: inputs.count },
    () => new TransactionOutput(inputs.recipient, new Value(inputs.amount)),
  ),
  withdrawals: [],
  registrations: [],
  collateral: [],
  requiredSignatures: 0,
});

/** Build (never submit) one transaction paying the deployer or --to several times, and write it to a file. */
export const simpleTxProgram = (input: SimpleTxInput) =>
  Effect.gen(function* () {
    const { network } = input;
    const out = yield* Output;
    const { count, amount } = input;
    const outputPath = txFilePath(input);
    const recipient = Option.isNone(input.to)
      ? yield* DeployerAddress.address
      : yield* Either.mapLeft(
          addressOn(input.to.value, network),
          (issue) => new InputParseError({ source: "--to", issues: [issue] }),
        );

    yield* out.log(`\nGenerating simple transaction on ${network} network`);
    yield* out.log(`Creating ${count} outputs of ${amount} lovelace each`);
    yield* out.log(`Recipient: ${recipient.toBech32()}`);

    const wallet = yield* deployerWallet;
    const tx = yield* compile(planSimpleTx({ recipient, count, amount }), {
      commandName: "simple-tx",
      slotConfig: slotConfigOf(network),
      wallet,
      changeAddress: wallet.address,
      feePadding: 0n,
      metadata: Option.none(),
      expectedWitnesses: DEPLOYER_ONLY,
      contracts: [],
    });

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
