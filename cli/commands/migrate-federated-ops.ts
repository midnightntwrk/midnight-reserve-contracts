import { Command } from "@effect/cli";
import {
  feeUtxo,
  network,
  outputDir,
  outputFile,
  provider,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { migrateFederatedOpsProgram } from "../governance/migrate-federated-ops";

export const migrateFederatedOps = Command.make(
  "migrate-federated-ops",
  {
    network,
    provider,
    useBuild,
    outputDir,
    ...feeUtxo,
    outputFile: outputFile("migrate-federated-ops-tx.json"),
  },
  migrateFederatedOpsProgram,
).pipe(
  Command.withDescription("Migrate federated ops datum from v1 to v2"),
  withServicesUseBuild,
);
