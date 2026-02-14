import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "migrate-federated-ops",
  describe: "Migrate federated ops datum from v1 to v2",
  handler: notYetImplementedHandler,
};

export default command;
