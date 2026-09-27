import {
  addressFromCredential,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  type NetworkId,
  type Script,
} from "@blaze-cardano/core";
import { Context, Effect, Either, Layer, Option, Record } from "effect";
import {
  type DeployedProfile,
  type Environment,
  environmentOf,
  type Profile,
} from "../config/network-mapping";
import { BlueprintError, describeCause } from "../errors";

/** The validators with a two-stage upgrade triple, as --validator takes them. */
export const UPGRADABLE_VALIDATORS = [
  "tech-auth",
  "council",
  "reserve",
  "ics",
  "federated-ops",
  "terms-and-conditions",
  "cnight-minting",
  "committee-bridge",
] as const;

export type UpgradableValidator = (typeof UPGRADABLE_VALIDATORS)[number];

/** Where a blueprint loads from: deployed-scripts/<env> or the build output. */
export type BlueprintSource = "deployed" | "build";

/** The contract blueprint for the active network; BlueprintLive builds it. */
export class Blueprint extends Context.Tag("cli/Blueprint")<
  Blueprint,
  {
    /** Where this blueprint loads from. */
    readonly source: BlueprintSource;
    /** Every contract instance, loaded once. */
    readonly instances: Effect.Effect<ContractInstances, BlueprintError>;
    /** The two-stage triple of a validator name. */
    readonly twoStage: (
      validator: UpgradableValidator,
    ) => Effect.Effect<TwoStageContracts, BlueprintError>;
    /** An instance a blueprint may lack; BlueprintError naming its class when this one does. */
    readonly optional: (
      instance: OptionalInstance,
    ) => Effect.Effect<ContractClass, BlueprintError>;
    /** The script with this hash; `reason` is the BlueprintError when the blueprint lacks it. */
    readonly scriptByHash: (
      hash: string,
      reason: string,
    ) => Effect.Effect<Script, BlueprintError>;
    /** The first of these generated classes the blueprint has, instantiated. */
    readonly classOf: (
      classNames: readonly string[],
    ) => Effect.Effect<ContractClass, BlueprintError>;
    /** Every zero-argument contract class with its script hash, loaded once. */
    readonly contracts: Effect.Effect<
      readonly BlueprintContract[],
      BlueprintError
    >;
  }
>() {}

/** Every generated contract class carries its compiled script. */
export interface ContractClass {
  Script: Script;
}

/** A generated contract class: a zero-argument constructor. */
type ContractConstructor = new () => ContractClass;

const isContractConstructor = (value: unknown): value is ContractConstructor =>
  typeof value === "function";

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
  rewardsPoolStagingForever: "StagingRewardsPoolRewardsPoolStagingForeverElse",
  tcnightMintInfinite: "TestCnightNoAuditTcnightMintInfiniteElse",
  cnightMintTwoStage: "CnightMintingCnightMintTwoStageUpgradeElse",
  cnightMintForever: "CnightMintingCnightMintForeverElse",
  cnightMintLogic: "CnightMintingCnightMintLogicElse",
  committeeBridgeTwoStage: "CommitteeBridgeCommitteeBridgeTwoStageUpgradeElse",
  committeeBridgeForever: "CommitteeBridgeCommitteeBridgeForeverElse",
  committeeBridgeLogic: "CommitteeBridgeCommitteeBridgeLogicElse",
  committeeBridgePool: "CommitteeBridgePoolCommitteeBridgePoolElse",
  beefySignerThreshold: "ThresholdsBeefySignerThresholdElse",
} as const;

/** An instance a blueprint may lack. */
export type OptionalInstance = keyof typeof OPTIONAL;

/** Every contract instance of a blueprint. */
export type ContractInstances = {
  readonly [K in keyof typeof REQUIRED]: ContractClass;
} & { readonly [K in OptionalInstance]?: ContractClass };

type ModuleLoader = () => Record<string, unknown>;

/* eslint-disable @typescript-eslint/no-require-imports */
const BUILD_MODULES: Record<Profile, ModuleLoader> = {
  default: () => require("../../contract_blueprint_default"),
  mainnet: () => require("../../contract_blueprint_mainnet"),
  preprod: () => require("../../contract_blueprint_preprod"),
  preview: () => require("../../contract_blueprint_preview"),
  qanet: () => require("../../contract_blueprint_qanet"),
  govnet: () => require("../../contract_blueprint_govnet"),
  devnet: () => require("../../contract_blueprint_devnet"),
  local: () => require("../../contract_blueprint_local"),
};

const DEPLOYED_MODULES: Record<DeployedProfile, ModuleLoader> = {
  mainnet: () => require("../../deployed-scripts/mainnet/contract_blueprint"),
  preprod: () => require("../../deployed-scripts/preprod/contract_blueprint"),
  preview: () => require("../../deployed-scripts/preview/contract_blueprint"),
  qanet: () => require("../../deployed-scripts/qanet/contract_blueprint"),
  govnet: () => require("../../deployed-scripts/govnet/contract_blueprint"),
  devnet: () => require("../../deployed-scripts/devnet/contract_blueprint"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Whether a load failed because the generated module `file` is not there (not a module it imports). */
const isMissing = (cause: unknown, file: string): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "MODULE_NOT_FOUND" &&
  describeCause(cause).includes(file);

/** Load a generated module; `missing` is the reason when its file is not there. */
const load = (loader: ModuleLoader, file: string, missing: string) =>
  Either.try({
    try: loader,
    catch: (cause) => (isMissing(cause, file) ? missing : describeCause(cause)),
  });

/** Whether an environment has deployed scripts (local and the emulator do not). */
export const hasDeployedScripts = (environment: Environment): boolean =>
  !environmentOf(environment).local;

/** The generated blueprint module of an environment; Left carries the reason. */
const moduleFor = (
  environment: Environment,
  source: BlueprintSource,
): Either.Either<Record<string, unknown>, string> => {
  const resolution = environmentOf(environment);
  const section = resolution.aikenConfigSection;
  return source === "build"
    ? load(
        BUILD_MODULES[section],
        `contract_blueprint_${section}`,
        `no build output for ${section}; build it first: just build ${section}`,
      )
    : resolution.local
      ? Either.left("the environment has no deployed scripts")
      : load(
          DEPLOYED_MODULES[resolution.aikenConfigSection],
          `deployed-scripts/${section}/contract_blueprint`,
          `no deployed-scripts/${section}/contract_blueprint.ts`,
        );
};

/** Instantiate one class; Left when it is absent or its constructor throws. */
const construct = (
  module: Record<string, unknown>,
  className: string,
): Either.Either<ContractClass, string> => {
  const ctor = module[className];
  if (!isContractConstructor(ctor)) {
    return Either.left(`contract class '${className}' not found in blueprint`);
  }
  return Either.mapLeft(
    Either.try(() => new ctor()),
    (cause) =>
      `contract class '${className}' failed to construct: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
};

/** The first class among the names the module has, instantiated; Left when none is present or it throws. */
const constructFirst = (
  module: Record<string, unknown>,
  classNames: readonly string[],
): Either.Either<ContractClass, string> => {
  const present = classNames.find((name) =>
    isContractConstructor(module[name]),
  );
  return present === undefined
    ? Either.left(
        `none of the contract classes ${classNames.join(", ")} is in the blueprint`,
      )
    : construct(module, present);
};

/** Instances of every known class; an optional class may be absent, but one that is present must construct. */
const instancesFrom = (
  module: Record<string, unknown>,
  error: (reason: string) => BlueprintError,
): Either.Either<ContractInstances, BlueprintError> => {
  const required = (className: string) =>
    Either.mapLeft(construct(module, className), error);
  return Either.all({
    ...Record.map(REQUIRED, required),
    ...Record.map(OPTIONAL, (className) =>
      isContractConstructor(module[className])
        ? required(className)
        : Either.right(undefined),
    ),
  });
};

const blueprintError =
  (environment: string, source: BlueprintSource) => (reason: string) =>
    new BlueprintError({ environment, source, reason });

/** The blueprint module of an environment as a value; Left when it cannot load. */
export const loadBlueprintModule = (
  environment: Environment,
  source: BlueprintSource,
): Either.Either<Record<string, unknown>, BlueprintError> =>
  Either.mapLeft(
    moduleFor(environment, source),
    blueprintError(environment, source),
  );

/** Contract instances of an environment. */
const contractInstances = (
  environment: Environment,
  source: BlueprintSource,
): Either.Either<ContractInstances, BlueprintError> =>
  Either.flatMap(loadBlueprintModule(environment, source), (module) =>
    instancesFrom(module, blueprintError(environment, source)),
  );

/** The enterprise address of a script hash on a network. */
export const credentialAddress = (
  networkId: NetworkId,
  scriptHash: string,
): ReturnType<typeof addressFromCredential> =>
  addressFromCredential(
    networkId,
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(scriptHash),
    }),
  );

interface TwoStageContracts {
  twoStage: ContractClass;
  forever: ContractClass;
  logic: ContractClass;
}

/** The instance-name prefix of each validator's two-stage triple. */
const TRIPLE_PREFIX = {
  "tech-auth": "techAuth",
  council: "council",
  reserve: "reserve",
  ics: "ics",
  "federated-ops": "federatedOps",
  "terms-and-conditions": "termsAndConditions",
  "cnight-minting": "cnightMint",
  "committee-bridge": "committeeBridge",
} as const satisfies Record<UpgradableValidator, string>;

/** The two-stage triple of a validator; only the cNIGHT minting and committee bridge ones are optional. */
const twoStageContracts = (
  validator: UpgradableValidator,
  contracts: ContractInstances,
  environment: Environment,
  source: BlueprintSource,
): Either.Either<TwoStageContracts, BlueprintError> => {
  const prefix = TRIPLE_PREFIX[validator];
  const twoStage = contracts[`${prefix}TwoStage`];
  const forever = contracts[`${prefix}Forever`];
  const logic = contracts[`${prefix}Logic`];
  return twoStage && forever && logic
    ? Either.right({ twoStage, forever, logic })
    : Either.left(
        blueprintError(
          environment,
          source,
        )(`${validator} contracts not found in the blueprint`),
      );
};

/** The first of these generated classes the environment's blueprint has, instantiated. */
const contractClass = (
  classNames: readonly string[],
  environment: Environment,
  source: BlueprintSource,
): Either.Either<ContractClass, BlueprintError> =>
  Either.flatMap(loadBlueprintModule(environment, source), (module) =>
    Either.mapLeft(
      constructFirst(module, classNames),
      blueprintError(environment, source),
    ),
  );

/** Blueprint for one environment from its source, loaded on first use. */
export const BlueprintLive = (
  environment: Environment,
  source: BlueprintSource,
) =>
  Layer.effect(
    Blueprint,
    Effect.map(
      Effect.all([
        Effect.cached(
          Effect.suspend(() => contractInstances(environment, source)),
        ),
        Effect.cached(
          Effect.suspend(() =>
            Either.map(
              loadBlueprintModule(environment, source),
              enumerateContracts,
            ),
          ),
        ),
      ]),
      ([instances, contracts]) => ({
        source,
        instances,
        twoStage: (validator: UpgradableValidator) =>
          Effect.flatMap(instances, (all) =>
            twoStageContracts(validator, all, environment, source),
          ),
        optional: (instance: OptionalInstance) =>
          Effect.flatMap(instances, (all) =>
            Either.fromNullable(all[instance], () =>
              blueprintError(
                environment,
                source,
              )(
                `contract class '${OPTIONAL[instance]}' not found in blueprint`,
              ),
            ),
          ),
        scriptByHash: (hash: string, reason: string) =>
          Effect.flatMap(contracts, (all) =>
            Either.fromNullable(all.find((c) => c.hash === hash)?.script, () =>
              blueprintError(environment, source)(reason),
            ),
          ),
        classOf: (classNames: readonly string[]) =>
          Effect.suspend(() => contractClass(classNames, environment, source)),
        contracts,
      }),
    ),
  );

/** A zero-argument contract class of a blueprint module: its name, script and hash. */
export interface BlueprintContract {
  readonly className: string;
  readonly script: Script;
  readonly hash: string;
}

/** Every zero-argument contract class in a blueprint module with its script and hash; a parameterised class throws without its arguments and is skipped. */
const enumerateContracts = (
  module: Record<string, unknown>,
): BlueprintContract[] =>
  Object.entries(module).flatMap(([className, exported]) => {
    if (!isContractConstructor(exported)) return [];
    return Option.match(Either.getRight(Either.try(() => new exported())), {
      onNone: () => [],
      onSome: ({ Script }) => [
        { className, script: Script, hash: Script.hash() },
      ],
    });
  });
