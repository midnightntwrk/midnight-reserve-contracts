import { Command, Options } from "@effect/cli";
import { format, network, provider, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { INFO_COMPONENT_CHOICES, infoProgram } from "../report/info";

const component = Options.choice("component", INFO_COMPONENT_CHOICES).pipe(
  Options.withDescription("Filter by component (default: all)"),
  Options.withDefault("all"),
);

const save = Options.boolean("save").pipe(
  Options.withDescription(
    "Fetch on-chain data and save JSON + markdown report to release directory",
  ),
);

const releaseDir = Options.text("release-dir").pipe(
  Options.withDescription(
    "Base directory for --save output (default: ./release)",
  ),
  Options.withDefault("./release"),
);

export const info = Command.make(
  "info",
  { network, provider, useBuild, format, component, save, releaseDir },
  infoProgram,
).pipe(
  Command.withDescription("Display contract information"),
  withServicesUseBuild,
);
