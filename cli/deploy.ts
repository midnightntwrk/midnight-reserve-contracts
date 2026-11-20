/**
 * deploy and deploy-staging-track: the transactions that set up an
 * environment's contracts, each spending its one-shot UTxO from the
 * aiken.toml profile, built (never submitted) from the build output and
 * written to one deployment file. The transactions chain: each is planned
 * and compiled in the context the previous one leaves (its wallet without
 * the UTxOs it spent, with the change it paid back), with no chain read in
 * between.
 *
 * deploy builds the twelve governance components, or the ones --components
 * names (cnight-minting only when named). The record follows: a full deploy
 * on a test environment replaces it with the build, a --components one or
 * any deploy on preprod and mainnet extends it with what it creates, whose
 * UpgradeState datums then name the gov auths the record promotes. On
 * preprod and mainnet a validator the record already promotes is refused
 * before any chain read. deploy-staging-track mints the six staging forever
 * NFTs and extends the record with them. The record is written before the
 * deployment file, so a record that cannot be written leaves no file to
 * sign.
 */
import { relative, resolve } from "path";
import {
  AssetId,
  AssetName,
  addressFromValidator,
  CredentialType,
  PaymentAddress,
  PlutusData,
  type Script,
  type Transaction,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Clock, Effect, Option, Result } from "effect";
import * as Contracts from "../contract_blueprint";
import { collateralAmong, planningContext, utxoAmong } from "./chain";
import {
  DeployerAddress,
  type Environment,
  envOr,
  initialTermsAndConditions,
  type NetworkConfig,
  newSigners,
  PROJECT_ROOT,
  permissionedCandidates,
  Profile,
} from "./config";
import {
  type Blueprint,
  type ContractClass,
  type ContractInstances,
  ContractResolver,
  DEPLOY_COMPONENTS,
  type DeployComponent,
  type UpgradableValidator,
} from "./contracts/resolver";
import {
  applyRecordUpdate,
  prepareDeploySnapshot,
} from "./contracts/snapshot-write";
import {
  encodeMultisigState,
  encodeRedeemerMap,
  initialFederatedOpsDatum,
} from "./datum";
import {
  BlueprintError,
  type ConfigError,
  type InputParseError,
  PreconditionFailed,
} from "./errors";
import { type Signers, type TxHash, type TxIndex, ZERO_HASH32 } from "./input";
import { Output } from "./output";
import { parseThreshold, type Threshold } from "./governance/multisig";
import { MAIN_TOKEN_HEX, STAGING_TOKEN_HEX } from "./governance/two-stage";
import {
  compileReported,
  type TransactionFile,
  transactionFileOf,
  writeDeploymentFile,
} from "./signing";
import {
  afterTransaction,
  minAda,
  type PlanningContext,
  type TxPlan,
} from "./tx";

/** The governance components: a deploy without --components builds these. */
export const DEFAULT_DEPLOY_COMPONENTS = DEPLOY_COMPONENTS.filter(
  (component) => component !== "cnight-minting",
);

/** The components deploy-staging-track --components selects, one per staging forever, in build order. */
export const STAGING_TRACK_COMPONENTS = [
  "council",
  "tech-auth",
  "federated-ops",
  "reserve",
  "ics",
  "terms-and-conditions",
] as const;

export type StagingTrackComponent = (typeof STAGING_TRACK_COMPONENTS)[number];

// plans

/** The forever datum of reserve and ICS, main and staging: Constr 0 [0, 0]. */
export const ZERO_FOREVER_DATUM = PlutusData.fromCore({
  constructor: 0n,
  fields: {
    items: [
      PlutusData.newInteger(0n).toCore(),
      PlutusData.newInteger(0n).toCore(),
    ],
  },
});

/** A forever NFT's datum and its mint redeemer. */
export interface ForeverMint {
  readonly datum: PlutusData;
  readonly redeemer: PlutusData;
}

const zeroRedeemer = (datum: PlutusData): ForeverMint => ({
  datum,
  redeemer: PlutusData.newInteger(0n),
});

/** One deployment transaction: it spends its one-shot, offers the collateral, and mints what the one-shot parameterises. */
export type Deployment = {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly collateral: TransactionUnspentOutput;
} & (
  | {
      /** A two-stage validator: its main and staging states on its logic under the gov auths, its forever NFT, and the logic's registration where asked. */
      readonly _tag: "TwoStage";
      readonly twoStage: Script;
      readonly logic: Script;
      readonly forever: Script;
      readonly govAuth: string;
      readonly stagingGovAuth: string;
      readonly foreverMint: ForeverMint;
      readonly registerLogic: boolean;
    }
  | {
      /** cNIGHT minting: its two-stage states; the forever is registered and holds no NFT. */
      readonly _tag: "CnightMinting";
      readonly twoStage: Script;
      readonly logic: Script;
      readonly forever: Script;
      readonly govAuth: string;
      readonly stagingGovAuth: string;
    }
  | {
      /** A threshold NFT, or a staging forever NFT, with its datum. */
      readonly _tag: "Single";
      readonly policy: Script;
      readonly mint: ForeverMint;
    }
);

/** An output at the script's address holding one of its tokens with a datum, at its min ADA. */
const nftOutput = (
  ctx: PlanningContext,
  script: Script,
  assetName: string,
  datum: PlutusData,
): TransactionOutput => {
  const output = TransactionOutput.fromCore({
    address: PaymentAddress(
      addressFromValidator(ctx.networkId, script).toBech32(),
    ),
    value: {
      coins: 0n,
      assets: new Map([[AssetId(script.hash() + assetName), 1n]]),
    },
    datum: datum.toCore(),
  });
  output.amount().setCoin(minAda(output, ctx.parameters.coinsPerUtxoByte));
  return output;
};

const upgradeState = (logic: Script, govAuth: string) =>
  serialize(Contracts.UpgradeState, [logic.hash(), "", govAuth, "", 0n, 0n]);

/** The plan of a deployment transaction. */
export const planDeployment = (ctx: PlanningContext<Deployment>): TxPlan => {
  const deployment = ctx.resolved;
  const base: TxPlan = {
    spends: [{ utxo: deployment.oneShotUtxo, redeemer: Option.none() }],
    references: [],
    scripts: [],
    mints: [],
    outputs: [],
    withdrawals: [],
    registrations: [],
    collateral: [deployment.collateral],
    metadata: Option.none(),
    feePadding: 0n,
    expectedWitnesses: 1,
  };
  const emptyNamed = (policy: Script, mint: ForeverMint) => ({
    mint: {
      policy,
      assets: new Map([[AssetName(""), 1n]]),
      redeemer: Option.some(mint.redeemer),
    },
    output: nftOutput(ctx, policy, "", mint.datum),
  });
  if (deployment._tag === "Single") {
    const { mint, output } = emptyNamed(deployment.policy, deployment.mint);
    return { ...base, mints: [mint], outputs: [output] };
  }
  const states = {
    mint: {
      policy: deployment.twoStage,
      assets: new Map([
        [AssetName(MAIN_TOKEN_HEX), 1n],
        [AssetName(STAGING_TOKEN_HEX), 1n],
      ]),
      redeemer: Option.some(PlutusData.newInteger(0n)),
    },
    outputs: [
      nftOutput(
        ctx,
        deployment.twoStage,
        MAIN_TOKEN_HEX,
        upgradeState(deployment.logic, deployment.govAuth),
      ),
      nftOutput(
        ctx,
        deployment.twoStage,
        STAGING_TOKEN_HEX,
        upgradeState(deployment.logic, deployment.stagingGovAuth),
      ),
    ],
  };
  if (deployment._tag === "CnightMinting") {
    return {
      ...base,
      mints: [states.mint],
      outputs: states.outputs,
      registrations: [deployment.forever],
    };
  }
  const forever = emptyNamed(deployment.forever, deployment.foreverMint);
  return {
    ...base,
    mints: [states.mint, forever.mint],
    outputs: [...states.outputs, forever.output],
    registrations: deployment.registerLogic ? [deployment.logic] : [],
  };
};

// shared

/** What a deployment step reads beside its one-shot. */
export interface StepSetup {
  readonly environment: Environment;
  readonly blueprint: Blueprint;
  readonly instances: ContractInstances;
  readonly techAuthSigners: Signers;
  readonly councilSigners: Signers;
  readonly collateral: TransactionUnspentOutput;
  readonly govAuth: string;
  readonly stagingGovAuth: string;
  readonly thresholds: DeployThresholds;
}

/** One deployment step: its name in the deployment file, its one-shot, the validators it creates, the build gov auths its datums install, and its deployment over its one-shot. */
export interface Step {
  readonly name: string;
  readonly oneShot: (config: NetworkConfig) => readonly [TxHash, TxIndex];
  readonly creates: (
    blueprint: Blueprint,
    environment: Environment,
  ) => Effect.Effect<readonly Script[], BlueprintError>;
  readonly installsGovAuth: boolean;
  readonly deployment: (
    setup: StepSetup,
    oneShotUtxo: TransactionUnspentOutput,
  ) => Effect.Effect<
    Deployment,
    ConfigError | InputParseError | BlueprintError
  >;
}

/** The signers' multisig state, minted with their redeemer map. */
const multisigForever = (signers: Signers) =>
  Effect.fromResult(
    Result.all({
      datum: encodeMultisigState(signers),
      redeemer: encodeRedeemerMap(signers),
    }),
  );

const RULE = "===========================================";

const PRINTABLE = /^[\x20-\x7E]*$/;

/** An asset name as text when it is printable ASCII, else its hex; "(empty)" for the empty name. */
const displayAssetName = (hex: string): string => {
  if (hex === "") return "(empty)";
  const text = Buffer.from(hex, "hex").toString("utf8");
  return PRINTABLE.test(text) ? text : hex;
};

/** A built deployment transaction: its file entry and the outputs it reports (at a script, or holding a token). */
interface Built {
  readonly file: TransactionFile;
  readonly outputs: readonly {
    readonly address: string;
    readonly token: Option.Option<{
      readonly policyId: string;
      readonly assetName: string;
    }>;
  }[];
}

const builtOf = (name: string, tx: Transaction): Built => ({
  file: transactionFileOf(tx, false, name),
  outputs: tx
    .body()
    .outputs()
    .flatMap((output) => {
      const multiasset = output.amount().multiasset();
      const atScript =
        output.address().getProps().paymentPart?.type ===
        CredentialType.ScriptHash;
      if (!atScript && !multiasset) return [];
      const [assetId] = multiasset?.keys() ?? [];
      return [
        {
          address: output.address().toBech32(),
          token: Option.map(Option.fromNullishOr(assetId), (id) => ({
            policyId: id.slice(0, 56),
            assetName: displayAssetName(id.slice(56)),
          })),
        },
      ];
    }),
});

/** The --components selection in build order; None selects the defaults. */
const selected = <Component extends string>(
  all: readonly Component[],
  components: Option.Option<readonly Component[]>,
  defaults: readonly Component[] = all,
): Component[] =>
  Option.match(components, {
    onNone: () => [...defaults],
    onSome: (chosen) => all.filter((c) => chosen.includes(c)),
  });

const PRODUCTION: readonly Environment[] = ["preprod", "mainnet"];

/**
 * The run both commands share once their steps are chosen: refuse on
 * preprod and mainnet a validator the record promotes; prepare the record
 * update; read the signers, the deployer's wallet, the parameters and the
 * collateral; resolve every one-shot; plan and compile each step in the
 * context the previous one leaves; write the record, then the deployment
 * file; report.
 */
const runDeployment = (options: {
  readonly command: "deploy" | "deploy-staging-track";
  readonly network: Environment;
  readonly outputDir: string;
  readonly fileName: string;
  readonly generated: string;
  readonly saved: string;
  readonly steps: readonly Step[];
  readonly full: boolean;
  readonly thresholds: DeployThresholds;
}) =>
  Effect.gen(function* () {
    const { command, network, steps } = options;
    const output = yield* Output;
    const resolver = yield* ContractResolver;
    const build = resolver.contracts("creates");
    const instances = yield* build.instances;
    const created = new Set(
      (yield* Effect.forEach(steps, (step) => step.creates(build, network)))
        .flat()
        .map((script) => script.hash()),
    );
    if (PRODUCTION.includes(network)) {
      const promoted = yield* resolver.promotedAmong(created);
      if (promoted.length > 0) {
        return yield* new PreconditionFailed({
          command,
          refusal: {
            _tag: "Promoted",
            environment: network,
            validators: promoted,
          },
        });
      }
    }
    const rule = resolver.deployRule(options.full);
    // An extended record keeps its live gov auths, and the new UpgradeStates name them.
    const liveOr = (buildHash: string) =>
      Option.contains(rule, "extend")
        ? Effect.map(
            resolver.liveHashOf(buildHash),
            Option.getOrElse(() => buildHash),
          )
        : Effect.succeed(buildHash);
    const govAuth = yield* liveOr(instances.govAuth.Script.hash());
    const stagingGovAuth = yield* liveOr(
      instances.stagingGovAuth.Script.hash(),
    );
    const installed = new Set(
      steps.some((step) => step.installsGovAuth)
        ? [
            instances.govAuth.Script.hash(),
            instances.stagingGovAuth.Script.hash(),
          ].filter((hash) => hash === govAuth || hash === stagingGovAuth)
        : [],
    );
    const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString();
    const record = Option.isSome(rule)
      ? [
          yield* prepareDeploySnapshot({
            env: network,
            rule: rule.value,
            createdHashes: created,
            installedHashes: installed,
            plutusPath: resolver.build.plutusPath,
            blueprintPath: resolver.build.blueprintPath,
            timestamp,
          }),
        ]
      : [];

    const config = yield* (yield* Profile).config;
    const techAuthSigners = yield* newSigners("TECH_AUTH_SIGNERS");
    const councilSigners = yield* newSigners("COUNCIL_SIGNERS");
    yield* output.log(`\nTotal tech auth signers: ${techAuthSigners.length}`);
    yield* output.log(
      `Number of tech auth signer pairs: ${techAuthSigners.length}`,
    );
    yield* output.log(`Total council signers: ${councilSigners.length}`);
    yield* output.log(
      `Number of council signer pairs: ${councilSigners.length}`,
    );
    const first = yield* planningContext({
      command,
      environment: network,
      wallet: yield* (yield* DeployerAddress).address,
      contracts: yield* build.contracts,
      resolved: undefined,
    });
    const collateral = yield* Effect.fromResult(
      collateralAmong(
        command,
        config,
        first.parameters.collateralPercentage,
        first.wallet,
      ),
    );
    yield* output.log(
      `\nUsing collateral UTxO: ${config.collateral_utxo_hash}#${config.collateral_utxo_index} with ${collateral.lovelace} lovelace`,
    );
    yield* output.log(
      `Collateral validation passed: ${collateral.lovelace} lovelace >= ${collateral.required} lovelace required`,
    );
    const oneShots = yield* Effect.forEach(steps, (step) =>
      Effect.fromResult(utxoAmong(first.wallet, ...step.oneShot(config))),
    );
    const setup: StepSetup = {
      environment: network,
      blueprint: build,
      instances,
      techAuthSigners,
      councilSigners,
      collateral: collateral.collateral,
      govAuth,
      stagingGovAuth,
      thresholds: options.thresholds,
    };

    const built: Built[] = [];
    let ctx: PlanningContext<undefined> = first;
    for (const [i, step] of steps.entries()) {
      const deployment = yield* step.deployment(setup, oneShots[i]);
      const tx = yield* compileReported(
        planDeployment({
          ...ctx,
          command: `${command}/${step.name}`,
          resolved: deployment,
        }),
        { ...ctx, command: `${command}/${step.name}` },
      );
      built.push(builtOf(step.name, tx));
      ctx = afterTransaction(ctx, tx);
    }

    for (const outcome of yield* applyRecordUpdate(network, record)) {
      if (outcome._tag === "Saved") {
        yield* output.success(
          `${options.saved} saved to ${relative(PROJECT_ROOT, outcome.dir)}/`,
        );
      }
    }
    const path = resolve(options.outputDir, network, options.fileName);
    yield* writeDeploymentFile(path, {
      network,
      timestamp,
      transactions: built.map((b) => b.file),
    });
    yield* output.log(RULE);
    yield* output.success(options.generated.replace("N", `${built.length}`));
    yield* output.log(`Output file: ${path}`);
    yield* output.log(RULE);
    yield* output.log("\nTransaction Summary:");
    for (const [i, { file }] of built.entries()) {
      yield* output.log(`${i + 1}. ${file.description}`);
      yield* output.log(`   Hash: ${file.txHash}`);
      yield* output.log("");
    }
    yield* output.log("\nScript Outputs:");
    yield* output.log(RULE);
    for (const { file, outputs } of built) {
      if (outputs.length === 0) continue;
      yield* output.log(`\n${file.description}:`);
      for (const { address, token } of outputs) {
        yield* output.log(`  Address: ${address}`);
        if (Option.isSome(token)) {
          yield* output.log(`  Policy ID: ${token.value.policyId}`);
          yield* output.log(`  Asset Name: ${token.value.assetName}`);
        }
        yield* output.log("");
      }
      yield* output.log("");
    }
    return built;
  });

const header = (title: string) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log(RULE);
    yield* output.log(title);
    yield* output.log(RULE);
  });

// deploy

/** The four thresholds deploy installs. */
export interface DeployThresholds {
  readonly techAuth: Threshold;
  readonly council: Threshold;
  readonly councilStaging: Threshold;
  readonly techAuthStaging: Threshold;
}

/** Each deploy threshold: its environment fallback and its fraction when both are unset. */
export const DEPLOY_THRESHOLDS = {
  techAuth: { variable: "TECH_AUTH_THRESHOLD", fallback: [2n, 3n] },
  council: { variable: "COUNCIL_THRESHOLD", fallback: [2n, 3n] },
  councilStaging: { variable: "COUNCIL_STAGING_THRESHOLD", fallback: [0n, 1n] },
  techAuthStaging: {
    variable: "TECH_AUTH_STAGING_THRESHOLD",
    fallback: [1n, 2n],
  },
} as const satisfies Record<
  keyof DeployThresholds,
  { readonly variable: string; readonly fallback: readonly [bigint, bigint] }
>;

/** A two-stage step over the validator's triple, its forever's datum and mint redeemer, and whether it registers its logic. */
const twoStageStep = (
  name: string,
  validator: UpgradableValidator,
  oneShot: Step["oneShot"],
  foreverMint: (
    setup: StepSetup,
  ) => Effect.Effect<ForeverMint, ConfigError | InputParseError>,
  registerLogic: boolean,
): Step => ({
  name,
  oneShot,
  installsGovAuth: true,
  creates: (blueprint) =>
    Effect.map(blueprint.twoStage(validator), (triple) => [
      triple.twoStage.Script,
      triple.forever.Script,
      triple.logic.Script,
    ]),
  deployment: (setup, oneShotUtxo) =>
    Effect.gen(function* () {
      const triple = yield* setup.blueprint.twoStage(validator);
      const [twoStage, forever, logic] = [
        triple.twoStage.Script,
        triple.forever.Script,
        triple.logic.Script,
      ];
      const common = {
        oneShotUtxo,
        collateral: setup.collateral,
        twoStage,
        logic,
        forever,
        govAuth: setup.govAuth,
        stagingGovAuth: setup.stagingGovAuth,
      };
      return validator === "cnight-minting"
        ? { _tag: "CnightMinting" as const, ...common }
        : {
            _tag: "TwoStage" as const,
            ...common,
            foreverMint: yield* foreverMint(setup),
            registerLogic,
          };
    }),
});

/** A threshold step: its NFT holds the tech-auth then the council fraction. */
const thresholdStep = (
  name: string,
  pick: (instances: ContractInstances) => ContractClass,
  oneShot: Step["oneShot"],
  fractions: (thresholds: DeployThresholds) => readonly [Threshold, Threshold],
): Step => ({
  name,
  oneShot,
  installsGovAuth: false,
  creates: (blueprint) =>
    Effect.map(blueprint.instances, (instances) => [pick(instances).Script]),
  deployment: (setup, oneShotUtxo) => {
    const [techAuth, council] = fractions(setup.thresholds);
    return Effect.succeed({
      _tag: "Single" as const,
      oneShotUtxo,
      collateral: setup.collateral,
      policy: pick(setup.instances).Script,
      mint: zeroRedeemer(
        serialize(Contracts.MultisigThreshold, [
          techAuth.numerator,
          techAuth.denominator,
          council.numerator,
          council.denominator,
        ]),
      ),
    });
  },
});

const mainFractions = (t: DeployThresholds) => [t.techAuth, t.council] as const;

const zeroForever = () => Effect.succeed(zeroRedeemer(ZERO_FOREVER_DATUM));

/** Each component's deployment transaction. */
export const DEPLOY_STEPS: Record<DeployComponent, Step> = {
  "tech-auth": twoStageStep(
    "technical-authority-deployment",
    "tech-auth",
    (c) => [
      c.technical_authority_one_shot_hash,
      c.technical_authority_one_shot_index,
    ],
    (setup) => multisigForever(setup.techAuthSigners),
    true,
  ),
  "tech-auth-threshold": thresholdStep(
    "tech-auth-update-threshold-deployment",
    (i) => i.mainTechAuthUpdateThreshold,
    (c) => [
      c.main_tech_auth_update_one_shot_hash,
      c.main_tech_auth_update_one_shot_index,
    ],
    mainFractions,
  ),
  council: twoStageStep(
    "council-deployment",
    "council",
    (c) => [c.council_one_shot_hash, c.council_one_shot_index],
    (setup) => multisigForever(setup.councilSigners),
    true,
  ),
  "council-threshold": thresholdStep(
    "council-update-threshold-deployment",
    (i) => i.mainCouncilUpdateThreshold,
    (c) => [
      c.main_council_update_one_shot_hash,
      c.main_council_update_one_shot_index,
    ],
    mainFractions,
  ),
  reserve: twoStageStep(
    "reserve-deployment",
    "reserve",
    (c) => [c.reserve_one_shot_hash, c.reserve_one_shot_index],
    zeroForever,
    false,
  ),
  ics: twoStageStep(
    "ics-deployment",
    "ics",
    (c) => [c.ics_one_shot_hash, c.ics_one_shot_index],
    zeroForever,
    false,
  ),
  "main-gov": thresholdStep(
    "main-gov-threshold-deployment",
    (i) => i.mainGovThreshold,
    (c) => [c.main_gov_one_shot_hash, c.main_gov_one_shot_index],
    mainFractions,
  ),
  "staging-gov": thresholdStep(
    "staging-gov-threshold-deployment",
    (i) => i.stagingGovThreshold,
    (c) => [c.staging_gov_one_shot_hash, c.staging_gov_one_shot_index],
    (t) => [t.techAuthStaging, t.councilStaging] as const,
  ),
  "federated-ops": twoStageStep(
    "federated-ops-deployment",
    "federated-ops",
    (c) => [
      c.federated_operators_one_shot_hash,
      c.federated_operators_one_shot_index,
    ],
    () =>
      Effect.map(permissionedCandidates, (candidates) =>
        zeroRedeemer(initialFederatedOpsDatum(candidates)),
      ),
    true,
  ),
  "federated-ops-threshold": thresholdStep(
    "federated-ops-update-threshold-deployment",
    (i) => i.mainFederatedOpsUpdateThreshold,
    (c) => [
      c.main_federated_ops_update_one_shot_hash,
      c.main_federated_ops_update_one_shot_index,
    ],
    mainFractions,
  ),
  "terms-and-conditions": twoStageStep(
    "terms-and-conditions-deployment",
    "terms-and-conditions",
    (c) => [
      c.terms_and_conditions_one_shot_hash,
      c.terms_and_conditions_one_shot_index,
    ],
    () =>
      Effect.map(initialTermsAndConditions, ({ hash, link }) =>
        zeroRedeemer(
          serialize(Contracts.VersionedTermsAndConditions, [[hash, link], 0n]),
        ),
      ),
    true,
  ),
  "terms-and-conditions-threshold": thresholdStep(
    "terms-and-conditions-threshold-deployment",
    (i) => i.termsAndConditionsThreshold,
    (c) => [
      c.terms_and_conditions_threshold_one_shot_hash,
      c.terms_and_conditions_threshold_one_shot_index,
    ],
    mainFractions,
  ),
  "cnight-minting": twoStageStep(
    "cnight-minting-deployment",
    "cnight-minting",
    (c) => [c.cnight_minting_one_shot_hash, c.cnight_minting_one_shot_index],
    zeroForever,
    false,
  ),
};

/** A threshold from its flag, else its environment variable, else its fallback. */
const thresholdOf = (
  flag: Option.Option<Threshold>,
  setting: (typeof DEPLOY_THRESHOLDS)[keyof DeployThresholds],
) =>
  Option.isSome(flag)
    ? Effect.succeed(flag.value)
    : envOr(setting.variable, parseThreshold, {
        numerator: setting.fallback[0],
        denominator: setting.fallback[1],
      });

/** Generate the deployment transactions of the governance components, or of the ones --components names, and keep the record in step. */
export const deployProgram = (input: {
  readonly network: Environment;
  readonly outputDir: string;
  readonly techAuthThreshold: Option.Option<Threshold>;
  readonly councilThreshold: Option.Option<Threshold>;
  readonly councilStagingThreshold: Option.Option<Threshold>;
  readonly techAuthStagingThreshold: Option.Option<Threshold>;
  readonly components: Option.Option<readonly DeployComponent[]>;
}) =>
  Effect.gen(function* () {
    const thresholds: DeployThresholds = {
      techAuth: yield* thresholdOf(
        input.techAuthThreshold,
        DEPLOY_THRESHOLDS.techAuth,
      ),
      council: yield* thresholdOf(
        input.councilThreshold,
        DEPLOY_THRESHOLDS.council,
      ),
      councilStaging: yield* thresholdOf(
        input.councilStagingThreshold,
        DEPLOY_THRESHOLDS.councilStaging,
      ),
      techAuthStaging: yield* thresholdOf(
        input.techAuthStagingThreshold,
        DEPLOY_THRESHOLDS.techAuthStaging,
      ),
    };
    yield* header(`Generating deployment transactions for ${input.network}`);
    yield* (yield* Output).log(
      "Min UTxO: calculated dynamically from protocol parameters",
    );
    return yield* runDeployment({
      command: "deploy",
      network: input.network,
      outputDir: input.outputDir,
      fileName: "deployment-transactions.json",
      generated: "Generated N deployment transactions",
      saved: "Deployment scripts",
      steps: selected(
        DEPLOY_COMPONENTS,
        input.components,
        DEFAULT_DEPLOY_COMPONENTS,
      ).map((component) => DEPLOY_STEPS[component]),
      full: Option.isNone(input.components),
      thresholds,
    });
  });

// deploy-staging-track

/** A staging forever step: its NFT holds the forever's initial datum. */
const stagingStep = (
  component: StagingTrackComponent,
  name: string,
  oneShot: Step["oneShot"],
  pick: (instances: ContractInstances) => ContractClass | undefined,
  foreverMint: (
    setup: StepSetup,
  ) => Effect.Effect<ForeverMint, ConfigError | InputParseError>,
): Step => {
  /** The staging forever of the blueprint; one it lacks is a BlueprintError naming the step. */
  const stagingForever = (blueprint: Blueprint, environment: Environment) =>
    Effect.flatMap(blueprint.instances, (instances) => {
      const contract = pick(instances);
      return contract === undefined
        ? Effect.fail(
            new BlueprintError({
              environment,
              source: blueprint.source,
              reason: `the staging forever validator of ${component} is not in the blueprint`,
            }),
          )
        : Effect.succeed(contract.Script);
    });
  return {
    name,
    oneShot,
    installsGovAuth: false,
    creates: (blueprint, environment) =>
      Effect.map(stagingForever(blueprint, environment), (s) => [s]),
    deployment: (setup, oneShotUtxo) =>
      Effect.gen(function* () {
        return {
          _tag: "Single" as const,
          oneShotUtxo,
          collateral: setup.collateral,
          policy: yield* stagingForever(setup.blueprint, setup.environment),
          mint: yield* foreverMint(setup),
        };
      }),
  };
};

/** Each staging forever's transaction. */
export const STAGING_STEPS: Record<StagingTrackComponent, Step> = {
  council: stagingStep(
    "council",
    "council-staging-forever-deployment",
    (c) => [c.council_staging_one_shot_hash, c.council_staging_one_shot_index],
    (i) => i.councilStagingForever,
    (setup) => multisigForever(setup.councilSigners),
  ),
  "tech-auth": stagingStep(
    "tech-auth",
    "tech-auth-staging-forever-deployment",
    (c) => [
      c.technical_authority_staging_one_shot_hash,
      c.technical_authority_staging_one_shot_index,
    ],
    (i) => i.techAuthStagingForever,
    (setup) => multisigForever(setup.techAuthSigners),
  ),
  "federated-ops": stagingStep(
    "federated-ops",
    "federated-ops-staging-forever-deployment",
    (c) => [
      c.federated_operators_staging_one_shot_hash,
      c.federated_operators_staging_one_shot_index,
    ],
    (i) => i.federatedOpsStagingForever,
    () =>
      Effect.map(permissionedCandidates, (candidates) =>
        zeroRedeemer(initialFederatedOpsDatum(candidates)),
      ),
  ),
  reserve: stagingStep(
    "reserve",
    "reserve-staging-forever-deployment",
    (c) => [c.reserve_staging_one_shot_hash, c.reserve_staging_one_shot_index],
    (i) => i.reserveStagingForever,
    zeroForever,
  ),
  ics: stagingStep(
    "ics",
    "ics-staging-forever-deployment",
    (c) => [c.ics_staging_one_shot_hash, c.ics_staging_one_shot_index],
    (i) => i.icsStagingForever,
    zeroForever,
  ),
  "terms-and-conditions": stagingStep(
    "terms-and-conditions",
    "terms-and-conditions-staging-forever-deployment",
    (c) => [
      c.terms_and_conditions_staging_one_shot_hash,
      c.terms_and_conditions_staging_one_shot_index,
    ],
    (i) => i.termsAndConditionsStagingForever,
    () =>
      Effect.succeed(
        zeroRedeemer(
          serialize(Contracts.VersionedTermsAndConditions, [
            [ZERO_HASH32, ""],
            0n,
          ]),
        ),
      ),
  ),
};

/** Generate the staging forever transactions, or the ones --components names, and extend the record with them. */
export const deployStagingTrackProgram = (input: {
  readonly network: Environment;
  readonly outputDir: string;
  readonly components: Option.Option<readonly StagingTrackComponent[]>;
}) =>
  Effect.gen(function* () {
    const { network } = input;
    yield* header(
      `Generating staging track deployment transactions for ${network}`,
    );
    const components = selected(STAGING_TRACK_COMPONENTS, input.components);
    return yield* runDeployment({
      command: "deploy-staging-track",
      network,
      outputDir: input.outputDir,
      fileName: "staging-track-deployment-transactions.json",
      generated: "Generated N staging track deployment transactions",
      saved: "Staging forever scripts",
      steps: components.map((component) => STAGING_STEPS[component]),
      // The staging track only ever extends the record.
      full: false,
      thresholds: {
        techAuth: { numerator: 0n, denominator: 1n },
        council: { numerator: 0n, denominator: 1n },
        councilStaging: { numerator: 0n, denominator: 1n },
        techAuthStaging: { numerator: 0n, denominator: 1n },
      },
    });
  });
