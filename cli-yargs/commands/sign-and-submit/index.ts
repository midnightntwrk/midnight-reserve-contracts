import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "sign-and-submit",
  describe: "Sign and submit transactions from a JSON file",
  handler: notYetImplementedHandler,
};

export default command;
