import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "simple-tx",
  describe: "Create simple transactions for testing",
  handler: notYetImplementedHandler,
};

export default command;
