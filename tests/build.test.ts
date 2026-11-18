import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Option, Result, Schema } from "effect";
import { DeployedScripts } from "../cli/config";
import {
  buildContracts,
  freshBlueprint,
  keepsPins,
  pinnedMappings,
  processExitCode,
  processFailure,
  staleDependency,
  withTomlHexValue,
} from "../cli/contracts/build";
import { DEPLOY_COMPONENT_VALIDATORS } from "../cli/contracts/resolver";
import { PlutusJson } from "../cli/contracts/snapshot-read";
import { captureOutput } from "./helpers/output";

const tmp = mkdtempSync(join(tmpdir(), "build-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const toml = `name = "x"

[config.default]
foo = 1

[config.default.reserve_forever_hash]
bytes = "aa"
encoding = "hex"

[config.preview]
foo = 2

[config.preview.reserve_forever_hash]
bytes = "bb"
encoding = "base16"
`;

describe("withTomlHexValue", () => {
  it("replaces bytes and encoding inside the matching section only", () => {
    expect(
      Result.getOrThrow(
        withTomlHexValue(toml, "preview", "reserve_forever_hash", "cc"),
      ),
    ).toBe(
      toml.replace(
        'bytes = "bb"\nencoding = "base16"',
        'bytes = "cc"\nencoding = "hex"',
      ),
    );
  });

  it("appends a new key after the network's last section", () => {
    const result = Result.getOrThrow(
      withTomlHexValue(toml, "default", "new_hash", "dd"),
    );
    const index = result.indexOf(
      '[config.default.new_hash]\nbytes = "dd"\nencoding = "hex"',
    );
    expect(index).toBeGreaterThan(toml.indexOf('bytes = "aa"'));
    expect(index).toBeLessThan(result.indexOf("[config.preview]"));
  });

  it("an unknown network is appended at the end", () => {
    expect(
      Result.getOrThrow(withTomlHexValue(toml, "mainnet", "k", "ee")),
    ).toBe(
      toml.trimEnd() +
        '\n\n[config.mainnet.k]\nbytes = "ee"\nencoding = "hex"\n',
    );
  });

  it("a section without a bytes key is a ConfigError naming it", () => {
    const broken = '[config.default.k]\nencoding = "hex"\n';
    expect(
      Result.getOrThrow(
        Result.flip(withTomlHexValue(broken, "default", "k", "ff")),
      ),
    ).toMatchObject({ _tag: "ConfigError", key: "config.default.k" });
  });

  it("rewrites only the target bytes in the real aiken.toml", () => {
    const real = readFileSync("aiken.toml", "utf-8");
    const zeros = "00".repeat(28);
    const bytes = /(\[config\.default\.reserve_forever_hash\]\nbytes = ")\w+/;
    expect(
      Result.getOrThrow(
        withTomlHexValue(real, "default", "reserve_forever_hash", zeros),
      ),
    ).toBe(real.replace(bytes, `$1${zeros}`));
  });
});

describe("staleDependency", () => {
  const validator = (title: string, hash: string, compiledCode: string) => ({
    title,
    hash,
    compiledCode,
  });
  const complete: PlutusJson = {
    validators: [
      validator("thresholds.main_council_update_threshold.else", "AA", ""),
      validator("thresholds.main_tech_auth_update_threshold.else", "bb", ""),
      validator(
        "thresholds.main_federated_ops_update_threshold.else",
        "cc",
        "",
      ),
      validator("thresholds.main_gov_threshold.else", "dd", ""),
      validator("permissioned.council_logic.else", "", "00aa00"),
      validator("permissioned.tech_auth_logic.else", "", "00bb00"),
      validator("permissioned.federated_ops_logic.else", "", "00cc00"),
      validator("gov_auth.main_gov_auth.else", "", "00dd00"),
    ],
    definitions: {},
  };

  it("every logic validator embedding its dependency is fresh", () => {
    expect(staleDependency(complete)).toEqual(Option.none());
  });

  it("a logic validator without its dependency hash names both", () => {
    const stale = {
      ...complete,
      validators: complete.validators.map((v) =>
        v.title === "gov_auth.main_gov_auth.else"
          ? { ...v, compiledCode: "0000" }
          : v,
      ),
    };
    expect(staleDependency(stale)).toEqual(
      Option.some(
        "gov_auth.main_gov_auth.else does not embed dependency thresholds.main_gov_threshold.else",
      ),
    );
  });

  it("a missing dependency validator is reported first", () => {
    const missing = {
      ...complete,
      validators: complete.validators.slice(1),
    };
    expect(staleDependency(missing)).toEqual(
      Option.some(
        "dependency thresholds.main_council_update_threshold.else not found in blueprint",
      ),
    );
  });
});

describe("freshBlueprint", () => {
  const failure = (path: string, phase: string, startedAt: number) =>
    Effect.flip(freshBlueprint(path, phase, startedAt)).pipe(
      Effect.provide(NodeServices.layer),
    );

  it.live("a missing file fails for the phase", () =>
    Effect.gen(function* () {
      const path = join(tmp, "none.json");
      const error = yield* failure(path, "Final compilation", 0);
      expect(error.phase).toBe("Final compilation");
      expect(error.reason).toContain(path);
    }),
  );

  it.live("a file older than the build start is stale", () =>
    Effect.gen(function* () {
      const path = join(tmp, "old.json");
      writeFileSync(path, "{}");
      utimesSync(path, 1_000, 1_000);
      const error = yield* failure(path, "p", 2_000);
      expect(error.reason).toContain("not refreshed");
    }),
  );

  it.live("a fresh, parseable file is returned", () =>
    Effect.gen(function* () {
      const path = join(tmp, "fresh.json");
      const validators = [{ title: "t", hash: "h", compiledCode: "c" }];
      writeFileSync(
        path,
        JSON.stringify({ preamble: {}, validators, definitions: {} }),
      );
      const blueprint = yield* freshBlueprint(path, "p", 0).pipe(
        Effect.provide(NodeServices.layer),
      );
      expect(blueprint.validators).toEqual(validators);
    }),
  );

  it.live("unparseable JSON fails for the phase", () =>
    Effect.gen(function* () {
      const path = join(tmp, "bad.json");
      writeFileSync(path, "{");
      const error = yield* failure(path, "p", 0);
      expect(error.reason).toContain("could not be parsed");
    }),
  );
});

describe("processExitCode", () => {
  const run = (command: readonly [string, ...string[]]) =>
    Effect.result(
      processExitCode(command, tmp, (cause) => processFailure("sh", cause)),
    ).pipe(Effect.provide(NodeServices.layer));

  it.live("is the exit code of a process that ran", () =>
    Effect.gen(function* () {
      expect(Result.getOrThrow(yield* run(["sh", "-c", "exit 3"]))).toBe(3);
    }),
  );

  it.live("a process that cannot start says so", () =>
    Effect.gen(function* () {
      const result = yield* run(["/nonexistent/binary"]);
      expect(Result.getOrThrow(Result.flip(result))).toMatch(
        /^sh could not start: /,
      );
    }),
  );

  it.live("a process stopped by a signal says so", () =>
    Effect.gen(function* () {
      const result = yield* run(["sh", "-c", "kill -9 $$"]);
      expect(Result.getOrThrow(Result.flip(result))).toMatch(
        /^sh was stopped: /,
      );
    }),
  );

  it.live("interruption kills the process", () =>
    Effect.gen(function* () {
      const started = Date.now();
      const fiber = yield* Effect.forkChild(
        processExitCode(["sleep", "30"], tmp, (cause) => cause),
      );
      yield* Effect.sleep("200 millis");
      yield* Fiber.interrupt(fiber);
      expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
      expect(Date.now() - started).toBeLessThan(5_000);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("build --from-deployed", () => {
  const plutus = Schema.decodeUnknownSync(PlutusJson)(
    JSON.parse(readFileSync("plutus-default.json", "utf-8")),
  );
  const tomlKeys = (fresh: ReadonlySet<string>, deployed = plutus) =>
    pinnedMappings(deployed, fresh).map((m) => m.tomlKey);
  const pins = new Map(
    pinnedMappings(plutus, new Set()).map((m) => [m.tomlKey, m.hash]),
  );

  it("pins the 18 core hashes a full record has, with their deployed hashes", () => {
    const pinned = pinnedMappings(plutus, new Set());
    expect(pinned).toHaveLength(18);
    expect(
      pinned.find((m) => m.tomlKey === "reserve_two_stage_hash")?.hash,
    ).toBe(
      plutus.validators.find(
        (v) => v.title === "reserve.reserve_two_stage_upgrade.else",
      )?.hash,
    );
    expect(tomlKeys(new Set())).not.toContain("cnight_minting_forever_hash");
  });

  it("a title the record lacks is compiled from new", () => {
    const keys = tomlKeys(new Set(), {
      ...plutus,
      validators: plutus.validators.filter(
        (v) => v.title !== "thresholds.terms_and_conditions_threshold.else",
      ),
    });
    expect(keys).not.toContain("terms_and_conditions_threshold_hash");
    expect(keys).toHaveLength(17);
  });

  it("the validators of the named components are compiled from new", () => {
    const keys = tomlKeys(new Set(DEPLOY_COMPONENT_VALIDATORS.reserve));
    expect(keys).toHaveLength(16);
    expect(keys).not.toContain("reserve_two_stage_hash");
    expect(keys).not.toContain("reserve_forever_hash");
  });

  it.live(
    "a build that compiles every pinned validator to its deployed hash passes",
    () => keepsPins(pins, plutus),
  );

  it.live(
    "a pinned validator that compiles to another hash is PinsMoved with both hashes",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          keepsPins(
            new Map(pins).set("main_gov_threshold_hash", "ff".repeat(28)),
            plutus,
          ),
        );
        expect(error.moved).toEqual([
          {
            validator: "main_gov_threshold",
            deployed: "ff".repeat(28),
            built: pins.get("main_gov_threshold_hash"),
          },
        ]);
      }),
  );

  it.live(
    "a failing hash update puts aiken.toml back and leaves no backup",
    () =>
      Effect.gen(function* () {
        const root = join(tmp, "from-deployed");
        mkdirSync(root);
        const broken = `[config.preview.reserve_two_stage_hash]\nencoding = "hex"\n`;
        writeFileSync(join(root, "aiken.toml"), broken);
        const output = captureOutput();
        const error = yield* Effect.flip(
          buildContracts({
            network: "preview",
            traceLevel: "silent",
            projectRoot: root,
            source: { kind: "fromDeployed", fresh: new Set() },
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                NodeServices.layer,
                DeployedScripts.layer,
                output.layer,
              ),
            ),
          ),
        );
        expect(error).toMatchObject({
          _tag: "ConfigError",
          key: "config.preview.reserve_two_stage_hash",
        });
        expect(readFileSync(join(root, "aiken.toml"), "utf-8")).toBe(broken);
        expect(readdirSync(root)).toEqual(["aiken.toml"]);
        expect(existsSync(join(root, "plutus-preview.json"))).toBe(false);
        expect(output.lines).toContain(
          "Reading hashes from deployed scripts...",
        );
      }),
  );
});

describe("the standard build", () => {
  it.live(
    "converges in one final compile when main_gov_threshold's hash moves",
    () =>
      Effect.gen(function* () {
        const root = join(tmp, "standard");
        for (const path of [
          "aiken.lock",
          "validators",
          "lib",
          "build/packages",
        ]) {
          cpSync(path, join(root, path), { recursive: true });
        }
        // main_gov_threshold compiles in its one-shot, so its hash moves; the five other
        // thresholds compile in that hash.
        const fixpoint = readFileSync("aiken.toml", "utf-8");
        const moved = fixpoint.replace(
          /^main_gov_one_shot_index = 1$/m,
          "main_gov_one_shot_index = 2",
        );
        expect(moved).not.toBe(fixpoint);
        writeFileSync(join(root, "aiken.toml"), moved);
        const output = captureOutput();
        yield* buildContracts({
          network: "default",
          traceLevel: "verbose",
          projectRoot: root,
          source: { kind: "standard" },
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              NodeServices.layer,
              DeployedScripts.layer,
              output.layer,
            ),
          ),
        );
        expect(output.lines).not.toContain(
          "Detected stale logic bytecode; rebuilding with refreshed hashes...",
        );
      }),
    120_000,
  );
});
