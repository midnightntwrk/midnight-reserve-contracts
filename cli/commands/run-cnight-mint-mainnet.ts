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
import { runCnightMintProgram } from "../governance/run-cnight-mint";

export const runCnightMintMainnet = Command.make(
  "run-cnight-mint-mainnet",
  {
    network,
    provider,
    useBuild,
    outputDir,
    ...feeUtxo,
    outputFile: outputFile("run-cnight-mint-mainnet-tx.json"),
  },
  runCnightMintProgram,
).pipe(
  Command.withDescription("Run the cNIGHT mint forever and logic withdrawals"),
  withServicesUseBuild,
);
