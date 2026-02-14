import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "change-federated-ops",
  describe: "Update federated ops members",
  handler: notYetImplementedHandler,
};

export default command;
