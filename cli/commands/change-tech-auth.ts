import { Command } from "@effect/cli";
import { governanceTxOptions, outputDir, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import {
  changeTechAuthConfig,
  multisigChangeProgram,
} from "../governance/change-multisig";

export const changeTechAuth = Command.make(
  "change-tech-auth",
  governanceTxOptions("change-tech-auth", { useBuild, outputDir }),
  (input) => multisigChangeProgram(changeTechAuthConfig, input),
).pipe(
  Command.withDescription("Update tech auth multisig members"),
  withServicesUseBuild,
);
