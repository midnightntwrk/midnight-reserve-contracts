import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "generate-key",
  describe: "Generate a new signing key and Cardano address",
  handler: notYetImplementedHandler,
};

export default command;
