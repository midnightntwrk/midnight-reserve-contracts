import { Command, Options } from "@effect/cli";
import {
  governanceTxOptions,
  outputDir,
  parsedText,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { parseHash32 } from "../input";
import { termsChangeProgram } from "../governance/change-terms";

const hash = parsedText("hash", parseHash32).pipe(
  Options.withDescription(
    "New terms and conditions hash (64 hex chars, 32 bytes SHA-256)",
  ),
);

const url = Options.text("url").pipe(
  Options.withDescription("New terms and conditions URL (plain text)"),
);

export const changeTerms = Command.make(
  "change-terms",
  governanceTxOptions("change-terms", { useBuild, outputDir }, { hash, url }),
  termsChangeProgram,
).pipe(
  Command.withDescription("Change terms and conditions hash and URL"),
  withServicesUseBuild,
);
