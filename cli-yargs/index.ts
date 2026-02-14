#!/usr/bin/env bun

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import deployCommand from "./commands/deploy";
import deployStagingTrackCommand from "./commands/deploy-staging-track";
import changeCouncilCommand from "./commands/change-council";
import changeTechAuthCommand from "./commands/change-tech-auth";
import changeFederatedOpsCommand from "./commands/change-federated-ops";
import migrateFederatedOpsCommand from "./commands/migrate-federated-ops";
import mintStagingStateCommand from "./commands/mint-staging-state";
import simpleTxCommand from "./commands/simple-tx";
import infoCommand from "./commands/info";
import verifyCommand from "./commands/verify";
import stageUpgradeCommand from "./commands/stage-upgrade";
import promoteUpgradeCommand from "./commands/promote-upgrade";
import registerGovAuthCommand from "./commands/register-gov-auth";
import generateKeyCommand from "./commands/generate-key";
import signAndSubmitCommand from "./commands/sign-and-submit";
import combineSignaturesCommand from "./commands/combine-signatures";
import mintTcnightCommand from "./commands/mint-tcnight";
import changeTermsCommand from "./commands/change-terms";
import { addGlobalOptions } from "./lib/global-options";

addGlobalOptions(yargs(hideBin(process.argv)))
  .scriptName("midnight-reserve")
  .command(deployCommand)
  .command(deployStagingTrackCommand)
  .command(changeCouncilCommand)
  .command(changeTechAuthCommand)
  .command(changeFederatedOpsCommand)
  .command(migrateFederatedOpsCommand)
  .command(mintStagingStateCommand)
  .command(simpleTxCommand)
  .command(infoCommand)
  .command(verifyCommand)
  .command(stageUpgradeCommand)
  .command(promoteUpgradeCommand)
  .command(registerGovAuthCommand)
  .command(generateKeyCommand)
  .command(signAndSubmitCommand)
  .command(combineSignaturesCommand)
  .command(mintTcnightCommand)
  .command(changeTermsCommand)
  .demandCommand()
  .help()
  .strict()
  .parseSync();
