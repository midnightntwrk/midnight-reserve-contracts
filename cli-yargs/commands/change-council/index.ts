import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "change-council",
  describe: "Update council multisig members",
  handler: notYetImplementedHandler,
};

export default command;
