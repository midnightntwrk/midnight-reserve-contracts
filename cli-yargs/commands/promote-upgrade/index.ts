import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "promote-upgrade",
  describe: "Promote staged logic to main for a two-stage upgrade validator",
  handler: notYetImplementedHandler,
};

export default command;
