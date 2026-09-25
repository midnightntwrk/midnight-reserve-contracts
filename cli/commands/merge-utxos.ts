import { Command, Options } from "@effect/cli";
import {
  feeUtxo,
  network,
  outputDir,
  outputFile,
  parsedText,
  provider,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { parseTxHash, parseTxIndex } from "../input";
import { mergeUtxosProgram } from "../governance/merge-utxos";

const validator = Options.choice("validator", ["reserve", "ics"]).pipe(
  Options.withDescription("Forever validator family: reserve or ics"),
);

const utxoHash = (n: 1 | 2, which: string) =>
  parsedText(`utxo${n}-hash`, parseTxHash).pipe(
    Options.withDescription(`Transaction hash of the ${which} UTxO to merge`),
  );

const utxoIndex = (n: 1 | 2, which: string) =>
  parsedText(`utxo${n}-index`, parseTxIndex).pipe(
    Options.withDescription(`Output index of the ${which} UTxO to merge`),
  );

export const mergeUtxos = Command.make(
  "merge-utxos",
  {
    network,
    provider,
    useBuild,
    outputDir,
    validator,
    utxo1Hash: utxoHash(1, "first"),
    utxo1Index: utxoIndex(1, "first"),
    utxo2Hash: utxoHash(2, "second"),
    utxo2Index: utxoIndex(2, "second"),
    ...feeUtxo,
    outputFile: outputFile("merge-utxos-tx.json"),
  },
  mergeUtxosProgram,
).pipe(
  Command.withDescription(
    "Merge two value-holding UTxOs at a forever validator into one",
  ),
  withServicesUseBuild,
);
