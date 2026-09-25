import { Command, Options } from "@effect/cli";
import { governanceTxOptions, outputDir, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { UPGRADABLE_VALIDATORS } from "../contracts/contracts";
import { promoteUpgradeProgram } from "../governance/two-stage-upgrade";

const validator = Options.choice("validator", UPGRADABLE_VALIDATORS).pipe(
  Options.withAlias("v"),
  Options.withDescription("Validator to promote"),
);

export const promoteUpgrade = Command.make(
  "promote-upgrade",
  governanceTxOptions("promote-upgrade", { useBuild, outputDir, validator }),
  promoteUpgradeProgram,
).pipe(
  Command.withDescription(
    "Promote staged logic to main for a two-stage upgrade validator",
  ),
  withServicesUseBuild,
);
