#!/usr/bin/env bun

import { Command } from "@effect/cli";
import { BunRuntime } from "@effect/platform-bun";
import { Effect, Exit } from "effect";
import { deploy } from "./commands/deploy";
import { deployStagingTrack } from "./commands/deploy-staging-track";
import { changeCouncil } from "./commands/change-council";
import { changeTechAuth } from "./commands/change-tech-auth";
import { changeFederatedOps } from "./commands/change-federated-ops";
import { migrateFederatedOps } from "./commands/migrate-federated-ops";
import { mintStagingState } from "./commands/mint-staging-state";
import { simpleTx } from "./commands/simple-tx";
import { info } from "./commands/info";
import { verify } from "./commands/verify";
import { stageUpgrade } from "./commands/stage-upgrade";
import { promoteUpgrade } from "./commands/promote-upgrade";
import { registerGovAuth } from "./commands/register-gov-auth";
import { registerCnightMintLogic } from "./commands/register-cnight-mint-logic";
import { generateKey } from "./commands/generate-key";
import { signAndSubmit } from "./commands/sign-and-submit";
import { combineSignatures } from "./commands/combine-signatures";
import { mintTcnight } from "./commands/mint-tcnight";
import { changeTerms } from "./commands/change-terms";
import { dustParticipants } from "./commands/dust-participants";
import { mergeUtxos } from "./commands/merge-utxos";
import { build } from "./commands/build";
import { bridgeInfo } from "./commands/bridge-info";
import { bridgeTopup } from "./commands/bridge-topup";
import { bridgeUpdate } from "./commands/bridge-update";
import { bridgeSetFee } from "./commands/bridge-set-fee";
import { bridgeSetThreshold } from "./commands/bridge-set-threshold";
import { BaseLive, EnvLive, reportFailure, teardown } from "./run";
import packageJson from "../package.json";

const root = Command.make("midnight-reserve").pipe(
  Command.withSubcommands([
    deploy,
    deployStagingTrack,
    changeCouncil,
    changeTechAuth,
    changeFederatedOps,
    migrateFederatedOps,
    mintStagingState,
    simpleTx,
    info,
    verify,
    stageUpgrade,
    promoteUpgrade,
    registerGovAuth,
    registerCnightMintLogic,
    generateKey,
    signAndSubmit,
    combineSignatures,
    mintTcnight,
    changeTerms,
    dustParticipants,
    mergeUtxos,
    build,
    bridgeInfo,
    bridgeTopup,
    bridgeUpdate,
    bridgeSetFee,
    bridgeSetThreshold,
  ]),
);

const cli = Command.run(root, {
  name: "midnight-reserve",
  version: packageJson.version,
});

/* eslint-disable no-console -- Blaze writes this warning straight to console.warn. */
// Blaze warns whenever a transaction sets a fee floor or padding; --fee-padding and a funded bridge update set them on purpose.
const BLAZE_FEE_WARNING = "A transaction was built using fee padding.";
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (!(typeof args[0] === "string" && args[0].startsWith(BLAZE_FEE_WARNING)))
    warn(...args);
};
/* eslint-enable no-console */

// runMain interrupts on SIGINT and SIGTERM only.
process.once("SIGHUP", () => process.kill(process.pid, "SIGTERM"));

cli(process.argv).pipe(
  Effect.provide(EnvLive),
  Effect.onExit(
    Exit.match({ onFailure: reportFailure, onSuccess: () => Effect.void }),
  ),
  Effect.provide(BaseLive),
  BunRuntime.runMain({
    disableErrorReporting: true,
    disablePrettyLogger: true,
    teardown,
  }),
);
