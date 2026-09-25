import { Command } from "@effect/cli";
import { network, provider } from "../options";
import { withProvider } from "../run";
import { verifyProgram } from "../report/verify";

export const verify = Command.make(
  "verify",
  { network, provider },
  verifyProgram,
).pipe(
  Command.withDescription(
    "Verify the deployed record (deployed-scripts/<env>/) against the unspent outputs on chain",
  ),
  withProvider,
);
