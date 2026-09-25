import { Command } from "@effect/cli";
import { governanceTxOptions, outputDir, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import {
  changeCouncilConfig,
  multisigChangeProgram,
} from "../governance/change-multisig";

export const changeCouncil = Command.make(
  "change-council",
  governanceTxOptions("change-council", { useBuild, outputDir }),
  (input) => multisigChangeProgram(changeCouncilConfig, input),
).pipe(
  Command.withDescription("Update council multisig members"),
  withServicesUseBuild,
);
