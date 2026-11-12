import { Args, Command, HelpDoc, Options, ValidationError } from "@effect/cli";
import { Effect, Either, Option } from "effect";
import {
  deployerSigning,
  feePadding,
  feeUtxo,
  format,
  governanceTxOptions,
  network,
  outputDir,
  outputFile,
  parsedText,
  profile,
  provider,
  sign,
  testNetwork,
  useBuild,
} from "./options";
import { withProvider, withServices, withServicesUseBuild } from "./run";
import {
  parseBech32Address,
  parseHash32,
  parseKeyAddress,
  parseNameList,
  parsePositiveBigInt,
  parsePositiveInteger,
  parseScriptHash,
  parseTxHash,
  parseTxIndex,
} from "./input";
import { type BuildSource, TRACE_LEVELS } from "./contracts/build-engine";
import { buildProgram } from "./contracts/build";
import {
  UPGRADABLE_VALIDATORS,
  V2_TRACK_VALIDATORS,
} from "./contracts/contracts";
import {
  DEPLOY_COMPONENT_VALIDATORS,
  DEPLOY_COMPONENTS,
  DEPLOY_THRESHOLDS,
  deployProgram,
  type ThresholdSetting,
  thresholdConfig,
} from "./deploy/deploy";
import {
  deployStagingTrackProgram,
  STAGING_TRACK_COMPONENTS,
} from "./deploy/staging-track";
import {
  changeCouncilConfig,
  changeTechAuthConfig,
  multisigChangeProgram,
} from "./governance/change-multisig";
import { federatedOpsChangeProgram } from "./governance/change-federated-ops";
import { termsChangeProgram } from "./governance/change-terms";
import { mergeUtxosProgram } from "./governance/merge-utxos";
import { migrateFederatedOpsProgram } from "./governance/migrate-federated-ops";
import { mintStagingStateProgram } from "./governance/mint-staging-state";
import {
  registerCnightMintLogicProgram,
  registerGovAuthProgram,
} from "./governance/register-stake";
import { runCnightMintProgram } from "./governance/run-cnight-mint";
import { parseThreshold } from "./governance/threshold";
import { promoteUpgradeProgram } from "./governance/two-stage-upgrade/promote";
import { stageUpgradeProgram } from "./governance/two-stage-upgrade/stage";
import { dustParticipantsProgram } from "./report/dust-participants";
import { INFO_COMPONENT_CHOICES, infoProgram } from "./report/info";
import { verifyProgram } from "./report/verify";
import { combineSignaturesProgram } from "./signing/combine-signatures";
import { signAndSubmitProgram } from "./signing/sign-and-submit";
import { generateKeyProgram } from "./wallet/generate-key";
import { mintTcnightProgram, parseTcnightRequest } from "./wallet/mint-tcnight";
import {
  SIMPLE_TX_AMOUNT,
  SIMPLE_TX_COUNT,
  simpleTxProgram,
} from "./wallet/simple-tx";

// deploy

const deployThreshold = (setting: ThresholdSetting) =>
  parsedText(setting.option, parseThreshold).pipe(
    Options.withDescription(
      `${setting.what} threshold as numerator/denominator, e.g. 2/3 (default: ${setting.variable}, else ${setting.fallback.numerator}/${setting.fallback.denominator})`,
    ),
    Options.withFallbackConfig(thresholdConfig(setting)),
  );

const deployComponents = parsedText(
  "components",
  parseNameList(DEPLOY_COMPONENTS),
).pipe(
  Options.withDescription(
    `Components, comma-separated (default: all but cnight-minting): ${DEPLOY_COMPONENTS.join(", ")}`,
  ),
  Options.optional,
);

// Always the build blueprint: the contracts a deploy creates are not deployed yet.
const deploy = Command.make(
  "deploy",
  {
    network,
    provider,
    outputDir,
    techAuthThreshold: deployThreshold(DEPLOY_THRESHOLDS.techAuthThreshold),
    councilThreshold: deployThreshold(DEPLOY_THRESHOLDS.councilThreshold),
    councilStagingThreshold: deployThreshold(
      DEPLOY_THRESHOLDS.councilStagingThreshold,
    ),
    techAuthStagingThreshold: deployThreshold(
      DEPLOY_THRESHOLDS.techAuthStagingThreshold,
    ),
    components: deployComponents,
  },
  deployProgram,
).pipe(
  Command.withDescription("Generate deployment transactions"),
  withServices("build"),
);

// deploy-staging-track

const stagingTrackComponents = parsedText(
  "components",
  parseNameList(STAGING_TRACK_COMPONENTS),
).pipe(
  Options.withDescription(
    `Components, comma-separated (default: all): ${STAGING_TRACK_COMPONENTS.join(", ")}`,
  ),
  Options.optional,
);

// Always the build blueprint: the staging forever validators are not deployed yet.
const deployStagingTrack = Command.make(
  "deploy-staging-track",
  { network, provider, outputDir, components: stagingTrackComponents },
  deployStagingTrackProgram,
).pipe(
  Command.withDescription("Generate staging track deployment transactions"),
  withServices("build"),
);

// change-council

const changeCouncil = Command.make(
  "change-council",
  governanceTxOptions("change-council", { useBuild, outputDir }),
  (input) => multisigChangeProgram(changeCouncilConfig, input),
).pipe(
  Command.withDescription("Update council multisig members"),
  withServicesUseBuild,
);

// change-tech-auth

const changeTechAuth = Command.make(
  "change-tech-auth",
  governanceTxOptions("change-tech-auth", { useBuild, outputDir }),
  (input) => multisigChangeProgram(changeTechAuthConfig, input),
).pipe(
  Command.withDescription("Update tech auth multisig members"),
  withServicesUseBuild,
);

// change-federated-ops

const changeFederatedOps = Command.make(
  "change-federated-ops",
  governanceTxOptions("change-federated-ops", { useBuild, outputDir }),
  federatedOpsChangeProgram,
).pipe(
  Command.withDescription("Update federated ops members"),
  withServicesUseBuild,
);

// migrate-federated-ops

const migrateFederatedOps = Command.make(
  "migrate-federated-ops",
  {
    network,
    provider,
    useBuild,
    outputDir,
    ...feeUtxo,
    outputFile: outputFile("migrate-federated-ops-tx.json"),
  },
  migrateFederatedOpsProgram,
).pipe(
  Command.withDescription("Migrate federated ops datum from v1 to v2"),
  withServicesUseBuild,
);

// mint-staging-state

const mintStagingStateValidator = Options.choice(
  "validator",
  V2_TRACK_VALIDATORS,
).pipe(
  Options.withAlias("v"),
  Options.withDescription("Validator to mint StagingState NFT for"),
);

// v2 logic contracts are only in the build blueprint until they are promoted
const mintStagingState = Command.make(
  "mint-staging-state",
  {
    network,
    provider,
    outputDir,
    validator: mintStagingStateValidator,
    feePadding,
    sign: sign("TECH_AUTH_PRIVATE_KEYS"),
    outputFile: outputFile("mint-staging-state-tx.json"),
  },
  mintStagingStateProgram,
).pipe(
  Command.withDescription("Mint StagingState NFT for a v2 logic contract"),
  withServices("build"),
);

// simple-tx

const simpleTxCount = parsedText("count", parsePositiveInteger).pipe(
  Options.withAlias("c"),
  Options.withDescription(
    "Number of outputs to create (default: SIMPLE_TX_COUNT, else 16)",
  ),
  Options.withFallbackConfig(SIMPLE_TX_COUNT),
);

const simpleTxAmount = parsedText("amount", parsePositiveBigInt).pipe(
  Options.withDescription(
    "Lovelace per output (default: SIMPLE_TX_AMOUNT, else 20 ADA)",
  ),
  Options.withFallbackConfig(SIMPLE_TX_AMOUNT),
);

const simpleTxTo = parsedText("to", parseKeyAddress).pipe(
  Options.withDescription(
    "Recipient key address, not a script (default: DEPLOYER_ADDRESS)",
  ),
  Options.optional,
);

const simpleTx = Command.make(
  "simple-tx",
  {
    network,
    provider,
    outputDir,
    count: simpleTxCount,
    amount: simpleTxAmount,
    to: simpleTxTo,
    outputFile: outputFile("simple-tx.json"),
  },
  simpleTxProgram,
).pipe(
  Command.withDescription("Create simple transactions for testing"),
  withProvider,
);

// info

const infoComponent = Options.choice("component", INFO_COMPONENT_CHOICES).pipe(
  Options.withDescription("Filter by component (default: all)"),
  Options.withDefault("all"),
);

const infoSave = Options.boolean("save").pipe(
  Options.withDescription(
    "Fetch on-chain data and save the report to the release directory",
  ),
);

const infoReleaseDir = Options.text("release-dir").pipe(
  Options.withDescription(
    "Base directory for --save output (default: ./release)",
  ),
  Options.withDefault("./release"),
);

const info = Command.make(
  "info",
  {
    network,
    provider,
    useBuild,
    format,
    component: infoComponent,
    save: infoSave,
    releaseDir: infoReleaseDir,
  },
  infoProgram,
).pipe(
  Command.withDescription("Display contract information"),
  withServicesUseBuild,
);

// verify

const verify = Command.make(
  "verify",
  { network, provider },
  verifyProgram,
).pipe(
  Command.withDescription("Verify the deployed record against the chain"),
  withProvider,
);

// stage-upgrade

const stageUpgradeValidator = Options.choice(
  "validator",
  UPGRADABLE_VALIDATORS,
).pipe(Options.withAlias("v"), Options.withDescription("Validator to upgrade"));

const newLogicHash = parsedText("new-logic-hash", parseScriptHash).pipe(
  Options.withDescription(
    "New logic script hash to stage (56 hex chars, 28 bytes)",
  ),
);

const stageUpgrade = Command.make(
  "stage-upgrade",
  governanceTxOptions("stage-upgrade", {
    useBuild,
    outputDir,
    validator: stageUpgradeValidator,
    newLogicHash,
  }),
  stageUpgradeProgram,
).pipe(
  Command.withDescription(
    "Stage a new logic hash for a two-stage upgrade validator",
  ),
  withServicesUseBuild,
);

// promote-upgrade

const promoteUpgradeValidator = Options.choice(
  "validator",
  UPGRADABLE_VALIDATORS,
).pipe(Options.withAlias("v"), Options.withDescription("Validator to promote"));

const promoteUpgrade = Command.make(
  "promote-upgrade",
  governanceTxOptions("promote-upgrade", {
    useBuild,
    outputDir,
    validator: promoteUpgradeValidator,
  }),
  promoteUpgradeProgram,
).pipe(
  Command.withDescription(
    "Promote staged logic to main for a two-stage upgrade validator",
  ),
  withServicesUseBuild,
);

// register-gov-auth

const registerGovAuth = Command.make(
  "register-gov-auth",
  {
    network,
    provider,
    useBuild,
    outputDir,
    outputFile: outputFile("register-gov-auth-tx.json"),
  },
  registerGovAuthProgram,
).pipe(
  Command.withDescription(
    "Register main and staging gov auth scripts as stake credentials",
  ),
  withServicesUseBuild,
);

// register-cnight-mint-logic

const registerCnightMintLogic = Command.make(
  "register-cnight-mint-logic",
  {
    network,
    provider,
    useBuild,
    outputDir,
    ...feeUtxo,
    outputFile: outputFile("register-cnight-mint-logic-tx.json"),
  },
  registerCnightMintLogicProgram,
).pipe(
  Command.withDescription(
    "Register cNIGHT mint logic script as a stake credential",
  ),
  withServicesUseBuild,
);

// run-cnight-mint-mainnet

const runCnightMintMainnet = Command.make(
  "run-cnight-mint-mainnet",
  {
    network,
    provider,
    useBuild,
    outputDir,
    ...feeUtxo,
    outputFile: outputFile("run-cnight-mint-mainnet-tx.json"),
  },
  runCnightMintProgram,
).pipe(
  Command.withDescription("Run the cNIGHT mint forever and logic withdrawals"),
  withServicesUseBuild,
);

// generate-key

const generateKey = Command.make(
  "generate-key",
  { network },
  generateKeyProgram,
).pipe(
  Command.withDescription("Generate a new signing key and Cardano address"),
);

// sign-and-submit

const jsonFile = Args.text({ name: "json-file" }).pipe(
  Args.withDescription("Path to the JSON file containing transaction(s)"),
);

const signAndSubmit = Command.make(
  "sign-and-submit",
  { network, provider, ...deployerSigning, jsonFile },
  signAndSubmitProgram,
).pipe(
  Command.withDescription("Sign and submit transactions from a JSON file"),
  withProvider,
);

// combine-signatures

const combineSignaturesTx = Options.text("tx").pipe(
  Options.withDescription("Transaction file that holds one transaction"),
);

const witnessFiles = Args.text({ name: "witness-file" }).pipe(
  Args.withDescription(
    "Witness files: cardano-cli key witnesses or CIP-30 witness sets",
  ),
  Args.atLeast(1),
);

const combineSignatures = Command.make(
  "combine-signatures",
  {
    network,
    provider,
    ...deployerSigning,
    tx: combineSignaturesTx,
    witnessFiles,
  },
  combineSignaturesProgram,
).pipe(
  Command.withDescription(
    "Combine wallet signatures into a single transaction and submit",
  ),
  withProvider,
);

// mint-tcnight

const mintTcnightAmount = parsedText("amount", parsePositiveBigInt).pipe(
  Options.withDescription("Amount of NIGHT tokens to mint or burn"),
);

const userAddress = parsedText("user-address", parseBech32Address).pipe(
  Options.withAlias("u"),
  Options.withDescription("User address (wallet for signing and burn source)"),
);

const destination = parsedText("destination", parseBech32Address).pipe(
  Options.withAlias("d"),
  Options.withDescription(
    "Destination address, mint only (default: user address)",
  ),
  Options.optional,
);

const burn = Options.boolean("burn").pipe(
  Options.withAlias("b"),
  Options.withDescription("Burn tokens instead of minting"),
);

const tcnightRequest = Options.all({ burn, destination }).pipe(
  Options.mapEffect(({ burn, destination }) =>
    Either.mapLeft(parseTcnightRequest(burn, destination), (reason) =>
      ValidationError.invalidValue(HelpDoc.p(reason)),
    ),
  ),
);

const mintTcnight = Command.make(
  "mint-tcnight",
  {
    network: testNetwork,
    provider,
    outputDir,
    useBuild,
    amount: mintTcnightAmount,
    userAddress,
    request: tcnightRequest,
    outputFile: outputFile("mint-tcnight-tx.json"),
  },
  mintTcnightProgram,
).pipe(
  Command.withDescription("Mint or burn TCnight tokens (non-mainnet only)"),
  withServicesUseBuild,
);

// change-terms

const termsHash = parsedText("hash", parseHash32).pipe(
  Options.withDescription(
    "New terms and conditions hash (64 hex chars, 32 bytes SHA-256)",
  ),
);

const termsUrl = Options.text("url").pipe(
  Options.withDescription("New terms and conditions URL (plain text)"),
);

const changeTerms = Command.make(
  "change-terms",
  governanceTxOptions(
    "change-terms",
    { useBuild, outputDir },
    { hash: termsHash, url: termsUrl },
  ),
  termsChangeProgram,
).pipe(
  Command.withDescription("Change terms and conditions hash and URL"),
  withServicesUseBuild,
);

// dust-participants

const dustParticipants = Command.make(
  "dust-participants",
  { network, provider, useBuild, format },
  dustParticipantsProgram,
).pipe(
  Command.withDescription("Count registered dust participants"),
  withServicesUseBuild,
);

// merge-utxos

const mergeUtxosValidator = Options.choice("validator", [
  "reserve",
  "ics",
]).pipe(Options.withDescription("Forever validator family: reserve or ics"));

const utxoHash = (n: 1 | 2, which: string) =>
  parsedText(`utxo${n}-hash`, parseTxHash).pipe(
    Options.withDescription(`Transaction hash of the ${which} UTxO to merge`),
  );

const utxoIndex = (n: 1 | 2, which: string) =>
  parsedText(`utxo${n}-index`, parseTxIndex).pipe(
    Options.withDescription(`Output index of the ${which} UTxO to merge`),
  );

const mergeUtxos = Command.make(
  "merge-utxos",
  {
    network,
    provider,
    useBuild,
    outputDir,
    validator: mergeUtxosValidator,
    utxo1Hash: utxoHash(1, "first"),
    utxo1Index: utxoIndex(1, "first"),
    utxo2Hash: utxoHash(2, "second"),
    utxo2Index: utxoIndex(2, "second"),
    ...feeUtxo,
    outputFile: outputFile("merge-utxos-tx.json"),
  },
  mergeUtxosProgram,
).pipe(
  Command.withDescription(
    "Merge two value-holding UTxOs at a forever validator into one",
  ),
  withServicesUseBuild,
);

// build

const buildTrace = Options.choice("trace", TRACE_LEVELS).pipe(
  Options.withDescription("Aiken trace level (default: verbose)"),
  Options.withDefault("verbose"),
);

const fromDeployed = Options.boolean("from-deployed").pipe(
  Options.withDescription(
    "Compile against the hashes in deployed-scripts/<env>/plutus.json",
  ),
);

const buildComponents = parsedText(
  "components",
  parseNameList(DEPLOY_COMPONENTS),
).pipe(
  Options.withDescription(
    "With --from-deployed: components to compile from new, named as in deploy --components",
  ),
  Options.optional,
);

/** --from-deployed and --components as one source; --components alone is refused. */
const buildSource = Options.all({
  fromDeployed,
  components: buildComponents,
}).pipe(
  Options.mapEffect(
    ({
      fromDeployed,
      components,
    }): Effect.Effect<BuildSource, ValidationError.ValidationError> =>
      fromDeployed
        ? Effect.succeed({
            kind: "fromDeployed",
            fresh: new Set(
              Option.match(components, {
                onNone: () => [],
                onSome: (names) =>
                  names.flatMap((name) => DEPLOY_COMPONENT_VALIDATORS[name]),
              }),
            ),
          })
        : Option.isSome(components)
          ? Effect.fail(
              ValidationError.invalidValue(
                HelpDoc.p("Invalid --components: it needs --from-deployed"),
              ),
            )
          : Effect.succeed({ kind: "standard" }),
  ),
);

const build = Command.make(
  "build",
  { network: profile, trace: buildTrace, source: buildSource },
  buildProgram,
).pipe(
  Command.withDescription(
    "Compile Aiken contracts and generate TypeScript bindings",
  ),
);

/** Every command, in the order `--help` lists them. */
export const commands = [
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
  runCnightMintMainnet,
  generateKey,
  signAndSubmit,
  combineSignatures,
  mintTcnight,
  changeTerms,
  dustParticipants,
  mergeUtxos,
  build,
] as const;
