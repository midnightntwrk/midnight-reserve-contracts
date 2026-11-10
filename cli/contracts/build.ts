/**
 * The contract build: the multi-phase Aiken build (compile, copy the
 * validator hashes into aiken.toml, recompile, until the logic validators
 * embed the final threshold hashes), then the TypeScript bindings of its
 * blueprint, copied to contract_blueprint.ts.
 *
 * Every step is an Effect over Output. Failures: ConfigError for aiken.toml,
 * BlueprintError for a validator missing from a blueprint or a failed
 * bindings generation, AikenBuildError for a non-zero aiken exit, a stale
 * blueprint file or stale logic bytecode, FileWriteError for
 * contract_blueprint.ts.
 */
import { createRequire } from "module";
import { dirname, relative, resolve } from "path";
import {
  Clock,
  Effect,
  FileSystem,
  Option,
  type PlatformError,
  Ref,
  Result,
  Schema,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { PROJECT_ROOT, type ProfileName } from "../config";
import {
  AikenBuildError,
  BlueprintError,
  ConfigError,
  FileWriteError,
} from "../errors";
import { readJsonFile } from "../input";
import { Output } from "../output";

/** The aiken trace levels, as --trace takes them. */
export const TRACE_LEVELS = ["silent", "verbose", "compact"] as const;

export type TraceLevel = (typeof TRACE_LEVELS)[number];

/** A plutus.json blueprint, as far as the build reads it: its validators. */
export const PlutusJson = Schema.Struct({
  validators: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      hash: Schema.String,
      compiledCode: Schema.String,
    }),
  ),
});
export type PlutusJson = typeof PlutusJson.Type;

/** One build: where it runs, which profile, where the blueprint lands. */
interface Build {
  readonly projectRoot: string;
  readonly network: ProfileName;
  readonly outputFile: string;
  readonly blueprintPath: string;
  readonly traceLevel: TraceLevel;
}

/** A validator whose hash the build copies into aiken.toml. */
interface ValidatorMapping {
  readonly title: string;
  readonly tomlKey: string;
}

const TWO_STAGE: readonly ValidatorMapping[] = [
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
  {
    title: "cnight_minting.cnight_mint_two_stage_upgrade.else",
    tomlKey: "cnight_minting_two_stage_hash",
  },
];

const FOREVER: readonly ValidatorMapping[] = [
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
  {
    title: "cnight_minting.cnight_mint_forever.else",
    tomlKey: "cnight_minting_forever_hash",
  },
];

const THRESHOLDS: readonly ValidatorMapping[] = [
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
];

/** Logic validators that must embed specific threshold hashes. */
const LOGIC_DEPENDENCIES = [
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
] as const;

const MAX_VERIFY_ATTEMPTS = 2;
const VERIFY_PHASE = "verify";
const TOML_FILE = "aiken.toml";
const LOCK_FILE = "build/aiken-compile.lock";
const TCNIGHT_TITLE = "test_cnight_no_audit.tcnight_mint_infinite.else";

/** Replace `key = "..."` inside the section that starts at `start`. */
const replaceSectionKey = (
  content: string,
  start: number,
  key: "bytes" | "encoding",
  value: string,
  tomlKey: string,
): Result.Result<string, ConfigError> => {
  const rest = content.substring(start);
  const next = rest.search(/\n\[/);
  const section = next === -1 ? rest : rest.substring(0, next);
  const match = section.match(new RegExp(`(\\n\\s*${key}\\s*=\\s*)"[^"]*"`));
  if (!match || match.index === undefined) {
    return Result.fail(
      new ConfigError({
        source: "aiken.toml",
        key: tomlKey,
        reason: `${key} key not found in existing section`,
      }),
    );
  }
  const at = start + match.index;
  return Result.succeed(
    content.substring(0, at) +
      `${match[1]}"${value}"` +
      content.substring(at + match[0].length),
  );
};

/** aiken.toml text with config.<network>.<key> set to hex bytes; formatting is preserved. A new section goes after the last line of the network's config block, or at the end. */
export const withTomlHexValue = (
  content: string,
  network: string,
  key: string,
  value: string,
): Result.Result<string, ConfigError> => {
  const header = `[config.${network}.${key}]`;
  const index = content.indexOf(header);
  if (index !== -1) {
    const start = index + header.length;
    const tomlKey = `config.${network}.${key}`;
    return Result.flatMap(
      replaceSectionKey(content, start, "bytes", value, tomlKey),
      (next) => replaceSectionKey(next, start, "encoding", "hex", tomlKey),
    );
  }
  const section = `\n${header}\nbytes = "${value}"\nencoding = "hex"\n`;
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
  return Result.succeed(
    lastNetworkLine === -1
      ? content.trimEnd() + "\n" + section
      : lines.slice(0, lastNetworkLine + 1).join("\n") +
          section +
          lines.slice(lastNetworkLine + 1).join("\n"),
  );
};

/** Set config.<network>.<key> in aiken.toml, written through a temp file and a rename so a crash leaves the old file intact; a FileSystem failure names the file. */
const setTomlHexValue = (build: Build, key: string, value: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tomlPath = resolve(build.projectRoot, TOML_FILE);
    const tmpPath = `${tomlPath}.${process.pid}.tmp`;
    const failure = (cause: PlatformError.PlatformError) =>
      new ConfigError({ source: "aiken.toml", key: "", reason: cause.message });
    const content = yield* Effect.mapError(
      fs.readFileString(tomlPath),
      failure,
    );
    const next = yield* Effect.fromResult(
      withTomlHexValue(content, build.network, key, value),
    );
    yield* Effect.mapError(
      Effect.uninterruptible(
        Effect.andThen(
          fs.writeFileString(tmpPath, next, { mode: 0o644 }),
          fs.rename(tmpPath, tomlPath),
        ),
      ),
      failure,
    );
  });

const validatorByTitle = (blueprint: PlutusJson, title: string) =>
  Option.fromNullishOr(blueprint.validators.find((v) => v.title === title));

/** The blueprint at `path`, which must exist, postdate `startedAt` (seconds) and parse. */
export const freshBlueprint = (
  path: string,
  phase: string,
  startedAt: number,
): Effect.Effect<PlutusJson, AikenBuildError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const failure = (reason: string) => new AikenBuildError({ phase, reason });
    const info = yield* Effect.mapError(fs.stat(path), (cause) =>
      failure(cause.message),
    );
    if (Option.isNone(info.mtime)) {
      return yield* failure(`${path} has no modification time.`);
    }
    if (Math.floor(info.mtime.value.getTime() / 1000) < startedAt) {
      return yield* failure(`${path} was not refreshed after ${phase}.`);
    }
    return yield* readJsonFile(path, PlutusJson, (reason) =>
      failure(`${path} could not be parsed after ${phase}: ${reason}`),
    );
  });

/** Copy each mapped validator's hash from the blueprint into aiken.toml. */
const updateHashes = (
  build: Build,
  blueprint: PlutusJson,
  mappings: readonly ValidatorMapping[],
) =>
  Effect.forEach(
    mappings,
    (
      mapping,
    ): Effect.Effect<
      void,
      BlueprintError | ConfigError,
      FileSystem.FileSystem
    > =>
      Option.match(validatorByTitle(blueprint, mapping.title), {
        onNone: () =>
          Effect.fail(
            new BlueprintError({
              environment: build.network,
              source: "build",
              reason: `validator '${mapping.title}' not found in blueprint`,
            }),
          ),
        onSome: (validator) =>
          setTomlHexValue(build, mapping.tomlKey, validator.hash),
      }),
    { discard: true },
  );

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

/** Why a process gave no exit code: a signal stopped it, or it never started. */
export const processFailure = (
  what: string,
  cause: PlatformError.PlatformError,
): string =>
  cause.reason.method === "exitCode"
    ? `${what} was stopped: ${cause.message}`
    : `${what} could not start: ${cause.message}`;

/** Exit code of a process with inherited stdout and stderr, killed on interruption; `onFailure` names the error when it gives none. */
export const processExitCode = <E>(
  command: readonly [string, ...string[]],
  cwd: string,
  onFailure: (cause: PlatformError.PlatformError) => E,
): Effect.Effect<number, E, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    Effect.mapBoth(
      spawner.exitCode(
        ChildProcess.make(command[0], command.slice(1), {
          cwd,
          stdout: "inherit",
          stderr: "inherit",
        }),
      ),
      { onFailure, onSuccess: Number },
    ),
  );

/** Run aiken build for one phase and read back the refreshed blueprint. */
const compile = (build: Build, phase: string) =>
  Effect.gen(function* () {
    const startedAt = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    const exitCode = yield* processExitCode(
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
      (cause) =>
        new AikenBuildError({
          phase,
          reason: processFailure("aiken build", cause),
        }),
    );
    if (exitCode !== 0) {
      return yield* new AikenBuildError({
        phase,
        reason: `aiken build failed with exit code ${exitCode}`,
      });
    }
    return yield* freshBlueprint(build.blueprintPath, phase, startedAt);
  });

/** The final compilation; on stale logic bytecode the caller retries after removing the build lock and the blueprint. */
const finalCompile = (build: Build, attempts: Ref.Ref<number>) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const fs = yield* FileSystem.FileSystem;
    if ((yield* Ref.getAndUpdate(attempts, (n) => n + 1)) > 0) {
      yield* output.log(
        "Detected stale logic bytecode; rebuilding with refreshed hashes...",
      );
      for (const path of [
        resolve(build.projectRoot, LOCK_FILE),
        build.blueprintPath,
      ]) {
        yield* Effect.mapError(
          fs.remove(path, { force: true }),
          (cause) =>
            new AikenBuildError({ phase: "clean", reason: cause.message }),
        );
      }
    }
    const blueprint = yield* compile(build, "Final compilation");
    yield* output.log("Refreshing validator hashes from current blueprint...");
    yield* updateHashes(build, blueprint, TWO_STAGE);
    yield* updateHashes(build, blueprint, FOREVER);
    yield* updateHashes(build, blueprint, THRESHOLDS);
    yield* output.log(
      "Verifying logic validators reference updated threshold hashes...",
    );
    const stale = staleDependency(blueprint);
    if (Option.isSome(stale)) {
      return yield* new AikenBuildError({
        phase: VERIFY_PHASE,
        reason: `Logic validators still reference stale threshold hashes: ${stale.value}`,
      });
    }
  });

/** Build the Aiken contracts of a profile in `projectRoot`: compile in phases, each copying its hashes into aiken.toml, then a verified final compilation. */
export const buildContracts = (options: {
  readonly network: ProfileName;
  readonly traceLevel: TraceLevel;
  readonly projectRoot: string;
}) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const outputFile = `plutus-${options.network}.json`;
    const build: Build = {
      ...options,
      outputFile,
      blueprintPath: resolve(options.projectRoot, outputFile),
    };

    yield* output.log(`Starting compilation for network: ${build.network}`);
    yield* output.log("==========================================");

    yield* output.log("Initial compilation for cnight_policy...");
    yield* output.log("Building Initial Build...");
    const initial = yield* compile(build, "Initial Build");
    // cnight_policy is tcnight_mint_infinite on every network but mainnet.
    const tcnight = validatorByTitle(initial, TCNIGHT_TITLE);
    if (build.network === "mainnet") {
      yield* output.log(
        "Skipping cnight_policy update for mainnet (managed separately)",
      );
    } else if (Option.isNone(tcnight)) {
      yield* output.log(
        "Warning: Could not get tcnight_mint_infinite hash, keeping existing cnight_policy",
      );
    } else {
      yield* output.log(
        `Updating cnight_policy for ${build.network} network to tcnight_mint_infinite hash...`,
      );
      yield* setTomlHexValue(build, "cnight_policy", tcnight.value.hash);
    }

    yield* output.log("Phase 1: Setting up two-stage validators...");
    yield* output.log("Building Two-Stage Validators...");
    const twoStage = yield* compile(build, "Two-Stage Validators");
    yield* output.log("Updating two-stage validator hashes...");
    yield* updateHashes(build, twoStage, TWO_STAGE);

    yield* output.log("Phase 2: Setting up forever validators...");
    yield* output.log("Building Forever Validators...");
    const forever = yield* compile(build, "Forever Validators");
    yield* output.log("Updating forever validator hashes...");
    yield* updateHashes(build, forever, FOREVER);

    yield* output.log("Phase 3: Setting up threshold validators...");
    yield* output.log("Building Threshold Validators...");
    const thresholds = yield* compile(build, "Threshold Validators");
    yield* output.log("Updating threshold validator hashes...");
    yield* updateHashes(build, thresholds, THRESHOLDS);

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
      "All validators have been compiled and hashes updated in aiken.toml",
    );
  });

/** Build the contracts of a profile in the repository, then generate contract_blueprint_<profile>.ts with the installed generator, the script its package.json "bin" names, run on this Node so no registry is reached (its stderr reaches the user, its one-line stdout does not), and copy it to contract_blueprint.ts. */
export const buildProgram = (input: {
  readonly network: ProfileName;
  readonly trace: TraceLevel;
}) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const env = input.network;
    yield* buildContracts({
      network: env,
      traceLevel: input.trace,
      projectRoot: PROJECT_ROOT,
    });

    const plutusPath = resolve(PROJECT_ROOT, `plutus-${env}.json`);
    const blueprintPath = resolve(PROJECT_ROOT, `contract_blueprint_${env}.ts`);
    yield* output.log(`\nGenerating TypeScript bindings...`);
    const failure = (reason: string) =>
      new BlueprintError({ environment: env, source: "build", reason });
    const manifest = yield* Effect.try({
      try: () =>
        createRequire(import.meta.url).resolve(
          "@blaze-cardano/blueprint/package.json",
        ),
      catch: (cause) =>
        failure(`the blueprint generator is not installed: ${String(cause)}`),
    });
    const { bin } = yield* readJsonFile(
      manifest,
      Schema.Struct({ bin: Schema.String }),
      (reason) => failure(`${manifest}: ${reason}`),
    );
    const exitCode = yield* Effect.mapError(
      spawner.exitCode(
        ChildProcess.make(
          process.execPath,
          [resolve(dirname(manifest), bin), plutusPath, "-o", blueprintPath],
          { stderr: "inherit" },
        ),
      ),
      (cause) => failure(`blueprint generation failed: ${cause.message}`),
    );
    if (exitCode !== 0) {
      return yield* failure(
        `blueprint generation failed with exit code ${exitCode}`,
      );
    }

    const activePath = resolve(PROJECT_ROOT, "contract_blueprint.ts");
    yield* Effect.mapError(
      fs.copyFile(blueprintPath, activePath),
      (cause) =>
        new FileWriteError({ path: activePath, reason: cause.message }),
    );
    yield* output.log(
      `TypeScript bindings written to: ${relative(PROJECT_ROOT, blueprintPath)}`,
    );
    yield* output.log(`Copied to: contract_blueprint.ts`);
  });
