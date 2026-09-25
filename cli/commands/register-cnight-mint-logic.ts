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
import { registerCnightMintLogicProgram } from "../governance/register-stake";

export const registerCnightMintLogic = Command.make(
  "register-cnight-mint-logic",
  {
    network,
    provider,
    useBuild,
    outputDir,
    ...feeUtxo,
    outputFile: outputFile("register-cnight-mint-logic-tx.json"),
  },
  registerCnightMintLogicProgram,
).pipe(
  Command.withDescription(
    "Register cNIGHT mint logic script as a stake credential",
  ),
  withServicesUseBuild,
);
