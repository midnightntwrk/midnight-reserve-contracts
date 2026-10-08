import { Command, Options } from "@effect/cli";
import { network, outputDir, parsedText, provider } from "../options";
import { withServices } from "../run";
import { parseNameList } from "../input";
import { parseThreshold } from "../governance/threshold";
import {
  DEPLOY_COMPONENTS,
  DEPLOY_THRESHOLDS,
  deployProgram,
  type ThresholdSetting,
  thresholdConfig,
} from "../deploy/deploy";

const threshold = (setting: ThresholdSetting) =>
  parsedText(setting.option, parseThreshold).pipe(
    Options.withDescription(
      `${setting.what} threshold as numerator/denominator, e.g. 2/3 (default: ${setting.variable}, else ${setting.fallback.numerator}/${setting.fallback.denominator})`,
    ),
    Options.withFallbackConfig(thresholdConfig(setting)),
  );

const components = parsedText(
  "components",
  parseNameList(DEPLOY_COMPONENTS),
).pipe(
  Options.withDescription(
    `Components, comma-separated (default: all but cnight-minting): ${DEPLOY_COMPONENTS.join(", ")}`,
  ),
  Options.optional,
);

// Always the build blueprint: the contracts a deploy creates are not deployed yet.
export const deploy = Command.make(
  "deploy",
  {
    network,
    provider,
    outputDir,
    techAuthThreshold: threshold(DEPLOY_THRESHOLDS.techAuthThreshold),
    councilThreshold: threshold(DEPLOY_THRESHOLDS.councilThreshold),
    councilStagingThreshold: threshold(
      DEPLOY_THRESHOLDS.councilStagingThreshold,
    ),
    techAuthStagingThreshold: threshold(
      DEPLOY_THRESHOLDS.techAuthStagingThreshold,
    ),
    components,
  },
  deployProgram,
).pipe(
  Command.withDescription("Generate deployment transactions"),
  withServices("build"),
);
