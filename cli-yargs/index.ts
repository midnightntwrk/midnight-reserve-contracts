#!/usr/bin/env bun

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import deployCommand from "./commands/deploy";
import deployStagingTrackCommand from "./commands/deploy-staging-track";
import deployCnightMintingCommand from "./commands/deploy-cnight-minting";
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
import registerCnightMintLogicCommand from "./commands/register-cnight-mint-logic";
import runCnightMintMainnetCommand from "./commands/run-cnight-mint-mainnet";
import generateKeyCommand from "./commands/generate-key";
import signAndSubmitCommand from "./commands/sign-and-submit";
import combineSignaturesCommand from "./commands/combine-signatures";
import mintTcnightCommand from "./commands/mint-tcnight";
import changeTermsCommand from "./commands/change-terms";
import dustParticipantsCommand from "./commands/dust-participants";
import mergeUtxosCommand from "./commands/merge-utxos";
import buildCommand from "./commands/build";
import buildFromDeployedCommand from "./commands/build-from-deployed";
import { addGlobalOptions } from "./lib/global-options";
import packageJson from "../package.json";

const parser = addGlobalOptions(yargs(hideBin(process.argv)))
  .scriptName("midnight-reserve")
  .usage("$0 <command> [options]")
  .version(packageJson.version)
  .command(deployCommand)
  .command(deployStagingTrackCommand)
  .command(deployCnightMintingCommand)
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
  .command(registerCnightMintLogicCommand)
  .command(runCnightMintMainnetCommand)
  .command(generateKeyCommand)
  .command(signAndSubmitCommand)
  .command(combineSignaturesCommand)
  .command(mintTcnightCommand)
  .command(changeTermsCommand)
  .command(dustParticipantsCommand)
  .command(mergeUtxosCommand)
  .command(buildCommand)
  .command(buildFromDeployedCommand)
  .demandCommand(1, "You must specify a command")
  .help()
  .strict()
  .strictCommands()
  .wrap(Math.min(process.stdout.columns ?? 80, 120))
  .fail(false);

try {
  await parser.parse();
} catch (err) {
  if (err instanceof Error) {
    console.error(err.stack ?? err.message);
  } else {
    console.error("Unhandled non-Error exception:", err);
  }
  process.exit(1);
}
