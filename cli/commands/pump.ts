import { Command, Options } from "@effect/cli";
import { Duration } from "effect";
import { deployerSigning, network, provider, rpc, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { pumpProgram } from "../bridge/pump";

const poll = Options.integer("poll").pipe(
  Options.withDescription(
    "Seconds to wait when there is nothing to hand over or a round failed (default: 10)",
  ),
  Options.withDefault(10),
  Options.map(Duration.seconds),
);

export const pump = Command.make(
  "pump",
  {
    network,
    provider,
    useBuild,
    rpc,
    signingKey: deployerSigning.signingKey,
    poll,
  },
  pumpProgram,
).pipe(
  Command.withDescription(
    "Run the data pump: land each committee bridge handover, oldest first, signed with the deployer key",
  ),
  withServicesUseBuild,
);
