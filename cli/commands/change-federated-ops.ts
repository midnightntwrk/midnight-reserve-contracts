import { Command } from "@effect/cli";
import { governanceTxOptions, outputDir, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { federatedOpsChangeProgram } from "../governance/change-federated-ops";

export const changeFederatedOps = Command.make(
  "change-federated-ops",
  governanceTxOptions("change-federated-ops", { useBuild, outputDir }),
  federatedOpsChangeProgram,
).pipe(
  Command.withDescription("Update federated ops members"),
  withServicesUseBuild,
);
