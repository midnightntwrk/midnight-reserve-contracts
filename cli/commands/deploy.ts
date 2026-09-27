import { Command, Options } from "@effect/cli";
import { network, outputDir, parsedText, provider } from "../options";
import { withServices } from "../run";
import { parseNameList } from "../input";
import { parseThreshold } from "../governance/threshold";
import {
  DEFAULT_DEPLOY_COMPONENTS,
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
    `Comma-separated components to deploy: ${DEPLOY_COMPONENTS.join(", ")} (default: the governance ones, ${DEFAULT_DEPLOY_COMPONENTS.join(", ")}; a full run)`,
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
    bridgeThreshold: threshold(DEPLOY_THRESHOLDS.bridgeThreshold),
    components,
  },
  deployProgram,
).pipe(
  Command.withDescription("Generate deployment transactions"),
  withServices("build"),
);
