import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "register-gov-auth",
  describe: "Register main and staging gov auth scripts as stake credentials",
  handler: notYetImplementedHandler,
};

export default command;
