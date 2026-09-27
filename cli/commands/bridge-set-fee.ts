import { Command, Options } from "@effect/cli";
import {
  governanceTxOptions,
  outputDir,
  parsedText,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { parseLovelace } from "../datum/bridge";
import { bridgeSetFeeProgram } from "../bridge/set-threshold";

const base = parsedText("base", parseLovelace).pipe(
  Options.withDescription("Fee cap base in lovelace (max_fee.base)"),
);

const perSigner = parsedText("per-signer", parseLovelace).pipe(
  Options.withDescription(
    "Fee cap per signer in lovelace (max_fee.per_signer)",
  ),
);

export const bridgeSetFee = Command.make(
  "bridge-set-fee",
  governanceTxOptions(
    "bridge-set-fee",
    { useBuild, outputDir },
    { base, perSigner },
  ),
  bridgeSetFeeProgram,
).pipe(
  Command.withDescription(
    "Change the committee bridge fee cap under Council + Tech Auth",
  ),
  withServicesUseBuild,
);
