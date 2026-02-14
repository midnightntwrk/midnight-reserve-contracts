import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "deploy",
  describe: "Generate deployment transactions",
  handler: notYetImplementedHandler,
};

export default command;
