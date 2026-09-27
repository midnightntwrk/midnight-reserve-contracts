import { Command } from "@effect/cli";
import { network, provider, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { bridgeInfoProgram } from "../bridge/info";

export const bridgeInfo = Command.make(
  "bridge-info",
  { network, provider, useBuild },
  bridgeInfoProgram,
).pipe(
  Command.withDescription(
    "Show the committee bridge: light-client state, threshold, pool and reference scripts",
  ),
  withServicesUseBuild,
);
