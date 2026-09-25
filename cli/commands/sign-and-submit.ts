import { Args, Command } from "@effect/cli";
import { deployerSigning, network, provider } from "../options";
import { withProvider } from "../run";
import { signAndSubmitProgram } from "../chain/sign-and-submit";

const jsonFile = Args.text({ name: "json-file" }).pipe(
  Args.withDescription("Path to the JSON file containing transaction(s)"),
);

export const signAndSubmit = Command.make(
  "sign-and-submit",
  { network, provider, ...deployerSigning, jsonFile },
  signAndSubmitProgram,
).pipe(
  Command.withDescription("Sign and submit transactions from a JSON file"),
  withProvider,
);
