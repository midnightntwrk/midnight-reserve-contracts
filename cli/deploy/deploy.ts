/**
 * deploy: the twelve transactions that set up an environment's governance
 * contracts, each spending its one-shot UTxO from the aiken.toml profile,
 * built (never submitted) over the build blueprint and written to
 * <output>/<env>/deployment-transactions.json; --components builds only
 * the transactions of those components, and the file holds only them. The
 * committee bridge components are outside the default set: a run builds
 * them only when --components names them.
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
  type OptionalInstance,
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
import { initialBatcherState } from "../datum/rewards";
import {
  buildAccountListTx,
  buildAccountStakeTx,
  buildBatcherInitTx,
  buildBeefyThresholdDeploymentTx,
  buildReferenceScriptsTx,
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
  deployerUnspent,
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
  "committee-bridge",
  "committee-bridge-threshold",
  "committee-bridge-scripts",
  "rewards-pool",
  "rewards-batcher",
  "virtual-account-stake",
  "virtual-account",
  "rewards-batcher-script",
  "rewards-scripts",
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
  "committee-bridge": [
    ...twoStageNames("committee_bridge"),
    "committee_bridge_pool",
  ],
  "committee-bridge-threshold": ["beefy_signer_threshold"],
  "committee-bridge-scripts": [],
  "rewards-pool": twoStageNames("rewards_pool"),
  "rewards-batcher": ["rewards_batcher"],
  "virtual-account-stake": [],
  "virtual-account": ["virtual_account"],
  "rewards-batcher-script": [],
  "rewards-scripts": [],
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
  bridgeThreshold: {
    option: "bridge-threshold",
    what: "Committee bridge signer",
    variable: "BRIDGE_THRESHOLD",
    fallback: { numerator: 2n, denominator: 3n },
  },
} as const satisfies Record<string, ThresholdSetting>;

/** A threshold's env value as a Config, for its option's fallback. */
export const thresholdConfig = (setting: ThresholdSetting) =>
  envFallback(setting.variable, parseThreshold, setting.fallback);

/** A deployment: where the file goes, the five thresholds, and which components (None: the governance ones). */
export interface DeployInput extends NetworkInput {
  readonly outputDir: string;
  readonly techAuthThreshold: Threshold;
  readonly councilThreshold: Threshold;
  readonly councilStagingThreshold: Threshold;
  readonly techAuthStagingThreshold: Threshold;
  readonly bridgeThreshold: Threshold;
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

/** A deployment step: its one-shots (one, or none for the reference scripts), the validators it creates, the ones its datums install (not created, but fixed by the deploy), and how its transaction is built over the resolved one-shots. */
interface StepBody {
  readonly oneShots: (config: NetworkConfig) => readonly UtxoRef[];
  readonly validators: Validators;
  readonly installs: Validators;
  readonly build: (
    ctx: DeployContext,
    oneShots: readonly TransactionUnspentOutput[],
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
    installs: Effect.map(
      Effect.flatMap(Blueprint, (b) => b.instances),
      (c) => [c.govAuth, c.stagingGovAuth],
    ),
    oneShots: (config) => [oneShotOf(config)],
    build: (ctx, [oneShotUtxo]) =>
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
  oneShots: (config) => [oneShotOf(config)],
  build: (ctx, [oneShotUtxo]) =>
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

/** The bootstrap BeefyConsensusState from Settings, minted with redeemer 0. */
const bridgeForever = () =>
  Effect.map(
    Effect.flatMap(Settings, (s) => s.bridgeBootstrap),
    (state) => zeroRedeemer(serialize(Contracts.BeefyConsensusState, state)),
  );

const bridgeInstance = (instance: OptionalInstance) =>
  Effect.flatMap(Blueprint, (b) => b.optional(instance));

/** The committee bridge triple over the bootstrap state, with no registration (the triple fills the transaction); its validators include the pool, whose hash the logic compiles in. */
const committeeBridge = (): StepBody => {
  const step = twoStage(
    "committee-bridge",
    (c) => [
      c.committee_bridge_one_shot_hash,
      c.committee_bridge_one_shot_index,
    ],
    bridgeForever,
    false,
  );
  return {
    ...step,
    validators: Effect.map(
      Effect.all([step.validators, bridgeInstance("committeeBridgePool")]),
      ([triple, pool]) => [...triple, pool],
    ),
  };
};

/** The BEEFY threshold over --bridge-threshold and the fee cap from Settings; its transaction registers the bridge logic. */
const beefyThreshold: StepBody = {
  validators: Effect.map(bridgeInstance("beefySignerThreshold"), (t) => [t]),
  installs: Effect.succeed([]),
  oneShots: (c) => [
    [c.committee_threshold_one_shot_hash, c.committee_threshold_one_shot_index],
  ],
  build: (ctx, [oneShotUtxo]) =>
    Effect.gen(function* () {
      const threshold = yield* bridgeInstance("beefySignerThreshold");
      const { logic } = yield* Effect.flatMap(Blueprint, (b) =>
        b.twoStage("committee-bridge"),
      );
      const fee = yield* Effect.flatMap(Settings, (s) => s.bridgeMaxFee);
      const { numerator, denominator } = ctx.input.bridgeThreshold;
      return buildBeefyThresholdDeploymentTx(
        ctx.blaze,
        {
          oneShotUtxo,
          threshold: threshold.Script,
          datum: {
            numerator,
            denominator,
            base: fee.base,
            per_signer: fee.perSigner,
          },
          bridgeLogic: logic.Script,
        },
        ctx.params,
      );
    }),
};

/** The reference scripts a bridge update spends through: the forever, logic and pool scripts at the deployer address, where the deployer's wallet keeps them out of coin selection; no one-shot, and no validator created. */
const bridgeScripts: StepBody = {
  validators: Effect.succeed([]),
  installs: Effect.succeed([]),
  oneShots: () => [],
  build: (ctx) =>
    Effect.gen(function* () {
      const { forever, logic } = yield* Effect.flatMap(Blueprint, (b) =>
        b.twoStage("committee-bridge"),
      );
      const pool = yield* bridgeInstance("committeeBridgePool");
      return buildReferenceScriptsTx(
        ctx.blaze,
        [forever.Script, logic.Script, pool.Script],
        ctx.deployer,
        ctx.params,
      );
    }),
};

const rewardsInstance = (instance: OptionalInstance) =>
  Effect.flatMap(Blueprint, (b) => b.optional(instance));

/** The batcher state over REWARDS_FIRST_EPOCH, serving the account policy and the pool forever; its transaction registers the batcher's stake credential. */
const rewardsBatcher: StepBody = {
  validators: Effect.map(rewardsInstance("rewardsBatcher"), (b) => [b]),
  installs: Effect.all([
    rewardsInstance("virtualAccount"),
    rewardsInstance("rewardsPoolForever"),
  ]),
  oneShots: (c) => [
    [c.rewards_batcher_one_shot_hash, c.rewards_batcher_one_shot_index],
  ],
  build: (ctx, [oneShotUtxo]) =>
    Effect.gen(function* () {
      const batcher = yield* rewardsInstance("rewardsBatcher");
      const account = yield* rewardsInstance("virtualAccount");
      const poolForever = yield* rewardsInstance("rewardsPoolForever");
      const firstEpoch = yield* Effect.flatMap(
        Settings,
        (s) => s.rewardsFirstEpoch,
      );
      return buildBatcherInitTx(
        ctx.blaze,
        {
          oneShotUtxo,
          batcher: batcher.Script,
          state: initialBatcherState(
            account.Script.hash(),
            poolForever.Script.hash(),
            firstEpoch,
          ),
        },
        ctx.params,
      );
    }),
};

/** The account's stake credential, registered before the list's InitList withdraws from it; no one-shot, and no validator created. */
const virtualAccountStake: StepBody = {
  validators: Effect.succeed([]),
  installs: Effect.succeed([]),
  oneShots: () => [],
  build: (ctx) =>
    Effect.map(rewardsInstance("virtualAccount"), (account) =>
      buildAccountStakeTx(ctx.blaze, account.Script, ctx.params),
    ),
};

/** The virtual account list: its head and tail, under the account's InitList withdrawal. */
const virtualAccount: StepBody = {
  validators: Effect.map(rewardsInstance("virtualAccount"), (a) => [a]),
  installs: Effect.succeed([]),
  oneShots: (c) => [
    [c.virtual_account_one_shot_hash, c.virtual_account_one_shot_index],
  ],
  build: (ctx, [oneShotUtxo]) =>
    Effect.map(rewardsInstance("virtualAccount"), (account) =>
      buildAccountListTx(
        ctx.blaze,
        { oneShotUtxo, account: account.Script },
        ctx.params,
      ),
    ),
};

/** Reference scripts at the deployer address, where the deployer's wallet keeps them out of coin selection; no one-shot, and no validator created. */
const referenceScripts = (
  instances: readonly OptionalInstance[],
): StepBody => ({
  validators: Effect.succeed([]),
  installs: Effect.succeed([]),
  oneShots: () => [],
  build: (ctx) =>
    Effect.map(Effect.forEach(instances, rewardsInstance), (scripts) =>
      buildReferenceScriptsTx(
        ctx.blaze,
        scripts.map((s) => s.Script),
        ctx.deployer,
        ctx.params,
      ),
    ),
});

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
  "committee-bridge": {
    name: "committee-bridge-deployment",
    ...committeeBridge(),
  },
  "committee-bridge-threshold": {
    name: "committee-bridge-threshold-deployment",
    ...beefyThreshold,
  },
  "committee-bridge-scripts": {
    name: "committee-bridge-scripts-deployment",
    ...bridgeScripts,
  },
  "rewards-pool": {
    name: "rewards-pool-deployment",
    ...twoStage(
      "rewards-pool",
      (c) => [c.rewards_pool_one_shot_hash, c.rewards_pool_one_shot_index],
      zeroForever,
      true,
    ),
  },
  "rewards-batcher": {
    name: "rewards-batcher-deployment",
    ...rewardsBatcher,
  },
  "virtual-account-stake": {
    name: "virtual-account-stake-deployment",
    ...virtualAccountStake,
  },
  "virtual-account": {
    name: "virtual-account-deployment",
    ...virtualAccount,
  },
  "rewards-batcher-script": {
    name: "rewards-batcher-script-deployment",
    ...referenceScripts(["rewardsBatcher"]),
  },
  "rewards-scripts": {
    name: "rewards-scripts-deployment",
    ...referenceScripts([
      "virtualAccount",
      "rewardsPoolForever",
      "rewardsPoolLogic",
    ]),
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
    const unspentAt = yield* deployerUnspent;
    const oneShots = yield* Effect.forEach(steps, (step) =>
      unspentAt(step.oneShots(ctx.config)),
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
