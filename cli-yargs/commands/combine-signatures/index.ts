import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "combine-signatures",
  describe: "Combine wallet signatures and submit transactions",
  handler: notYetImplementedHandler,
};

export default command;
