import { Command, Options } from "@effect/cli";
import { parseBlockNumber } from "../datum/bridge";
import {
  network,
  outputDir,
  outputFile,
  parseWith,
  provider,
  rpc,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { bridgeFetchJustificationProgram } from "../bridge/fetch-justification";

const block = parseWith(
  "block",
  parseBlockNumber,
)(Options.text("block")).pipe(
  Options.withDescription(
    "The Midnight block whose BEEFY justification the update proves",
  ),
);

export const bridgeFetchJustification = Command.make(
  "bridge-fetch-justification",
  {
    network,
    provider,
    useBuild,
    rpc,
    block,
    outputDir,
    outputFile: outputFile("bridge-justification.json"),
  },
  bridgeFetchJustificationProgram,
).pipe(
  Command.withDescription(
    "Write the BridgeUpdate of a Midnight block's BEEFY justification, for bridge-update",
  ),
  withServicesUseBuild,
);
