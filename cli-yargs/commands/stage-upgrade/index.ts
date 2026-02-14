import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "stage-upgrade",
  describe: "Stage a new logic hash for a two-stage upgrade validator",
  handler: notYetImplementedHandler,
};

export default command;
