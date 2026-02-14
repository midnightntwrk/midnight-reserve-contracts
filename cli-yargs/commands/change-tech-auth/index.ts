import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "change-tech-auth",
  describe: "Update tech auth multisig members",
  handler: notYetImplementedHandler,
};

export default command;
