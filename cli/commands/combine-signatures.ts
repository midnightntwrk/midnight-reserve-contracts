import { Args, Command, Options } from "@effect/cli";
import { deployerSigning, network, provider } from "../options";
import { withProvider } from "../run";
import { combineSignaturesProgram } from "../chain/combine-signatures";

const tx = Options.text("tx").pipe(
  Options.withDescription("Transaction file that holds one transaction"),
);

const witnessFiles = Args.text({ name: "witness-file" }).pipe(
  Args.withDescription(
    "Witness files: cardano-cli key witnesses or CIP-30 witness sets",
  ),
  Args.atLeast(1),
);

export const combineSignatures = Command.make(
  "combine-signatures",
  { network, provider, ...deployerSigning, tx, witnessFiles },
  combineSignaturesProgram,
).pipe(
  Command.withDescription(
    "Combine wallet signatures into a single transaction and submit",
  ),
  withProvider,
);
