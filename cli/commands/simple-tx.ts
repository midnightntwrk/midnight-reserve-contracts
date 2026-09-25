import { Command, Options } from "@effect/cli";
import {
  network,
  outputDir,
  outputFile,
  parsedText,
  provider,
} from "../options";
import { withProvider } from "../run";
import {
  parseKeyAddress,
  parsePositiveBigInt,
  parsePositiveInteger,
} from "../input";
import {
  SIMPLE_TX_AMOUNT,
  SIMPLE_TX_COUNT,
  simpleTxProgram,
} from "../wallet/simple-tx";

const count = parsedText("count", parsePositiveInteger).pipe(
  Options.withAlias("c"),
  Options.withDescription(
    "Number of outputs to create (default: SIMPLE_TX_COUNT, else 16)",
  ),
  Options.withFallbackConfig(SIMPLE_TX_COUNT),
);

const amount = parsedText("amount", parsePositiveBigInt).pipe(
  Options.withDescription(
    "Lovelace amount per output, e.g. 100000000 = 100 ADA (default: SIMPLE_TX_AMOUNT, else 20 ADA)",
  ),
  Options.withFallbackConfig(SIMPLE_TX_AMOUNT),
);

const to = parsedText("to", parseKeyAddress).pipe(
  Options.withDescription(
    "Recipient key address, not a script (default: DEPLOYER_ADDRESS)",
  ),
  Options.optional,
);

export const simpleTx = Command.make(
  "simple-tx",
  {
    network,
    provider,
    outputDir,
    count,
    amount,
    to,
    outputFile: outputFile("simple-tx.json"),
  },
  simpleTxProgram,
).pipe(
  Command.withDescription("Create simple transactions for testing"),
  withProvider,
);
