import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "verify",
  describe: "Verify on-chain deployment against local artifacts",
  handler: notYetImplementedHandler,
};

export default command;
