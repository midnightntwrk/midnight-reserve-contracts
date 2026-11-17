/**
 * Where a command's contracts come from. A Blueprint is the generated
 * contract classes of one source: the deployed record
 * (deployed-scripts/<env>/contract_blueprint.ts) or the build output
 * (contract_blueprint_<profile>.ts). ContractResolver picks the source per
 * intent and is the one way a command reads the record.
 */
import { resolve } from "path";
import { pathToFileURL } from "url";
import type { Script } from "@blaze-cardano/core";
import { Context, Effect, FileSystem, Layer, Option, Record } from "effect";
import {
  DeployedScripts,
  type Environment,
  environmentOf,
  PROJECT_ROOT,
} from "../config";
import { BlueprintError } from "../errors";
import {
  builtNameOf,
  isPromoted,
  liveHashOf,
  promotedAmong,
  readRecord,
  recordedNameOf,
} from "./snapshot-read";

/** The validators with a two-stage upgrade triple, as --validator takes them. */
export const UPGRADABLE_VALIDATORS = [
  "tech-auth",
  "council",
  "reserve",
  "ics",
  "federated-ops",
  "terms-and-conditions",
  "cnight-minting",
] as const;

export type UpgradableValidator = (typeof UPGRADABLE_VALIDATORS)[number];

/** The components deploy --components and build --components take, one per deployment transaction, in build order. */
export const DEPLOY_COMPONENTS = [
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

/** A generated contract class's instance: its compiled script. */
export interface ContractClass {
  readonly Script: Script;
}

const isContractConstructor = (
  value: unknown,
): value is new () => ContractClass => typeof value === "function";

/** The generated class of each instance every blueprint has. */
const REQUIRED = {
  techAuthTwoStage: "PermissionedTechAuthTwoStageUpgradeElse",
  techAuthForever: "PermissionedTechAuthForeverElse",
  techAuthLogic: "PermissionedTechAuthLogicElse",
  councilTwoStage: "PermissionedCouncilTwoStageUpgradeElse",
  councilForever: "PermissionedCouncilForeverElse",
  councilLogic: "PermissionedCouncilLogicElse",
  reserveForever: "ReserveReserveForeverElse",
  reserveTwoStage: "ReserveReserveTwoStageUpgradeElse",
  reserveLogic: "ReserveReserveLogicElse",
  govAuth: "GovAuthMainGovAuthElse",
  stagingGovAuth: "GovAuthStagingGovAuthElse",
  icsForever: "IlliquidCirculationSupplyIcsForeverElse",
  icsTwoStage: "IlliquidCirculationSupplyIcsTwoStageUpgradeElse",
  icsLogic: "IlliquidCirculationSupplyIcsLogicElse",
  federatedOpsForever: "PermissionedFederatedOpsForeverElse",
  federatedOpsTwoStage: "PermissionedFederatedOpsTwoStageUpgradeElse",
  federatedOpsLogic: "PermissionedFederatedOpsLogicElse",
  mainGovThreshold: "ThresholdsMainGovThresholdElse",
  stagingGovThreshold: "ThresholdsStagingGovThresholdElse",
  mainCouncilUpdateThreshold: "ThresholdsMainCouncilUpdateThresholdElse",
  mainTechAuthUpdateThreshold: "ThresholdsMainTechAuthUpdateThresholdElse",
  mainFederatedOpsUpdateThreshold:
    "ThresholdsMainFederatedOpsUpdateThresholdElse",
  termsAndConditionsForever: "TermsAndConditionsTermsAndConditionsForeverElse",
  termsAndConditionsTwoStage:
    "TermsAndConditionsTermsAndConditionsTwoStageUpgradeElse",
  termsAndConditionsLogic: "TermsAndConditionsTermsAndConditionsLogicElse",
  termsAndConditionsThreshold: "ThresholdsTermsAndConditionsThresholdElse",
  registeredCandidate: "RegisteredCandidateRegisteredCandidateElse",
  cnightGeneratesDust: "CnightGeneratesDustCnightGeneratesDustElse",
} as const;

/** The generated class of each instance a blueprint may lack; one that is present must construct. */
const OPTIONAL = {
  councilStagingForever: "StagingPermissionedCouncilStagingForeverElse",
  techAuthStagingForever: "StagingPermissionedTechAuthStagingForeverElse",
  federatedOpsStagingForever:
    "StagingPermissionedFederatedOpsStagingForeverElse",
  reserveStagingForever: "StagingReserveIcsReserveStagingForeverElse",
  icsStagingForever: "StagingReserveIcsIcsStagingForeverElse",
  termsAndConditionsStagingForever:
    "StagingTandcTermsAndConditionsStagingForeverElse",
  tcnightMintInfinite: "TestCnightNoAuditTcnightMintInfiniteElse",
  cnightMintTwoStage: "CnightMintingCnightMintTwoStageUpgradeElse",
  cnightMintForever: "CnightMintingCnightMintForeverElse",
  cnightMintLogic: "CnightMintingCnightMintLogicElse",
} as const;

/** Every contract instance of a blueprint. */
export type ContractInstances = {
  readonly [K in keyof typeof REQUIRED]: ContractClass;
} & { readonly [K in keyof typeof OPTIONAL]?: ContractClass };

/** The instance-name prefix of each validator's two-stage triple. */
const TRIPLE_PREFIX = {
  "tech-auth": "techAuth",
  council: "council",
  reserve: "reserve",
  ics: "ics",
  "federated-ops": "federatedOps",
  "terms-and-conditions": "termsAndConditions",
  "cnight-minting": "cnightMint",
} as const satisfies Record<UpgradableValidator, string>;

/** The contract classes of one source, loaded on each use. */
export interface Blueprint {
  readonly source: "deployed" | "build";
  /** Every contract instance. */
  readonly instances: Effect.Effect<ContractInstances, BlueprintError>;
  /** The two-stage triple of a validator; only the cNIGHT minting one may be absent. */
  readonly twoStage: (validator: UpgradableValidator) => Effect.Effect<
    {
      readonly twoStage: ContractClass;
      readonly forever: ContractClass;
      readonly logic: ContractClass;
    },
    BlueprintError
  >;
  /** The script with this hash; `reason` is the BlueprintError when the blueprint lacks it. */
  readonly scriptByHash: (
    hash: string,
    reason: string,
  ) => Effect.Effect<Script, BlueprintError>;
  /** The first of these generated classes the blueprint has, instantiated. */
  readonly classOf: (
    classNames: readonly string[],
  ) => Effect.Effect<ContractClass, BlueprintError>;
  /** Every zero-argument contract class with its script hash; a parameterised class throws without its arguments and is left out. */
  readonly contracts: Effect.Effect<
    readonly {
      readonly className: string;
      readonly script: Script;
      readonly hash: string;
    }[],
    BlueprintError
  >;
}

/** The Blueprint of the generated module at `path`; `missing` is the reason when the file is not there. */
const blueprintAt = (
  fs: FileSystem.FileSystem,
  environment: Environment,
  source: Blueprint["source"],
  path: string,
  missing: string,
): Blueprint => {
  const failure = (reason: string) =>
    new BlueprintError({ environment, source, reason });
  const module: Effect.Effect<
    Record<string, unknown>,
    BlueprintError
  > = Effect.gen(function* () {
    if (!(yield* Effect.orElseSucceed(fs.exists(path), () => false))) {
      return yield* failure(missing);
    }
    return yield* Effect.tryPromise({
      try: (): Promise<Record<string, unknown>> =>
        import(pathToFileURL(path).href),
      catch: (cause) =>
        failure(cause instanceof Error ? cause.message : String(cause)),
    });
  });
  /** One class of the module, instantiated; a failure when it is absent or its constructor throws. */
  const construct = (exports: Record<string, unknown>, className: string) => {
    const ctor = exports[className];
    return isContractConstructor(ctor)
      ? Effect.try({
          try: () => new ctor(),
          catch: (cause) =>
            failure(
              `contract class '${className}' failed to construct: ${cause instanceof Error ? cause.message : String(cause)}`,
            ),
        })
      : Effect.fail(
          failure(`contract class '${className}' not found in blueprint`),
        );
  };
  const instances = Effect.flatMap(
    module,
    (exports): Effect.Effect<ContractInstances, BlueprintError> =>
      Effect.all({
        ...Record.map(REQUIRED, (className) => construct(exports, className)),
        ...Record.map(OPTIONAL, (className) =>
          isContractConstructor(exports[className])
            ? construct(exports, className)
            : Effect.succeed(undefined),
        ),
      }),
  );
  const contracts = Effect.map(module, (exports) =>
    Object.entries(exports).flatMap(([className, exported]) => {
      if (!isContractConstructor(exported)) return [];
      const script = Option.liftThrowable(() => new exported().Script)();
      return Option.isSome(script)
        ? [{ className, script: script.value, hash: script.value.hash() }]
        : [];
    }),
  );
  return {
    source,
    instances,
    twoStage: (validator) =>
      Effect.flatMap(instances, (all) => {
        const prefix = TRIPLE_PREFIX[validator];
        const twoStage = all[`${prefix}TwoStage`];
        const forever = all[`${prefix}Forever`];
        const logic = all[`${prefix}Logic`];
        return twoStage && forever && logic
          ? Effect.succeed({ twoStage, forever, logic })
          : Effect.fail(
              failure("cNIGHT minting contracts not found in the blueprint"),
            );
      }),
    scriptByHash: (hash, reason) =>
      Effect.flatMap(contracts, (all) => {
        const found = all.find((c) => c.hash === hash);
        return found
          ? Effect.succeed(found.script)
          : Effect.fail(failure(reason));
      }),
    classOf: (classNames) =>
      Effect.flatMap(module, (exports) => {
        const present = classNames.find((name) =>
          isContractConstructor(exports[name]),
        );
        return present === undefined
          ? Effect.fail(
              failure(
                `none of the contract classes ${classNames.join(", ")} is in the blueprint`,
              ),
            )
          : construct(exports, present);
      }),
    contracts,
  };
};

/** An environment's deployed record: each plutus.json validator by name, and versions.json. */
export interface DeployedRecord {
  readonly validators: readonly {
    readonly name: string;
    readonly hash: string;
    readonly compiledCode: string;
  }[];
  readonly versions: {
    readonly promoted: readonly string[];
    readonly staged: readonly string[];
  };
}

/** How a deploy updates the record: "replace" starts it again from the build output; "extend" keeps it and records the deployed validators. */
export type SnapshotRule = "replace" | "extend";

/** The contracts of an environment by intent, and the record reads. */
export class ContractResolver extends Context.Service<
  ContractResolver,
  {
    /**
     * The contracts of an intent. A command that acts on deployed
     * contracts reads the record, or the build on local and the emulator,
     * which have none. A command that creates contracts reads the build.
     */
    readonly contracts: (intent: "actsOn" | "creates") => Blueprint;
    /**
     * The blueprint a stake registration reads its script from, by the same
     * rule: the record when it holds the contract (the registration acts on
     * it), else the build (it prepares one the record does not hold yet).
     * Local and the emulator read the build.
     */
    readonly toRegister: (
      name: keyof ContractInstances,
    ) => Effect.Effect<Blueprint, BlueprintError>;
    /** Whether the environment keeps a record: false on local and the emulator. */
    readonly hasRecord: boolean;
    /** The aiken.toml profile the environment builds, and its build plutus.json. */
    readonly build: { readonly profile: string; readonly plutusPath: string };
    /** The record's name of the validator with this hash; None without a record or when the record lacks it. */
    readonly recordedNameOf: (
      hash: string,
    ) => Effect.Effect<Option.Option<string>, BlueprintError>;
    /** The build's name of the validator with this hash; None when the build lacks it. */
    readonly builtNameOf: (
      hash: string,
    ) => Effect.Effect<Option.Option<string>, BlueprintError>;
    /** How a deploy updates the record: None on local and the emulator; a full deploy on a test environment replaces it; any other deploy extends it (preprod and mainnet are always extended). */
    readonly deployRule: (full: boolean) => Option.Option<SnapshotRule>;
    /** Whether versions.json promotes the validator with this name. */
    readonly isPromoted: (
      name: string,
    ) => Effect.Effect<boolean, BlueprintError>;
    /** The validators with these build hashes that versions.json already promotes. */
    readonly promotedAmong: (
      hashes: ReadonlySet<string>,
    ) => Effect.Effect<string[], BlueprintError>;
    /** The deployed record (plutus.json and versions.json); a BlueprintError where it is missing, local and the emulator included. */
    readonly record: Effect.Effect<DeployedRecord, BlueprintError>;
    /** The record's hash of the promoted validator this build hash stands for. */
    readonly liveHashOf: (
      buildHash: string,
    ) => Effect.Effect<Option.Option<string>, BlueprintError>;
  }
>()("cli/ContractResolver") {
  static readonly layer = (environment: Environment) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const deployedScripts = yield* DeployedScripts;
        const section = environmentOf(environment).aikenConfigSection;
        const hasRecord = environment !== "local" && environment !== "emulator";
        const plutusPath = resolve(PROJECT_ROOT, `plutus-${section}.json`);
        const build = blueprintAt(
          fs,
          environment,
          "build",
          resolve(PROJECT_ROOT, `contract_blueprint_${section}.ts`),
          `no build output for ${section}; build it first: just build ${section}`,
        );
        // The record's bindings come from the same root as its other files.
        const deployedPath = resolve(
          deployedScripts.root,
          environment,
          "contract_blueprint.ts",
        );
        const deployed = blueprintAt(
          fs,
          environment,
          "deployed",
          deployedPath,
          `no ${deployedPath}`,
        );
        const record = <A, E>(
          effect: Effect.Effect<A, E, FileSystem.FileSystem | DeployedScripts>,
        ) =>
          effect.pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(DeployedScripts, deployedScripts),
          );
        const contracts = (intent: "actsOn" | "creates") =>
          intent === "actsOn" && hasRecord ? deployed : build;
        return {
          contracts,
          hasRecord,
          build: { profile: section, plutusPath },
          recordedNameOf: (hash) =>
            hasRecord
              ? record(recordedNameOf(environment, hash))
              : Effect.succeedNone,
          builtNameOf: (hash) =>
            record(builtNameOf(environment, plutusPath, hash)),
          toRegister: (name) =>
            hasRecord
              ? Effect.map(deployed.instances, (instances) =>
                  instances[name] === undefined ? build : deployed,
                )
              : Effect.succeed(build),
          deployRule: (full) =>
            !hasRecord
              ? Option.none()
              : Option.some(
                  full && environment !== "preprod" && environment !== "mainnet"
                    ? "replace"
                    : "extend",
                ),
          record: record(readRecord(environment)),
          isPromoted: (name) => record(isPromoted(environment, name)),
          promotedAmong: (hashes) =>
            record(promotedAmong(environment, plutusPath, hashes)),
          liveHashOf: (buildHash) =>
            record(liveHashOf(environment, plutusPath, buildHash)),
        };
      }),
    );
}
