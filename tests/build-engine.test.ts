import { afterAll, describe, expect, test } from "bun:test";
import {
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
import { Effect, Either, Exit, Fiber, Layer, Option } from "effect";
import {
  buildContracts,
  freshBlueprint,
  keepsPins,
  pinnedMappings,
  processExitCode,
  processFailure,
  staleDependency,
  withTomlHexValue,
} from "../cli/contracts/build-engine";
import type { PlutusJson } from "../cli/contracts/plutus-json";
import { DeployedScriptsLive } from "../cli/contracts/versions";
import { DEPLOY_COMPONENT_VALIDATORS } from "../cli/deploy/deploy";
import {
  OutputCaptured,
  captureOutput,
  expectFailure,
  PlatformLive,
  leftOf,
  runTest,
} from "./helpers/effect";

const tmp = mkdtempSync(join(tmpdir(), "build-engine-"));
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
  test("replaces bytes and encoding inside the matching section only", () => {
    const result = withTomlHexValue(
      toml,
      "preview",
      "reserve_forever_hash",
      "cc",
    );
    expect(result).toEqual(
      Either.right(
        toml.replace(
          'bytes = "bb"\nencoding = "base16"',
          'bytes = "cc"\nencoding = "hex"',
        ),
      ),
    );
  });

  test("appends a new key after the network's last section", () => {
    const result = Either.getOrThrow(
      withTomlHexValue(toml, "default", "new_hash", "dd"),
    );
    const index = result.indexOf(
      '[config.default.new_hash]\nbytes = "dd"\nencoding = "hex"',
    );
    expect(index).toBeGreaterThan(toml.indexOf('bytes = "aa"'));
    expect(index).toBeLessThan(result.indexOf("[config.preview]"));
  });

  test("an unknown network is appended at the end", () => {
    const result = withTomlHexValue(toml, "mainnet", "k", "ee");
    expect(result).toEqual(
      Either.right(
        toml.trimEnd() +
          '\n\n[config.mainnet.k]\nbytes = "ee"\nencoding = "hex"\n',
      ),
    );
  });

  test("a section without a bytes key is a ConfigError naming it", () => {
    const broken = '[config.default.k]\nencoding = "hex"\n';
    expect(
      leftOf(withTomlHexValue(broken, "default", "k", "ff")),
    ).toMatchObject({ _tag: "ConfigError", key: "config.default.k" });
  });

  test("rewrites only the target bytes in the real aiken.toml", () => {
    const real = readFileSync("aiken.toml", "utf-8");
    const zeros = "00".repeat(28);
    const bytes = /(\[config\.default\.reserve_forever_hash\]\nbytes = ")\w+/;
    expect(
      withTomlHexValue(real, "default", "reserve_forever_hash", zeros),
    ).toEqual(Either.right(real.replace(bytes, `$1${zeros}`)));
  });
});

describe("staleDependency", () => {
  const validator = (title: string, hash: string, compiledCode: string) => ({
    title,
    hash,
    compiledCode,
  });
  const complete: PlutusJson = {
    preamble: {},
    definitions: {},
    validators: [
      validator("thresholds.main_council_update_threshold.else", "AA", ""),
      validator("thresholds.main_tech_auth_update_threshold.else", "bb", ""),
      validator(
        "thresholds.main_federated_ops_update_threshold.else",
        "cc",
        "",
      ),
      validator("thresholds.main_gov_threshold.else", "dd", ""),
      validator("thresholds.beefy_signer_threshold.else", "ee", ""),
      validator("committee_bridge.committee_bridge_forever.else", "ff", ""),
      validator("committee_bridge_pool.committee_bridge_pool.else", "11", ""),
      validator("permissioned.council_logic.else", "", "00aa00"),
      validator("permissioned.tech_auth_logic.else", "", "00bb00"),
      validator("permissioned.federated_ops_logic.else", "", "00cc00"),
      validator("gov_auth.main_gov_auth.else", "", "00dd00"),
      validator("committee_bridge.committee_bridge_logic.else", "", "ee ff 11"),
    ],
  };

  test("every logic validator embedding its dependency is fresh", () => {
    expect(staleDependency(complete)).toEqual(Option.none());
  });

  test("a logic validator without its dependency hash names both", () => {
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

  test("a missing dependency validator is reported first", () => {
    const missing = { ...complete, validators: complete.validators.slice(1) };
    expect(staleDependency(missing)).toEqual(
      Option.some(
        "dependency thresholds.main_council_update_threshold.else not found in blueprint",
      ),
    );
  });
});

describe("freshBlueprint", () => {
  const fresh = (path: string, phase: string, startedAt: number) =>
    runTest(
      PlatformLive,
      Effect.either(freshBlueprint(path, phase, startedAt)),
    );

  test("a missing file fails for the phase", async () => {
    const path = join(tmp, "none.json");
    const result = await fresh(path, "Final compilation", 0);
    expect(leftOf(result)).toMatchObject({ phase: "Final compilation" });
    expect(leftOf(result).reason).toContain(path);
  });

  test("a file older than the build start is stale", async () => {
    const path = join(tmp, "old.json");
    writeFileSync(path, "{}");
    utimesSync(path, 1_000, 1_000);
    const result = await fresh(path, "p", 2_000);
    expect(leftOf(result).reason).toContain("not refreshed");
  });

  test("a fresh, parseable file is returned", async () => {
    const path = join(tmp, "fresh.json");
    const plutus = { preamble: {}, validators: [], definitions: {} };
    writeFileSync(path, JSON.stringify(plutus));
    const result = await fresh(path, "p", 0);
    expect(result).toEqual(Either.right(plutus));
  });

  test("unparseable JSON fails for the phase", async () => {
    const path = join(tmp, "bad.json");
    writeFileSync(path, "{");
    const result = await fresh(path, "p", 0);
    expect(leftOf(result).reason).toContain("could not be parsed");
  });
});

describe("pinnedMappings (build --from-deployed)", () => {
  const plutus: PlutusJson = JSON.parse(
    readFileSync("plutus-default.json", "utf-8"),
  );
  const tomlKeys = (fresh: ReadonlySet<string>, deployed = plutus) =>
    pinnedMappings(deployed, fresh).map((m) => m.tomlKey);

  test("pins the 19 core hashes a full snapshot has, with their deployed hashes", () => {
    const pinned = pinnedMappings(plutus, new Set());
    expect(pinned).toHaveLength(19);
    const reserve = pinned.find((m) => m.tomlKey === "reserve_two_stage_hash");
    expect(reserve?.hash).toBe(
      plutus.validators.find(
        (v) => v.title === "reserve.reserve_two_stage_upgrade.else",
      )?.hash,
    );
  });

  test("a title the snapshot lacks is compiled from new", () => {
    const withoutBeefy = {
      ...plutus,
      validators: plutus.validators.filter(
        (v) => v.title !== "thresholds.beefy_signer_threshold.else",
      ),
    };
    expect(tomlKeys(new Set(), withoutBeefy)).not.toContain(
      "beefy_signer_threshold_hash",
    );
    expect(tomlKeys(new Set(), withoutBeefy)).toHaveLength(18);
  });

  test("the validators of the named components are compiled from new", () => {
    const keys = tomlKeys(new Set(DEPLOY_COMPONENT_VALIDATORS.reserve));
    expect(keys).toHaveLength(17);
    expect(keys).not.toContain("reserve_two_stage_hash");
    expect(keys).not.toContain("reserve_forever_hash");
  });
});

describe("keepsPins (build --from-deployed)", () => {
  const plutus: PlutusJson = JSON.parse(
    readFileSync("plutus-default.json", "utf-8"),
  );
  const pins = new Map(
    pinnedMappings(plutus, new Set()).map((m) => [m.tomlKey, m.hash]),
  );

  test("a build that compiles every pinned validator to its deployed hash passes", async () => {
    await runTest(PlatformLive, keepsPins(pins, plutus));
  });

  test("a pinned validator that compiles to another hash is PinsMoved with both hashes", async () => {
    const moved = new Map(pins).set("main_gov_threshold_hash", "ff".repeat(28));
    const error = await expectFailure(
      PlatformLive,
      keepsPins(moved, plutus),
      "PinsMoved",
    );
    expect(error.moved).toEqual([
      {
        validator: "main_gov_threshold",
        deployed: "ff".repeat(28),
        built: Option.getOrThrow(
          Option.fromNullable(pins.get("main_gov_threshold_hash")),
        ),
      },
    ]);
  });
});

describe("buildContracts from deployed", () => {
  test("a failing hash update restores aiken.toml and leaves no backup", async () => {
    const root = join(tmp, "from-deployed");
    mkdirSync(root);
    const broken = `[config.preview.reserve_two_stage_hash]\nencoding = "hex"\n`;
    writeFileSync(join(root, "aiken.toml"), broken);
    const capture = captureOutput();
    const error = await expectFailure(
      Layer.mergeAll(
        OutputCaptured(capture),
        PlatformLive,
        DeployedScriptsLive,
      ),
      buildContracts({
        network: "preview",
        traceLevel: "silent",
        source: { kind: "fromDeployed", fresh: new Set() },
        projectRoot: root,
      }),
      "ConfigError",
    );
    expect(error.key).toBe("config.preview.reserve_two_stage_hash");
    expect(readFileSync(join(root, "aiken.toml"), "utf-8")).toBe(broken);
    expect(readdirSync(root)).toEqual(["aiken.toml"]);
    expect(existsSync(join(root, "plutus-preview.json"))).toBe(false);
    expect(capture.lines).toContain("Reading hashes from deployed scripts...");
  });
});

describe("processExitCode", () => {
  const run = (command: readonly [string, ...string[]]) =>
    runTest(
      PlatformLive,
      Effect.either(
        processExitCode(command, tmp, (cause) => processFailure("sh", cause)),
      ),
    );

  test("is the exit code of a process that ran", async () => {
    expect(await run(["sh", "-c", "exit 3"])).toEqual(Either.right(3));
  });

  test("a process that cannot start says so", async () => {
    const result = await run(["/nonexistent/binary"]);
    expect(leftOf(result)).toStartWith("sh could not start: ");
  });

  test("a process stopped by a signal says so", async () => {
    const result = await run(["sh", "-c", "kill -9 $$"]);
    expect(leftOf(result)).toStartWith("sh was stopped: ");
  });

  test("interruption kills the process", async () => {
    const started = Date.now();
    const exit = await runTest(
      PlatformLive,
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          processExitCode(["sleep", "30"], tmp, (cause) => cause),
        );
        yield* Effect.sleep("200 millis");
        return yield* Fiber.interrupt(fiber);
      }),
    );
    expect(Exit.isInterrupted(exit)).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
