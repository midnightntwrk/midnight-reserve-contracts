import { Command, Options } from "@effect/cli";
import {
  network,
  outputDir,
  outputFile,
  parsedText,
  provider,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { parsePositiveBigInt } from "../input";
import { bridgeTopupProgram } from "../bridge/topup";

const lovelace = parsedText("lovelace", parsePositiveBigInt).pipe(
  Options.withDescription("Lovelace to pay the pool, e.g. 50000000 = 50 ADA"),
);

export const bridgeTopup = Command.make(
  "bridge-topup",
  {
    network,
    provider,
    useBuild,
    outputDir,
    lovelace,
    outputFile: outputFile("bridge-topup.json"),
  },
  bridgeTopupProgram,
).pipe(
  Command.withDescription("Pay lovelace to the committee bridge pool"),
  withServicesUseBuild,
);
