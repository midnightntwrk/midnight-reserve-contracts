import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "deploy-staging-track",
  describe: "Deploy staging track forever validators",
  handler: notYetImplementedHandler,
};

export default command;
