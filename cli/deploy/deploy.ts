/**
 * deploy: the twelve transactions that set up an environment's governance
 * contracts, each spending its one-shot UTxO from the aiken.toml profile,
 * built (never submitted) over the build blueprint and written to
 * <output>/<env>/deployment-transactions.json; --components builds only
 * the transactions of those components, and the file holds only them. The
 * cNIGHT minting component is outside the default set: a run builds it
 * only when --components names it.
 *
 * Deploy creates contracts that are not live; a change to a live contract
 * is an upgrade (stage-upgrade, promote-upgrade). The deployed-scripts
 * snapshot records each deploy: a full deploy on a test environment starts
 * it again from the build output; a --components one, or any deploy on
 * preprod and mainnet, extends it. On preprod and mainnet a validator
 * versions.json already promotes is refused before any build. The snapshot
 * is saved before the deployment file is written, so a snapshot that
 * cannot be saved fails the command and leaves no file to sign.
 */
import { serialize } from "@blaze-cardano/data";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Clock, Effect, Option } from "effect";
import { relative, resolve } from "path";
import * as Contracts from "../../contract_blueprint";
import { completeBuilder } from "../chain/complete-tx";
import { envFallback, type NetworkConfig, Settings } from "../config/settings";
import {
  Blueprint,
  type ContractClass,
  type ContractInstances,
  type UpgradableValidator,
} from "../contracts/contracts";
import {
  prepareDeploySnapshot,
  type SnapshotRule,
  writeDeploySnapshot,
} from "../contracts/versions";
import {
  type BlueprintError,
  type ConfigError,
  type InputParseError,
} from "../errors";
import { parseThreshold, type Threshold } from "../governance/threshold";
import type { NetworkInput } from "../input";
import { Output } from "../output";
import {
  buildCnightMintingDeploymentTx,
  buildThresholdDeploymentTx,
  buildTwoStageDeploymentTx,
  ZERO_FOREVER_DATUM,
} from "./builders";
import {
  buildOf,
  builtDeployment,
  type DeploymentSetup,
  deploymentHeader,
  deploymentSetup,
  type ForeverMint,
  federatedOpsForever,
  multisigForever,
  refusePromoted,
  reportDeployment,
  resolveUnspent,
  selectComponents,
  type SnapshotKind,
  snapshotKindOf,
  type UtxoRef,
  zeroRedeemer,
} from "./deployment";
import { DEPLOYER_ONLY } from "../chain/transaction";

/** The governance components: a run without --components builds these. */
export const DEFAULT_DEPLOY_COMPONENTS = [
  "tech-auth",
  "tech-auth-threshold",
  "council",
  "council-threshold",
  "reserve",
  "ics",
  "main-gov",
  "staging-gov",
  "federated-ops",
  "federated-ops-threshold",
  "terms-and-conditions",
  "terms-and-conditions-threshold",
] as const;

/** The components --components selects, one per deployment transaction, in build order. */
export const DEPLOY_COMPONENTS = [
  ...DEFAULT_DEPLOY_COMPONENTS,
  "cnight-minting",
] as const;

export type DeployComponent = (typeof DEPLOY_COMPONENTS)[number];

const twoStageNames = (prefix: string) => [
  `${prefix}_two_stage_upgrade`,
  `${prefix}_forever`,
  `${prefix}_logic`,
];

/** The validators each component's transaction creates, by name; `build --from-deployed --components` compiles these from new. */
export const DEPLOY_COMPONENT_VALIDATORS: Record<
  DeployComponent,
  readonly string[]
> = {
  "tech-auth": twoStageNames("tech_auth"),
  "tech-auth-threshold": ["main_tech_auth_update_threshold"],
  council: twoStageNames("council"),
  "council-threshold": ["main_council_update_threshold"],
  reserve: twoStageNames("reserve"),
  ics: twoStageNames("ics"),
  "main-gov": ["main_gov_threshold"],
  "staging-gov": ["staging_gov_threshold"],
  "federated-ops": twoStageNames("federated_ops"),
  "federated-ops-threshold": ["main_federated_ops_update_threshold"],
  "terms-and-conditions": twoStageNames("terms_and_conditions"),
  "terms-and-conditions-threshold": ["terms_and_conditions_threshold"],
  "cnight-minting": twoStageNames("cnight_mint"),
};

/** A deploy threshold: its option, what it governs, its env variable and the fraction when both are unset. */
export interface ThresholdSetting {
  readonly option: string;
  readonly what: string;
  readonly variable: string;
  readonly fallback: Threshold;
}

/** The four thresholds deploy takes, by their DeployInput field. */
export const DEPLOY_THRESHOLDS = {
  techAuthThreshold: {
    option: "tech-auth-threshold",
    what: "Tech auth",
    variable: "TECH_AUTH_THRESHOLD",
    fallback: { numerator: 2n, denominator: 3n },
  },
  councilThreshold: {
    option: "council-threshold",
    what: "Council",
    variable: "COUNCIL_THRESHOLD",
    fallback: { numerator: 2n, denominator: 3n },
  },
  councilStagingThreshold: {
    option: "council-staging-threshold",
    what: "Council staging",
    variable: "COUNCIL_STAGING_THRESHOLD",
    fallback: { numerator: 0n, denominator: 1n },
  },
  techAuthStagingThreshold: {
    option: "tech-auth-staging-threshold",
    what: "Tech auth staging",
    variable: "TECH_AUTH_STAGING_THRESHOLD",
    fallback: { numerator: 1n, denominator: 2n },
  },
} as const satisfies Record<string, ThresholdSetting>;

/** A threshold's env value as a Config, for its option's fallback. */
export const thresholdConfig = (setting: ThresholdSetting) =>
  envFallback(setting.variable, parseThreshold, setting.fallback);

/** A deployment: where the file goes, the four thresholds, and which components (None: the governance ones). */
export interface DeployInput extends NetworkInput {
  readonly outputDir: string;
  readonly techAuthThreshold: Threshold;
  readonly councilThreshold: Threshold;
  readonly councilStagingThreshold: Threshold;
  readonly techAuthStagingThreshold: Threshold;
  readonly components: Option.Option<readonly DeployComponent[]>;
}

/** What every deployment step builds from. */
interface DeployContext extends DeploymentSetup {
  readonly input: DeployInput;
}

type DeployBuildError = ConfigError | InputParseError | BlueprintError;

type Validators = Effect.Effect<
  readonly ContractClass[],
  BlueprintError,
  Blueprint
>;

type OneShotOf = (config: NetworkConfig) => UtxoRef;

/** A deployment step: its one-shot, the validators it creates, the ones its datums install (not created, but fixed by the deploy), and how its transaction is built over the resolved one-shot. */
interface StepBody {
  readonly oneShotOf: OneShotOf;
  readonly validators: Validators;
  readonly installs: Validators;
  readonly build: (
    ctx: DeployContext,
    oneShotUtxo: TransactionUnspentOutput,
  ) => Effect.Effect<TxBuilder, DeployBuildError, Settings | Blueprint>;
}

/** The main-gov datum shape of a threshold: the tech-auth then the council fraction. */
const thresholdDatum = (
  techAuth: Threshold,
  council: Threshold,
): Contracts.MultisigThreshold => [
  techAuth.numerator,
  techAuth.denominator,
  council.numerator,
  council.denominator,
];

/** The gov auths a two-stage deployment's UpgradeState datums install. */
const govAuths: Validators = Effect.map(
  Effect.flatMap(Blueprint, (b) => b.instances),
  (c) => [c.govAuth, c.stagingGovAuth],
);

/** A two-stage deployment of an upgradable validator: its triple from the blueprint, its forever datum and mint redeemer from the step. */
const twoStage = (
  validator: UpgradableValidator,
  oneShotOf: OneShotOf,
  foreverOf: (
    ctx: DeployContext,
  ) => Effect.Effect<ForeverMint, DeployBuildError, Settings>,
  registerLogic: boolean,
): StepBody => {
  const triple = Effect.flatMap(Blueprint, (b) => b.twoStage(validator));
  return {
    validators: Effect.map(triple, (t) => [t.twoStage, t.forever, t.logic]),
    installs: govAuths,
    oneShotOf,
    build: (ctx, oneShotUtxo) =>
      Effect.gen(function* () {
        const { twoStage, forever, logic } = yield* triple;
        const { datum, redeemer } = yield* foreverOf(ctx);
        return buildTwoStageDeploymentTx(
          ctx.blaze,
          {
            oneShotUtxo,
            twoStage: twoStage.Script,
            forever: forever.Script,
            logic: logic.Script,
            govAuth: ctx.contracts.govAuth.Script,
            stagingGovAuth: ctx.contracts.stagingGovAuth.Script,
            foreverDatum: datum,
            foreverRedeemer: redeemer,
            registerLogic,
          },
          ctx.params,
        );
      }),
  };
};

/** A threshold deployment over the thresholds its datum reads. */
const threshold = (
  script: (c: ContractInstances) => ContractClass,
  oneShotOf: OneShotOf,
  fractions: (input: DeployInput) => readonly [Threshold, Threshold],
): StepBody => ({
  validators: Effect.map(
    Effect.flatMap(Blueprint, (b) => b.instances),
    (c) => [script(c)],
  ),
  installs: Effect.succeed([]),
  oneShotOf,
  build: (ctx, oneShotUtxo) =>
    Effect.succeed(
      buildThresholdDeploymentTx(
        ctx.blaze,
        {
          oneShotUtxo,
          threshold: script(ctx.contracts).Script,
          datum: thresholdDatum(...fractions(ctx.input)),
        },
        ctx.params,
      ),
    ),
});

const mainFractions = (input: DeployInput) =>
  [input.techAuthThreshold, input.councilThreshold] as const;

const zeroForever = () => Effect.succeed(zeroRedeemer(ZERO_FOREVER_DATUM));

/** VersionedTermsAndConditions [[initial hash, initial link], 0], minted with redeemer 0. */
const termsAndConditionsForever = () =>
  Effect.map(
    Effect.flatMap(Settings, (s) => s.initialTermsAndConditions),
    ({ hash, link }) =>
      zeroRedeemer(
        serialize(Contracts.VersionedTermsAndConditions, [[hash, link], 0n]),
      ),
  );

const cnightMintTriple = Effect.flatMap(Blueprint, (b) =>
  b.twoStage("cnight-minting"),
);

/** cNIGHT minting: the two-stage states on cnight_mint_logic; the forever is registered and holds no NFT. */
const cnightMinting: StepBody = {
  validators: Effect.map(cnightMintTriple, (t) => [
    t.twoStage,
    t.forever,
    t.logic,
  ]),
  installs: govAuths,
  oneShotOf: (c) => [
    c.cnight_minting_one_shot_hash,
    c.cnight_minting_one_shot_index,
  ],
  build: (ctx, oneShotUtxo) =>
    Effect.map(cnightMintTriple, ({ twoStage, forever, logic }) =>
      buildCnightMintingDeploymentTx(
        ctx.blaze,
        {
          oneShotUtxo,
          twoStage: twoStage.Script,
          forever: forever.Script,
          logic: logic.Script,
          govAuth: ctx.contracts.govAuth.Script,
          stagingGovAuth: ctx.contracts.stagingGovAuth.Script,
        },
        ctx.params,
      ),
    ),
};

/** Each component's deployment transaction: its name in the deployment file, the validators it creates and how it is built. */
export const DEPLOY_STEPS: Record<
  DeployComponent,
  StepBody & { readonly name: string }
> = {
  "tech-auth": {
    name: "technical-authority-deployment",
    ...twoStage(
      "tech-auth",
      (c) => [
        c.technical_authority_one_shot_hash,
        c.technical_authority_one_shot_index,
      ],
      (ctx) => multisigForever(ctx.techAuthSigners),
      true,
    ),
  },
  "tech-auth-threshold": {
    name: "tech-auth-update-threshold-deployment",
    ...threshold(
      (c) => c.mainTechAuthUpdateThreshold,
      (c) => [
        c.main_tech_auth_update_one_shot_hash,
        c.main_tech_auth_update_one_shot_index,
      ],
      mainFractions,
    ),
  },
  council: {
    name: "council-deployment",
    ...twoStage(
      "council",
      (c) => [c.council_one_shot_hash, c.council_one_shot_index],
      (ctx) => multisigForever(ctx.councilSigners),
      true,
    ),
  },
  "council-threshold": {
    name: "council-update-threshold-deployment",
    ...threshold(
      (c) => c.mainCouncilUpdateThreshold,
      (c) => [
        c.main_council_update_one_shot_hash,
        c.main_council_update_one_shot_index,
      ],
      mainFractions,
    ),
  },
  reserve: {
    name: "reserve-deployment",
    ...twoStage(
      "reserve",
      (c) => [c.reserve_one_shot_hash, c.reserve_one_shot_index],
      zeroForever,
      false,
    ),
  },
  ics: {
    name: "ics-deployment",
    ...twoStage(
      "ics",
      (c) => [c.ics_one_shot_hash, c.ics_one_shot_index],
      zeroForever,
      false,
    ),
  },
  "main-gov": {
    name: "main-gov-threshold-deployment",
    ...threshold(
      (c) => c.mainGovThreshold,
      (c) => [c.main_gov_one_shot_hash, c.main_gov_one_shot_index],
      mainFractions,
    ),
  },
  "staging-gov": {
    name: "staging-gov-threshold-deployment",
    ...threshold(
      (c) => c.stagingGovThreshold,
      (c) => [c.staging_gov_one_shot_hash, c.staging_gov_one_shot_index],
      (input) =>
        [
          input.techAuthStagingThreshold,
          input.councilStagingThreshold,
        ] as const,
    ),
  },
  "federated-ops": {
    name: "federated-ops-deployment",
    ...twoStage(
      "federated-ops",
      (c) => [
        c.federated_operators_one_shot_hash,
        c.federated_operators_one_shot_index,
      ],
      () => federatedOpsForever,
      true,
    ),
  },
  "federated-ops-threshold": {
    name: "federated-ops-update-threshold-deployment",
    ...threshold(
      (c) => c.mainFederatedOpsUpdateThreshold,
      (c) => [
        c.main_federated_ops_update_one_shot_hash,
        c.main_federated_ops_update_one_shot_index,
      ],
      mainFractions,
    ),
  },
  "terms-and-conditions": {
    name: "terms-and-conditions-deployment",
    ...twoStage(
      "terms-and-conditions",
      (c) => [
        c.terms_and_conditions_one_shot_hash,
        c.terms_and_conditions_one_shot_index,
      ],
      termsAndConditionsForever,
      true,
    ),
  },
  "terms-and-conditions-threshold": {
    name: "terms-and-conditions-threshold-deployment",
    ...threshold(
      (c) => c.termsAndConditionsThreshold,
      (c) => [
        c.terms_and_conditions_threshold_one_shot_hash,
        c.terms_and_conditions_threshold_one_shot_index,
      ],
      mainFractions,
    ),
  },
  "cnight-minting": {
    name: "cnight-minting-deployment",
    ...cnightMinting,
  },
};

/** A full run on a test snapshot starts it again; a --components run, or any run on a production one, extends it. */
export const snapshotRuleOf = (
  kind: Exclude<SnapshotKind, "none">,
  components: Option.Option<readonly DeployComponent[]>,
): SnapshotRule =>
  kind === "production" || Option.isSome(components) ? "extend" : "replace";

/** Check and prepare the environment's snapshot, build the selected deployment transactions, then write the snapshot and last the deployment file (a failure leaves no file to sign), and report. */
export const deployProgram = (input: DeployInput) =>
  Effect.gen(function* () {
    const { network } = input;
    const snapshot = snapshotKindOf(network);
    const out = yield* Output;

    yield* deploymentHeader(
      `Generating deployment transactions for ${network}`,
    );
    yield* out.log("Min UTxO: calculated dynamically from protocol parameters");

    const steps = selectComponents(
      DEPLOY_COMPONENTS,
      input.components,
      DEFAULT_DEPLOY_COMPONENTS,
    ).map((component) => DEPLOY_STEPS[component]);
    const hashesOf = (pick: (step: StepBody) => Validators) =>
      Effect.map(
        Effect.forEach(steps, pick),
        (lists) => new Set(lists.flat().map((c) => c.Script.hash())),
      );
    const created = yield* hashesOf((step) => step.validators);
    const installed = yield* hashesOf((step) => step.installs);
    if (snapshot === "production") {
      yield* refusePromoted("deploy", network, created);
    }
    const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString();
    const prepared =
      snapshot === "none"
        ? Option.none()
        : Option.some(
            yield* prepareDeploySnapshot({
              env: network,
              rule: snapshotRuleOf(snapshot, input.components),
              createdHashes: created,
              installedHashes: installed,
              components: input.components,
              ...buildOf(network),
              timestamp,
            }),
          );

    const ctx: DeployContext = {
      input,
      ...(yield* deploymentSetup("deploy", network)),
    };
    const oneShots = yield* resolveUnspent(
      steps.map((step) => step.oneShotOf(ctx.config)),
    );
    const built = yield* Effect.forEach(steps, (step, i) =>
      Effect.flatMap(step.build(ctx, oneShots[i]), (txBuilder) =>
        Effect.map(
          completeBuilder(txBuilder, `deploy/${step.name}`, {
            maxTxSize: ctx.maxTxSize,
            witnesses: DEPLOYER_ONLY,
          }),
          (tx) => builtDeployment(step.name, tx),
        ),
      ),
    );

    if (Option.isSome(prepared)) {
      yield* writeDeploySnapshot(network, prepared.value);
      yield* out.success(
        `Deployment scripts saved to ${relative(process.cwd(), prepared.value.dir)}/`,
      );
    }
    yield* reportDeployment(
      `Generated ${built.length} deployment transactions`,
      resolve(input.outputDir, network, "deployment-transactions.json"),
      { network, timestamp },
      built,
    );
    return built;
  });
