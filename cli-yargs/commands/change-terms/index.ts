import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "change-terms",
  describe: "Change terms and conditions hash and URL",
  handler: notYetImplementedHandler,
};

export default command;
