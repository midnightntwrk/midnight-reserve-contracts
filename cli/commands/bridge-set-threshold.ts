import { Command, Options } from "@effect/cli";
import {
  governanceTxOptions,
  outputDir,
  parsedText,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { parseThreshold } from "../governance/threshold";
import { bridgeSetThresholdProgram } from "../bridge/set-threshold";

const threshold = parsedText("threshold", parseThreshold).pipe(
  Options.withDescription(
    "Committee bridge signer threshold as numerator/denominator, e.g. 2/3",
  ),
);

export const bridgeSetThreshold = Command.make(
  "bridge-set-threshold",
  governanceTxOptions(
    "bridge-set-threshold",
    { useBuild, outputDir },
    { threshold },
  ),
  bridgeSetThresholdProgram,
).pipe(
  Command.withDescription(
    "Change the committee bridge signer threshold under Council + Tech Auth",
  ),
  withServicesUseBuild,
);
