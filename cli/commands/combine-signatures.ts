import { Args, Command, Options } from "@effect/cli";
import { deployerSigning, network, provider } from "../options";
import { withProvider } from "../run";
import { combineSignaturesProgram } from "../chain/combine-signatures";

const tx = Options.text("tx").pipe(
  Options.withDescription(
    "Path to the transaction file; it holds exactly one transaction (for a deployment file, use sign-and-submit)",
  ),
);

const witnessFiles = Args.text({ name: "witness-file" }).pipe(
  Args.withDescription(
    "Witness files: a cardano-cli TextEnvelope key witness ([0, [vkey, sig]] or [vkey, sig]) or a CIP-30 witness set as CBOR hex",
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
