import { Command } from "@effect/cli";
import { network, outputDir, outputFile, provider, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { registerGovAuthProgram } from "../governance/register-stake";

export const registerGovAuth = Command.make(
  "register-gov-auth",
  {
    network,
    provider,
    useBuild,
    outputDir,
    outputFile: outputFile("register-gov-auth-tx.json"),
  },
  registerGovAuthProgram,
).pipe(
  Command.withDescription(
    "Register main and staging gov auth scripts as stake credentials",
  ),
  withServicesUseBuild,
);
