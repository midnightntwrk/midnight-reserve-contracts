import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "mint-staging-state",
  describe: "Mint StagingState NFT for a v2 logic contract",
  handler: notYetImplementedHandler,
};

export default command;
