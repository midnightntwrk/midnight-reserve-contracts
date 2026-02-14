import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "info",
  describe: "Display contract information",
  handler: notYetImplementedHandler,
};

export default command;
