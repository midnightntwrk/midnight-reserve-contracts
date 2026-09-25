import { Command, Options } from "@effect/cli";
import { network, outputDir, parsedText, provider } from "../options";
import { withServices } from "../run";
import { parseNameList } from "../input";
import {
  deployStagingTrackProgram,
  STAGING_TRACK_COMPONENTS,
} from "../deploy/staging-track";

const components = parsedText(
  "components",
  parseNameList(STAGING_TRACK_COMPONENTS),
).pipe(
  Options.withDescription(
    `Comma-separated staging track components to deploy: ${STAGING_TRACK_COMPONENTS.join(", ")} (default: every one)`,
  ),
  Options.optional,
);

// Always the build blueprint: the staging forever validators are not deployed yet.
export const deployStagingTrack = Command.make(
  "deploy-staging-track",
  { network, provider, outputDir, components },
  deployStagingTrackProgram,
).pipe(
  Command.withDescription("Generate staging track deployment transactions"),
  withServices("build"),
);
