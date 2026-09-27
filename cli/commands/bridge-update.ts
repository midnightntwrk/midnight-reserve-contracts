import { Command, Options } from "@effect/cli";
import { network, outputDir, outputFile, provider, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { bridgeUpdateProgram } from "../bridge/update";

const update = Options.text("update").pipe(
  Options.withDescription(
    "BridgeUpdate JSON file: the blueprint field names, integers as numbers, lower-case hex bytes, the multiproof as CBOR hex",
  ),
);

const funded = Options.boolean("funded").pipe(
  Options.withDescription(
    "Spend the pool: a handover's fee, up to the threshold's cap, is paid from the pool",
  ),
);

export const bridgeUpdate = Command.make(
  "bridge-update",
  {
    network,
    provider,
    useBuild,
    outputDir,
    update,
    funded,
    outputFile: outputFile("bridge-update.json"),
  },
  bridgeUpdateProgram,
).pipe(
  Command.withDescription(
    "Build a committee bridge light-client update from a BridgeUpdate file",
  ),
  withServicesUseBuild,
);
