import { Command } from "@effect/cli";
import { network, outputDir, outputFile, provider, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { rewardsReleaseProgram } from "../rewards/release";

export const rewardsRelease = Command.make(
  "rewards-release",
  {
    network,
    provider,
    useBuild,
    outputDir,
    outputFile: outputFile("rewards-release.json"),
  },
  rewardsReleaseProgram,
).pipe(
  Command.withDescription(
    "Build the reserve's release into the rewards pool for the elapsed intervals (unsigned)",
  ),
  withServicesUseBuild,
);
