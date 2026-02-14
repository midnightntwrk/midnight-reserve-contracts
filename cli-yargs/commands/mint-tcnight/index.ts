import type { CommandModule } from "yargs";
import { notYetImplementedHandler } from "../../lib/not-yet-implemented";

const command: CommandModule = {
  command: "mint-tcnight",
  describe: "Mint or burn TCnight tokens (preview/preprod only)",
  handler: notYetImplementedHandler,
};

export default command;
