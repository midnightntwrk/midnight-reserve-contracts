/**
 * The multi-phase Aiken build: compile, copy the validator hashes into
 * aiken.toml, recompile, until the logic validators embed the final
 * threshold hashes. From-deployed mode compiles once against the hashes in
 * deployed-scripts/<env>/plutus.json and restores aiken.toml afterwards.
 *
 * Every step is an Effect over Output. Failures: ConfigError for aiken.toml,
 * BlueprintError for a validator missing from a blueprint, AikenBuildError
 * for a non-zero aiken exit, a stale blueprint file or stale logic bytecode.
 */
import { resolve } from "path";
import {
  Command,
  type CommandExecutor,
  FileSystem,
  type Error as PlatformError,
} from "@effect/platform";
import { Clock, Effect, Either, Option, Ref } from "effect";
import { type DeployedScripts, snapshotDirOf, validatorName } from "./versions";
import { PlutusJson, type PlutusValidator } from "./plutus-json";
import { readJsonFile } from "../input";
import type { Profile } from "../config/network-mapping";
import { Output } from "../output";
import {
  AikenBuildError,
  BlueprintError,
  ConfigError,
  PinsMoved,
} from "../errors";

/** The aiken trace levels, as --trace takes them. */
export const TRACE_LEVELS = ["silent", "verbose", "compact"] as const;

export type TraceLevel = (typeof TRACE_LEVELS)[number];

/** The platform services the build uses: files and subprocesses. */
type Platform = FileSystem.FileSystem | CommandExecutor.CommandExecutor;

/** What a build compiles against: its own hashes (the multi-phase build), or the deployed ones, except the validators it compiles from new. */
export type BuildSource =
  | { readonly kind: "standard" }
  | { readonly kind: "fromDeployed"; readonly fresh: ReadonlySet<string> };

export interface BuildOptions {
  network: Profile;
  traceLevel: TraceLevel;
  source: BuildSource;
  projectRoot: string;
}

interface ValidatorMapping {
  readonly title: string;
  readonly tomlKey: string;
}

interface LogicDependency {
  readonly logicValidator: string;
  readonly dependencyValidator: string;
}

/** One build: where it runs, which profile, where the blueprint lands. */
interface Build {
  readonly projectRoot: string;
  readonly network: Profile;
  readonly outputFile: string;
  readonly blueprintPath: string;
  readonly traceLevel: TraceLevel;
  /** aiken.toml keys held at a deployed hash in every phase (a from-deployed build); empty for a standard build. */
  readonly pins: ReadonlyMap<string, string>;
}

const TWO_STAGE_CORE = [
  {
    title: "reserve.reserve_two_stage_upgrade.else",
    tomlKey: "reserve_two_stage_hash",
  },
  {
    title: "permissioned.council_two_stage_upgrade.else",
    tomlKey: "council_two_stage_hash",
  },
  {
    title: "illiquid_circulation_supply.ics_two_stage_upgrade.else",
    tomlKey: "ics_two_stage_hash",
  },
  {
    title: "permissioned.tech_auth_two_stage_upgrade.else",
    tomlKey: "technical_authority_two_stage_hash",
  },
  {
    title: "permissioned.federated_ops_two_stage_upgrade.else",
    tomlKey: "federated_operators_two_stage_hash",
  },
  {
    title: "terms_and_conditions.terms_and_conditions_two_stage_upgrade.else",
    tomlKey: "terms_and_conditions_two_stage_hash",
  },
] as const satisfies readonly ValidatorMapping[];

const TWO_STAGE_EXTRA = [
  {
    title: "cnight_minting.cnight_mint_two_stage_upgrade.else",
    tomlKey: "cnight_minting_two_stage_hash",
  },
  {
    title: "committee_bridge.committee_bridge_two_stage_upgrade.else",
    tomlKey: "committee_bridge_two_stage_hash",
  },
  {
    title: "rewards_pool.rewards_pool_two_stage_upgrade.else",
    tomlKey: "rewards_pool_two_stage_hash",
  },
] as const satisfies readonly ValidatorMapping[];

const FOREVER_CORE = [
  { title: "reserve.reserve_forever.else", tomlKey: "reserve_forever_hash" },
  {
    title: "permissioned.council_forever.else",
    tomlKey: "council_forever_hash",
  },
  {
    title: "illiquid_circulation_supply.ics_forever.else",
    tomlKey: "ics_forever_hash",
  },
  {
    title: "permissioned.tech_auth_forever.else",
    tomlKey: "technical_authority_forever_hash",
  },
  {
    title: "permissioned.federated_ops_forever.else",
    tomlKey: "federated_operators_forever_hash",
  },
  {
    title: "terms_and_conditions.terms_and_conditions_forever.else",
    tomlKey: "terms_and_conditions_forever_hash",
  },
] as const satisfies readonly ValidatorMapping[];

const FOREVER_EXTRA = [
  {
    title: "cnight_minting.cnight_mint_forever.else",
    tomlKey: "cnight_minting_forever_hash",
  },
  {
    title: "committee_bridge.committee_bridge_forever.else",
    tomlKey: "committee_bridge_forever_hash",
  },
  // Depends on the two-stage hash only; built in the forever phase.
  {
    title: "committee_bridge_pool.committee_bridge_pool.else",
    tomlKey: "committee_bridge_pool_hash",
  },
  {
    title: "rewards_pool.rewards_pool_forever.else",
    tomlKey: "rewards_pool_forever_hash",
  },
] as const satisfies readonly ValidatorMapping[];

const THRESHOLDS = [
  {
    title: "thresholds.main_gov_threshold.else",
    tomlKey: "main_gov_threshold_hash",
  },
  {
    title: "thresholds.staging_gov_threshold.else",
    tomlKey: "staging_gov_threshold_hash",
  },
  {
    title: "thresholds.main_council_update_threshold.else",
    tomlKey: "main_council_update_threshold_hash",
  },
  {
    title: "thresholds.main_tech_auth_update_threshold.else",
    tomlKey: "main_tech_auth_update_threshold_hash",
  },
  {
    title: "thresholds.main_federated_ops_update_threshold.else",
    tomlKey: "main_federated_ops_update_threshold_hash",
  },
  {
    title: "thresholds.terms_and_conditions_threshold.else",
    tomlKey: "terms_and_conditions_threshold_hash",
  },
  {
    title: "thresholds.beefy_signer_threshold.else",
    tomlKey: "beefy_signer_threshold_hash",
  },
] as const satisfies readonly ValidatorMapping[];

/** Validators whose hash is published to aiken.toml after the threshold phase; the account and pool logic embed the batcher's. */
const FIXED = [
  {
    title: "rewards_batcher.rewards_batcher.else",
    tomlKey: "rewards_batcher_hash",
  },
  {
    title: "virtual_account.virtual_account.else",
    tomlKey: "virtual_account_hash",
  },
] as const satisfies readonly ValidatorMapping[];

/** Validators grouped by compilation phase. */
const VALIDATORS = {
  twoStage: [...TWO_STAGE_CORE, ...TWO_STAGE_EXTRA],
  forever: [...FOREVER_CORE, ...FOREVER_EXTRA],
  thresholds: THRESHOLDS,
  fixed: FIXED,
} as const;

/** Logic validators that must embed specific threshold hashes. */
const LOGIC_DEPENDENCIES: readonly LogicDependency[] = [
  {
    logicValidator: "permissioned.council_logic.else",
    dependencyValidator: "thresholds.main_council_update_threshold.else",
  },
  {
    logicValidator: "permissioned.tech_auth_logic.else",
    dependencyValidator: "thresholds.main_tech_auth_update_threshold.else",
  },
  {
    logicValidator: "permissioned.federated_ops_logic.else",
    dependencyValidator: "thresholds.main_federated_ops_update_threshold.else",
  },
  {
    logicValidator: "gov_auth.main_gov_auth.else",
    dependencyValidator: "thresholds.main_gov_threshold.else",
  },
  {
    logicValidator: "committee_bridge.committee_bridge_logic.else",
    dependencyValidator: "thresholds.beefy_signer_threshold.else",
  },
  {
    logicValidator: "committee_bridge.committee_bridge_logic.else",
    dependencyValidator: "committee_bridge.committee_bridge_forever.else",
  },
  {
    logicValidator: "committee_bridge.committee_bridge_logic.else",
    dependencyValidator: "committee_bridge_pool.committee_bridge_pool.else",
  },
] as const;

const MAX_VERIFY_ATTEMPTS = 2;
const TOML_FILE = "aiken.toml";
const LOCK_FILE = "build/aiken-compile.lock";
const TCNIGHT_TITLE = "test_cnight_no_audit.tcnight_mint_infinite.else";

const buildError = (phase: string, reason: string) =>
  new AikenBuildError({ phase, reason });

const nowSeconds = Effect.map(Clock.currentTimeMillis, (millis) =>
  Math.floor(millis / 1000),
);

const sectionBody = (content: string, start: number): string => {
  const rest = content.substring(start);
  const next = rest.search(/\n\[/);
  return next === -1 ? rest : rest.substring(0, next);
};

/** Replace `key = "..."` inside the section that starts at `start`. */
const replaceSectionKey = (
  content: string,
  start: number,
  key: "bytes" | "encoding",
  value: string,
  tomlKey: string,
): Either.Either<string, ConfigError> => {
  const match = sectionBody(content, start).match(
    new RegExp(`(\\n\\s*${key}\\s*=\\s*)"[^"]*"`),
  );
  if (!match || match.index === undefined) {
    return Either.left(
      new ConfigError({
        source: "aiken.toml",
        key: tomlKey,
        reason: `${key} key not found in existing section`,
      }),
    );
  }
  const at = start + match.index;
  return Either.right(
    content.substring(0, at) +
      `${match[1]}"${value}"` +
      content.substring(at + match[0].length),
  );
};

/** Insert a new section after the last line of the network's config block, or at the end. */
const appendSection = (
  content: string,
  network: string,
  section: string,
): string => {
  const lines = content.split("\n");
  let lastNetworkLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith(`[config.${network}.`) ||
      trimmed.startsWith(`[config.${network}]`)
    ) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith("[")) j++;
      lastNetworkLine = j - 1;
    }
  }
  if (lastNetworkLine === -1) return content.trimEnd() + "\n" + section;
  return (
    lines.slice(0, lastNetworkLine + 1).join("\n") +
    section +
    lines.slice(lastNetworkLine + 1).join("\n")
  );
};

/** aiken.toml text with config.<network>.<key> set to hex bytes; formatting is preserved. */
export const withTomlHexValue = (
  content: string,
  network: string,
  key: string,
  value: string,
): Either.Either<string, ConfigError> => {
  const header = `[config.${network}.${key}]`;
  const tomlKey = `config.${network}.${key}`;
  const index = content.indexOf(header);
  if (index === -1) {
    return Either.right(
      appendSection(
        content,
        network,
        `\n${header}\nbytes = "${value}"\nencoding = "hex"\n`,
      ),
    );
  }
  const start = index + header.length;
  return Either.flatMap(
    replaceSectionKey(content, start, "bytes", value, tomlKey),
    (next) => replaceSectionKey(next, start, "encoding", "hex", tomlKey),
  );
};

/** A FileSystem failure on aiken.toml, its temp file or its backup as a ConfigError; the platform message names the file. */
const tomlFailure = (cause: PlatformError.PlatformError) =>
  new ConfigError({ source: "aiken.toml", key: "", reason: cause.message });

/** Write aiken.toml through a temp file and a rename, so a crash leaves the old file intact. */
const writeTomlAtomic = (
  fs: FileSystem.FileSystem,
  projectRoot: string,
  content: string,
): Effect.Effect<void, ConfigError> => {
  const tomlPath = resolve(projectRoot, TOML_FILE);
  const tmpPath = `${tomlPath}.${process.pid}.tmp`;
  return Effect.mapError(
    Effect.uninterruptible(
      Effect.zipRight(
        fs.writeFileString(tmpPath, content, { mode: 0o644 }),
        fs.rename(tmpPath, tomlPath),
      ),
    ),
    tomlFailure,
  );
};

const setTomlHexValue = (
  projectRoot: string,
  network: string,
  key: string,
  value: string,
): Effect.Effect<void, ConfigError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* Effect.mapError(
      fs.readFileString(resolve(projectRoot, TOML_FILE)),
      tomlFailure,
    );
    const next = yield* withTomlHexValue(content, network, key, value);
    yield* writeTomlAtomic(fs, projectRoot, next);
  });

const validatorByTitle = (
  blueprint: PlutusJson,
  title: string,
): Option.Option<PlutusValidator> =>
  Option.fromNullable(blueprint.validators.find((v) => v.title === title));

const requireValidator = (
  blueprint: PlutusJson,
  title: string,
  environment: string,
  source: "build" | "deployed",
): Either.Either<PlutusValidator, BlueprintError> =>
  Either.fromOption(
    validatorByTitle(blueprint, title),
    () =>
      new BlueprintError({
        environment,
        source,
        reason: `validator '${title}' not found in blueprint`,
      }),
  );

/** The blueprint at `path`, which must exist, postdate `startedAt` and parse. */
export const freshBlueprint = (
  path: string,
  phase: string,
  startedAt: number,
): Effect.Effect<PlutusJson, AikenBuildError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const failure = (reason: string) => buildError(phase, reason);
    const info = yield* Effect.mapError(fs.stat(path), (cause) =>
      failure(cause.message),
    );
    if (Option.isNone(info.mtime)) {
      return yield* failure(`${path} has no modification time.`);
    }
    const mtimeSeconds = Math.floor(info.mtime.value.getTime() / 1000);
    if (mtimeSeconds < startedAt) {
      return yield* failure(`${path} was not refreshed after ${phase}.`);
    }
    return yield* readJsonFile(path, PlutusJson, (reason) =>
      failure(`${path} could not be parsed after ${phase}: ${reason}`),
    );
  });

const updateHashes = (
  build: Build,
  blueprint: PlutusJson,
  source: "build" | "deployed",
  mappings: readonly ValidatorMapping[],
): Effect.Effect<void, BlueprintError | ConfigError, FileSystem.FileSystem> =>
  Effect.forEach(
    mappings,
    (mapping) =>
      Effect.flatMap(
        Option.match(Option.fromNullable(build.pins.get(mapping.tomlKey)), {
          onNone: () =>
            Effect.map(
              requireValidator(blueprint, mapping.title, build.network, source),
              (validator) => validator.hash,
            ),
          onSome: Effect.succeed,
        }),
        (hash) =>
          setTomlHexValue(
            build.projectRoot,
            build.network,
            mapping.tomlKey,
            hash,
          ),
      ),
    { discard: true },
  );

/** A pinned validator must compile to its deployed hash; one that does not depends on a validator compiled from new, or aiken.toml does not describe the deployment. */
export const keepsPins = (
  pins: ReadonlyMap<string, string>,
  blueprint: PlutusJson,
): Effect.Effect<void, PinsMoved> => {
  const moved = [...TWO_STAGE_CORE, ...FOREVER_CORE, ...THRESHOLDS].flatMap(
    (mapping) => {
      const deployed = pins.get(mapping.tomlKey);
      return Option.match(validatorByTitle(blueprint, mapping.title), {
        onNone: () => [],
        onSome: (v) =>
          deployed !== undefined && v.hash !== deployed
            ? [
                {
                  validator: validatorName(mapping.title),
                  deployed,
                  built: v.hash,
                },
              ]
            : [],
      });
    },
  );
  return moved.length === 0
    ? Effect.void
    : Effect.fail(new PinsMoved({ moved }));
};

const refreshAllValidatorHashes = (
  build: Build,
  blueprint: PlutusJson,
): Effect.Effect<
  void,
  BlueprintError | ConfigError,
  Output | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log("Refreshing validator hashes from current blueprint...");
    yield* updateHashes(build, blueprint, "build", VALIDATORS.twoStage);
    yield* updateHashes(build, blueprint, "build", VALIDATORS.forever);
    yield* updateHashes(build, blueprint, "build", VALIDATORS.thresholds);
    yield* updateHashes(build, blueprint, "build", VALIDATORS.fixed);
  });

/** Point cnight_policy at tcnight_mint_infinite on every network but mainnet. */
const updateCnightPolicy = (
  build: Build,
  blueprint: PlutusJson,
): Effect.Effect<void, ConfigError, Output | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const output = yield* Output;
    if (build.network === "mainnet") {
      return yield* output.log(
        "Skipping cnight_policy update for mainnet (managed separately)",
      );
    }
    const tcnight = validatorByTitle(blueprint, TCNIGHT_TITLE);
    if (Option.isNone(tcnight)) {
      return yield* output.log(
        "Warning: Could not get tcnight_mint_infinite hash, keeping existing cnight_policy",
      );
    }
    yield* output.log(
      `Updating cnight_policy for ${build.network} network to tcnight_mint_infinite hash...`,
    );
    yield* setTomlHexValue(
      build.projectRoot,
      build.network,
      "cnight_policy",
      tcnight.value.hash,
    );
  });

/** Why the first logic validator whose bytecode does not embed its dependency's hash is stale. */
export const staleDependency = (
  blueprint: PlutusJson,
): Option.Option<string> => {
  for (const dep of LOGIC_DEPENDENCIES) {
    const dependency = validatorByTitle(blueprint, dep.dependencyValidator);
    if (Option.isNone(dependency)) {
      return Option.some(
        `dependency ${dep.dependencyValidator} not found in blueprint`,
      );
    }
    const logic = validatorByTitle(blueprint, dep.logicValidator);
    if (Option.isNone(logic)) {
      return Option.some(
        `validator ${dep.logicValidator} not found in blueprint`,
      );
    }
    if (
      !logic.value.compiledCode
        .toLowerCase()
        .includes(dependency.value.hash.toLowerCase())
    ) {
      return Option.some(
        `${dep.logicValidator} does not embed dependency ${dep.dependencyValidator}`,
      );
    }
  }
  return Option.none();
};

const VERIFY_PHASE = "verify";

const verifyLogicDependencies = (
  blueprint: PlutusJson,
): Effect.Effect<void, AikenBuildError, Output> =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log(
      "Verifying logic validators reference updated threshold hashes...",
    );
    const stale = staleDependency(blueprint);
    if (Option.isSome(stale)) {
      return yield* buildError(
        VERIFY_PHASE,
        `Logic validators still reference stale threshold hashes: ${stale.value}`,
      );
    }
  });

/** Why a process gave no exit code: a signal stopped it, or it never started. */
export const processFailure = (
  what: string,
  cause: PlatformError.PlatformError,
): string =>
  cause.method === "exitCode"
    ? `${what} was stopped: ${cause.message}`
    : `${what} could not start: ${cause.message}`;

/** Exit code of a process with inherited stdio, killed on interruption; `onFailure` names the error when it gives none. */
export const processExitCode = <E>(
  command: readonly [string, ...string[]],
  cwd: string,
  onFailure: (cause: PlatformError.PlatformError) => E,
): Effect.Effect<number, E, CommandExecutor.CommandExecutor> =>
  Effect.mapBoth(
    Command.make(...command).pipe(
      Command.workingDirectory(cwd),
      Command.stdout("inherit"),
      Command.stderr("inherit"),
      Command.exitCode,
    ),
    { onFailure, onSuccess: Number },
  );

const aikenBuild = (
  build: Build,
  phase: string,
): Effect.Effect<void, AikenBuildError, CommandExecutor.CommandExecutor> =>
  Effect.flatMap(
    processExitCode(
      [
        "aiken",
        "build",
        "-S",
        "--env",
        build.network,
        "-o",
        build.outputFile,
        "-t",
        build.traceLevel,
      ],
      build.projectRoot,
      (cause) => buildError(phase, processFailure("aiken build", cause)),
    ),
    (exitCode) =>
      exitCode === 0
        ? Effect.void
        : Effect.fail(
            buildError(phase, `aiken build failed with exit code ${exitCode}`),
          ),
  );

/** Run aiken build and read back the refreshed blueprint. */
const compile = (
  build: Build,
  phase: string,
): Effect.Effect<PlutusJson, AikenBuildError, Platform> =>
  Effect.gen(function* () {
    const startedAt = yield* nowSeconds;
    yield* aikenBuild(build, phase);
    return yield* freshBlueprint(build.blueprintPath, phase, startedAt);
  });

const compilePhase = (
  build: Build,
  phase: string,
): Effect.Effect<PlutusJson, AikenBuildError, Output | Platform> =>
  Effect.flatMap(Output, (output) =>
    Effect.zipRight(output.log(`Building ${phase}...`), compile(build, phase)),
  );

/** Remove a file if it exists; the failure names the phase. */
const removeIfPresent = (
  path: string,
  phase: string,
): Effect.Effect<void, AikenBuildError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    Effect.mapError(fs.remove(path, { force: true }), (cause) =>
      buildError(phase, cause.message),
    ),
  );

/** The core hashes a from-deployed build pins: each one the deployed plutus.json has, except the validators compiled from new. */
export const pinnedMappings = (
  deployed: PlutusJson,
  fresh: ReadonlySet<string>,
): (ValidatorMapping & { readonly hash: string })[] =>
  [...TWO_STAGE_CORE, ...FOREVER_CORE, ...THRESHOLDS].flatMap((mapping) =>
    Option.match(validatorByTitle(deployed, mapping.title), {
      onNone: () => [],
      onSome: (validator) =>
        fresh.has(validatorName(mapping.title))
          ? []
          : [{ ...mapping, hash: validator.hash }],
    }),
  );

const buildFromDeployed = (
  build: Build,
  fresh: ReadonlySet<string>,
): Effect.Effect<
  void,
  BlueprintError | ConfigError | AikenBuildError | PinsMoved,
  Output | Platform | DeployedScripts
> =>
  Effect.gen(function* () {
    const output = yield* Output;
    const deployedJsonFile = resolve(
      yield* snapshotDirOf(build.network),
      "plutus.json",
    );
    const fs = yield* FileSystem.FileSystem;
    const tomlPath = resolve(build.projectRoot, TOML_FILE);
    const backupPath = resolve(
      build.projectRoot,
      `${TOML_FILE}.backup.${process.pid}`,
    );
    const backup = Effect.mapError(
      fs.copyFile(tomlPath, backupPath),
      tomlFailure,
    );
    const restore = Effect.orDie(
      Effect.zipRight(fs.copyFile(backupPath, tomlPath), fs.remove(backupPath)),
    );

    return yield* Effect.acquireUseRelease(
      backup,
      () =>
        Effect.gen(function* () {
          yield* output.log("Reading hashes from deployed scripts...");
          const deployed = yield* readJsonFile(
            deployedJsonFile,
            PlutusJson,
            (reason) =>
              new BlueprintError({
                environment: build.network,
                source: "deployed",
                reason: `${deployedJsonFile}: ${reason}`,
              }),
          );
          const pinned = pinnedMappings(deployed, fresh);
          yield* output.log(
            `Pinning ${pinned.length} deployed hashes; compiled from new: ${
              [...fresh].join(", ") || "(none)"
            }`,
          );
          const pins = new Map(pinned.map((m) => [m.tomlKey, m.hash]));
          yield* Effect.forEach(
            pinned,
            (m) =>
              setTomlHexValue(
                build.projectRoot,
                build.network,
                m.tomlKey,
                m.hash,
              ),
            { discard: true },
          );
          yield* buildStandard({ ...build, pins });
          yield* output.log(
            `Built against deployed hashes from: ${deployedJsonFile}`,
          );
        }),
      () => restore,
    );
  });

/** The final compilation; on stale logic bytecode the caller retries after resetting the build lock. */
const finalCompile = (
  build: Build,
  attempts: Ref.Ref<number>,
): Effect.Effect<
  void,
  BlueprintError | ConfigError | AikenBuildError,
  Output | Platform
> =>
  Effect.gen(function* () {
    const output = yield* Output;
    const attempt = yield* Ref.getAndUpdate(attempts, (n) => n + 1);
    if (attempt > 0) {
      yield* output.log(
        "Detected stale logic bytecode; rebuilding with refreshed hashes...",
      );
      yield* removeIfPresent(resolve(build.projectRoot, LOCK_FILE), "clean");
      yield* removeIfPresent(build.blueprintPath, "clean");
    }
    const blueprint = yield* compile(build, "Final compilation");
    yield* refreshAllValidatorHashes(build, blueprint);
    yield* verifyLogicDependencies(blueprint);
  });

const buildStandard = (
  build: Build,
): Effect.Effect<
  void,
  BlueprintError | ConfigError | AikenBuildError | PinsMoved,
  Output | Platform
> =>
  Effect.gen(function* () {
    const output = yield* Output;

    yield* output.log("Initial compilation for cnight_policy...");
    const initial = yield* compilePhase(build, "Initial Build");
    yield* updateCnightPolicy(build, initial);

    yield* output.log("Phase 1: Setting up two-stage validators...");
    const twoStage = yield* compilePhase(build, "Two-Stage Validators");
    yield* output.log("Updating two-stage validator hashes...");
    yield* updateHashes(build, twoStage, "build", VALIDATORS.twoStage);

    yield* output.log("Phase 2: Setting up forever validators...");
    const forever = yield* compilePhase(build, "Forever Validators");
    yield* output.log("Updating forever validator hashes...");
    yield* updateHashes(build, forever, "build", VALIDATORS.forever);

    yield* output.log("Phase 3: Setting up threshold validators...");
    const thresholds = yield* compilePhase(build, "Threshold Validators");
    yield* keepsPins(build.pins, thresholds);
    yield* output.log("Updating threshold validator hashes...");
    yield* updateHashes(build, thresholds, "build", VALIDATORS.thresholds);
    yield* updateHashes(build, thresholds, "build", VALIDATORS.fixed);

    yield* output.log("Final compilation...");
    const attempts = yield* Ref.make(0);
    yield* Effect.retry(finalCompile(build, attempts), {
      times: MAX_VERIFY_ATTEMPTS - 1,
      while: (error) =>
        error._tag === "AikenBuildError" && error.phase === VERIFY_PHASE,
    });

    yield* output.log("==========================================");
    yield* output.log(
      `Successfully compiled midnight-reserve-contracts for ${build.network} network.`,
    );
    yield* output.log(`Blueprint written to: ${build.outputFile}`);
    yield* output.log(
      build.pins.size === 0
        ? "All validators have been compiled and hashes updated in aiken.toml"
        : "All validators have been compiled against the pinned hashes",
    );
  });

/** Build the Aiken contracts for a network: the multi-phase build, or one pass against deployed hashes. */
export const buildContracts = (
  opts: BuildOptions,
): Effect.Effect<
  void,
  ConfigError | BlueprintError | AikenBuildError | PinsMoved,
  Output | Platform | DeployedScripts
> =>
  Effect.gen(function* () {
    const output = yield* Output;
    const { projectRoot, network } = opts;
    const outputFile = `plutus-${network}.json`;
    const build: Build = {
      projectRoot,
      network,
      outputFile,
      blueprintPath: resolve(projectRoot, outputFile),
      traceLevel: opts.traceLevel,
      pins: new Map(),
    };

    yield* output.log(`Starting compilation for network: ${network}`);
    if (opts.source.kind === "fromDeployed") {
      yield* output.log(
        `Mode: Building against deployed hashes from deployed-scripts/${network}/plutus.json`,
      );
    }
    yield* output.log("==========================================");

    return yield* opts.source.kind === "fromDeployed"
      ? buildFromDeployed(build, opts.source.fresh)
      : buildStandard(build);
  });
