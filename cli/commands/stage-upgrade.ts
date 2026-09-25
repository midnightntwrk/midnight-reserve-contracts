import { Command, Options } from "@effect/cli";
import { governanceTxOptions, outputDir, parsedText } from "../options";
import { withServices } from "../run";
import { parseScriptHash } from "../input";
import { UPGRADABLE_VALIDATORS } from "../contracts/contracts";
import { stageUpgradeProgram } from "../governance/two-stage-upgrade";

const validator = Options.choice("validator", UPGRADABLE_VALIDATORS).pipe(
  Options.withAlias("v"),
  Options.withDescription("Validator to upgrade"),
);

const newLogicHash = parsedText("new-logic-hash", parseScriptHash).pipe(
  Options.withDescription(
    "New logic script hash to stage (56 hex chars, 28 bytes)",
  ),
);

export const stageUpgrade = Command.make(
  "stage-upgrade",
  governanceTxOptions("stage-upgrade", {
    outputDir,
    validator,
    newLogicHash,
  }),
  stageUpgradeProgram,
).pipe(
  Command.withDescription(
    "Stage a new logic hash for a two-stage upgrade validator",
  ),
  withServices("deployed"),
);
