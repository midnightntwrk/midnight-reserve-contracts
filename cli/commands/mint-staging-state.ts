import { Command, Options } from "@effect/cli";
import {
  feePadding,
  network,
  outputDir,
  outputFile,
  provider,
  sign,
} from "../options";
import { withServices } from "../run";
import { V2_TRACK_VALIDATORS } from "../governance/two-stage-upgrade";
import { mintStagingStateProgram } from "../governance/mint-staging-state";

const validator = Options.choice("validator", V2_TRACK_VALIDATORS).pipe(
  Options.withAlias("v"),
  Options.withDescription("Validator to mint StagingState NFT for"),
);

// v2 logic contracts are only in the build blueprint until they are promoted
export const mintStagingState = Command.make(
  "mint-staging-state",
  {
    network,
    provider,
    outputDir,
    validator,
    feePadding,
    sign: sign("TECH_AUTH_PRIVATE_KEYS"),
    outputFile: outputFile("mint-staging-state-tx.json"),
  },
  mintStagingStateProgram,
).pipe(
  Command.withDescription("Mint StagingState NFT for a v2 logic contract"),
  withServices("build"),
);
