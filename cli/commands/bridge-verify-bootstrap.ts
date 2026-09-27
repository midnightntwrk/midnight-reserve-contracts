import { Command } from "@effect/cli";
import { network, provider, rpc, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { bridgeVerifyBootstrapProgram } from "../bridge/bootstrap";

export const bridgeVerifyBootstrap = Command.make(
  "bridge-verify-bootstrap",
  { network, provider, useBuild, rpc },
  bridgeVerifyBootstrapProgram,
).pipe(
  Command.withDescription(
    "Diff the deployed light client against its bootstrap recomputed from a Midnight node",
  ),
  withServicesUseBuild,
);
