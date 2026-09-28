import { Command, Options } from "@effect/cli";
import {
  network,
  outputDir,
  outputFile,
  provider,
  rpc,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { rewardsBatchProgram } from "../rewards/load";

/** --limit: the most leaves a batch pays. */
export const limit = Options.integer("limit").pipe(
  Options.withDescription("The most leaves one batch pays (default: 10)"),
  Options.withDefault(10),
);

export const rewardsBatch = Command.make(
  "rewards-batch",
  {
    network,
    provider,
    useBuild,
    rpc,
    limit,
    outputDir,
    outputFile: outputFile("rewards-batch.json"),
  },
  rewardsBatchProgram,
).pipe(
  Command.withDescription(
    "Build the rewards batcher's next transaction: the next epoch's load, or the loaded epoch's next pay (unsigned)",
  ),
  withServicesUseBuild,
);
