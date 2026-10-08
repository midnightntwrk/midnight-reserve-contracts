import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { Effect, Layer, Option, Schema } from "effect";
import { PlutusJson } from "../cli/contracts/plutus-json";
import {
  DeployedScriptsAt,
  liveHashOf,
  prepareValidatorMerge,
  writeValidatorMerge,
  prepareDeploySnapshot,
  promotedAmong,
  type SnapshotRule,
  writeDeploySnapshot,
} from "../cli/contracts/versions";
import {
  buildInstances,
  expectFailure,
  PlatformLive,
  runTest,
} from "./helpers/effect";

const BUILD_PLUTUS = resolve("plutus-default.json");
const BUILD_BLUEPRINT = resolve("contract_blueprint_default.ts");
const build = Schema.decodeUnknownSync(PlutusJson)(
  JSON.parse(readFileSync(BUILD_PLUTUS, "utf-8")),
);

const contracts = await buildInstances();
const reserve = new Set([
  contracts.reserveTwoStage.Script.hash(),
  contracts.reserveForever.Script.hash(),
  contracts.reserveLogic.Script.hash(),
]);
const ics = new Set([contracts.icsForever.Script.hash()]);
const unknownHash = new Set(["ab".repeat(28)]);

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A temporary snapshot root with its emulator directory. */
const snapshotRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "deployed-scripts-"));
  roots.push(root);
  const dir = join(root, "emulator");
  mkdirSync(dir);
  return { root, dir };
};
const layerAt = (root: string) =>
  Layer.merge(PlatformLive, DeployedScriptsAt(root));
const readJson = (dir: string, file: string) =>
  JSON.parse(readFileSync(join(dir, file), "utf-8"));
const writeJson = (dir: string, file: string, data: unknown) =>
  writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + "\n");
/** The files of a snapshot directory, as text. */
const filesOf = (dir: string) =>
  Object.fromEntries(
    [
      "plutus.json",
      "contract_blueprint.ts",
      "versions.json",
      "changelog.json",
    ].map((file) => [
      file,
      existsSync(join(dir, file))
        ? readFileSync(join(dir, file), "utf-8")
        : undefined,
    ]),
  );

const NONE: ReadonlySet<string> = new Set();
const govAuths = new Set([
  contracts.govAuth.Script.hash(),
  contracts.stagingGovAuth.Script.hash(),
]);

const snapshot = (
  rule: SnapshotRule,
  created: ReadonlySet<string>,
  installed: ReadonlySet<string>,
) =>
  Effect.flatMap(
    prepareDeploySnapshot({
      env: "emulator",
      rule,
      createdHashes: created,
      installedHashes: installed,
      plutusPath: BUILD_PLUTUS,
      blueprintPath: BUILD_BLUEPRINT,
      timestamp: "2026-09-25T00:00:00.000Z",
    }),
    (prepared) => writeDeploySnapshot("emulator", prepared),
  );

const save = (
  root: string,
  rule: SnapshotRule,
  created: ReadonlySet<string>,
  installed: ReadonlySet<string>,
) => runTest(layerAt(root), snapshot(rule, created, installed));

/** The build entry with this title. */
const titled = (title: string) =>
  Option.getOrThrow(
    Option.fromNullable(build.validators.find((v) => v.title === title)),
  );
const ICS_FOREVER = "illiquid_circulation_supply.ics_forever.else";
const RESERVE_FOREVER = "reserve.reserve_forever.else";
const COUNCIL_LOGIC_V2 = "permissioned_v2.council_logic_v2.else";
const MAIN_GOV_AUTH = "gov_auth.main_gov_auth.else";

/** The two-stage type entries: they reference definitions, some of them shared with other entries. */
const TWO_STAGE_TYPES = build.validators.filter((v) =>
  v.title.startsWith("validator_types.z_two_stage_upgrade_types."),
);
const twoStageTypes = new Set(TWO_STAGE_TYPES.map((v) => v.hash));
/** Definitions only the two-stage type entries reach. */
const TWO_STAGE_ONLY = [
  "upgradable/types/TwoStageRedeemer",
  "upgradable/types/WhichStage",
  "cardano/transaction/OutputReference",
  "upgradable/types/UpdateField",
  "upgradable/types/UpgradeState",
];

/** A validator only the snapshot has, reading `Old/Type` and `Int`. */
const RECORD_ONLY = {
  ...titled(ICS_FOREVER),
  title: "old.gone.else",
  hash: "0a".repeat(28),
  datum: {
    title: "d",
    schema: { $ref: "#/definitions/Old~1Type" },
  },
  redeemer: { title: "r", schema: { $ref: "#/definitions/Int" } },
};

/** A snapshot of the build without the two-stage type entries and their own definitions, with a validator only it has, these hashes and these definitions changed. */
const snapshotWithout = (
  changed: Record<string, unknown>,
  stale: ReadonlyMap<string, string> = new Map(),
): PlutusJson => ({
  ...build,
  validators: [
    ...build.validators
      .filter((v) => !TWO_STAGE_TYPES.includes(v))
      .map((v) => ({ ...v, hash: stale.get(v.title) ?? v.hash })),
    RECORD_ONLY,
  ],
  definitions: {
    ...Object.fromEntries(
      Object.entries(build.definitions).filter(
        ([key]) => !TWO_STAGE_ONLY.includes(key),
      ),
    ),
    "Old/Type": { title: "OldType", dataType: "bytes" },
    ...changed,
  },
});

describe("prepareDeploySnapshot and writeDeploySnapshot", () => {
  test("replace writes the build output over a stale snapshot: promoted = the created and installed validators, nothing staged, the changelog started again", async () => {
    const { root, dir } = snapshotRoot();
    writeJson(dir, "plutus.json", snapshotWithout({}));
    writeJson(dir, "versions.json", {
      promoted: ["council_forever"],
      staged: ["council_logic_v2"],
    });
    writeJson(dir, "changelog.json", {
      timestamp: "t",
      gitCommit: "c",
      changes: [{ type: "initial", validator: "old" }],
    });
    await save(root, "replace", reserve, govAuths);
    expect(readJson(dir, "plutus.json")).toEqual(build);
    expect(readFileSync(join(dir, "contract_blueprint.ts"), "utf-8")).toBe(
      readFileSync(BUILD_BLUEPRINT, "utf-8"),
    );
    const versions = readJson(dir, "versions.json");
    expect(versions.staged).toEqual([]);
    expect([...versions.promoted].sort()).toEqual([
      "main_gov_auth",
      "reserve_forever",
      "reserve_logic",
      "reserve_two_stage_upgrade",
      "staging_gov_auth",
    ]);
    expect(readJson(dir, "changelog.json")).toEqual({
      timestamp: "2026-09-25T00:00:00.000Z",
      changes: [
        {
          type: "initial",
          validator: "all",
          description: "Initial deployment",
          timestamp: "2026-09-25T00:00:00.000Z",
        },
      ],
    });
  });

  test("extend takes only the created entries in place, keeps every other entry as recorded, and appends to the changelog, which keeps its start and gitCommit", async () => {
    const { root, dir } = snapshotRoot();
    const stale = new Map([
      [COUNCIL_LOGIC_V2, "ee".repeat(28)],
      [ICS_FOREVER, "dd".repeat(28)],
    ]);
    const previous = snapshotWithout(
      { ByteArray: { title: "snapshot ByteArray", dataType: "bytes" } },
      stale,
    );
    writeJson(dir, "plutus.json", previous);
    writeJson(dir, "versions.json", {
      promoted: ["reserve_forever"],
      staged: ["council_logic_v2_other"],
    });
    const promote = {
      type: "promote",
      validator: "cnight_mint_logic_v2",
      newHash: "87".repeat(28),
      description: "Promote",
    };
    writeJson(dir, "changelog.json", {
      timestamp: "t",
      gitCommit: "c",
      changes: [promote],
    });
    await save(root, "extend", ics, NONE);

    const plutus = readJson(dir, "plutus.json");
    expect(plutus.validators).toEqual(
      previous.validators.map((v) =>
        v.title === ICS_FOREVER ? titled(ICS_FOREVER) : v,
      ),
    );
    expect(plutus.definitions["Old/Type"]).toEqual({
      title: "OldType",
      dataType: "bytes",
    });
    expect(readFileSync(join(dir, "contract_blueprint.ts"), "utf-8")).toContain(
      "export class IlliquidCirculationSupplyIcsForeverElse ",
    );

    expect(readJson(dir, "versions.json")).toEqual({
      promoted: ["reserve_forever", "ics_forever"],
      staged: ["council_logic_v2_other"],
    });
    expect(readJson(dir, "changelog.json")).toEqual({
      timestamp: "t",
      gitCommit: "c",
      changes: [
        promote,
        {
          type: "initial",
          validator: "ics_forever",
          description: "Initial deployment",
          timestamp: "2026-09-25T00:00:00.000Z",
        },
      ],
    });
  });

  test("extend appends a created validator the snapshot lacks, with the definitions it reaches", async () => {
    const { root, dir } = snapshotRoot();
    writeJson(dir, "plutus.json", snapshotWithout({}));
    writeJson(dir, "versions.json", { promoted: [], staged: [] });
    await save(root, "extend", twoStageTypes, NONE);
    const plutus = readJson(dir, "plutus.json");
    expect(plutus.validators.slice(-TWO_STAGE_TYPES.length)).toEqual(
      TWO_STAGE_TYPES,
    );
    for (const key of TWO_STAGE_ONLY) {
      expect(plutus.definitions[key]).toEqual(build.definitions[key]);
    }
  });

  test.each([
    ["promoted", ["reserve_forever"]],
    ["not promoted", []],
  ])(
    "extend keeps the recorded entry of a %s validator it does not create, when the build has another hash",
    async (_name, promoted) => {
      const { root, dir } = snapshotRoot();
      writeJson(
        dir,
        "plutus.json",
        snapshotWithout({}, new Map([[RESERVE_FOREVER, "ff".repeat(28)]])),
      );
      writeJson(dir, "versions.json", { promoted, staged: [] });
      await save(root, "extend", ics, NONE);
      expect(
        readJson(dir, "plutus.json").validators.find(
          (v: { title: string }) => v.title === RESERVE_FOREVER,
        ).hash,
      ).toBe("ff".repeat(28));
    },
  );

  test.each([
    [
      "a definition a created entry and a kept entry read with different shapes",
      { Int: { title: "Int", dataType: "bytes" } },
      "definitions Int differ between the build and the entries the snapshot keeps",
    ],
    [
      "a definition a kept entry references and the snapshot lacks",
      { "Old/Type": undefined },
      "missing definitions Old/Type",
    ],
  ])("extend refuses %s, before any write", async (_name, changed, reason) => {
    const { root, dir } = snapshotRoot();
    writeJson(dir, "plutus.json", snapshotWithout(changed));
    writeJson(dir, "versions.json", { promoted: [], staged: [] });
    const before = filesOf(dir);
    const error = await expectFailure(
      layerAt(root),
      snapshot("extend", twoStageTypes, NONE),
      "BlueprintError",
    );
    expect(error.reason).toBe(reason);
    expect(filesOf(dir)).toEqual(before);
  });

  test("a blueprint generation that fails leaves the four files as they were", async () => {
    const { root, dir } = snapshotRoot();
    writeJson(
      dir,
      "plutus.json",
      snapshotWithout({ "Old/Type": { anyOf: "nope" } }),
    );
    writeJson(dir, "versions.json", { promoted: [], staged: [] });
    writeJson(dir, "changelog.json", { timestamp: "t", changes: [] });
    const before = filesOf(dir);
    const error = await expectFailure(
      layerAt(root),
      snapshot("extend", ics, NONE),
      "BlueprintError",
    );
    expect(error.reason).toBe("blueprint generation failed with exit code 1");
    expect(filesOf(dir)).toEqual(before);
  });

  test("extend without a plutus.json keeps versions.json and adds the created", async () => {
    const { root, dir } = snapshotRoot();
    writeJson(dir, "versions.json", {
      promoted: ["reserve_forever"],
      staged: ["council_logic_v2"],
    });
    await save(root, "extend", ics, NONE);
    expect(readJson(dir, "plutus.json")).toEqual(build);
    expect(readJson(dir, "versions.json")).toEqual({
      promoted: ["reserve_forever", "ics_forever"],
      staged: ["council_logic_v2"],
    });
  });

  test("extend on an empty directory writes the build output", async () => {
    const { root, dir } = snapshotRoot();
    await save(root, "extend", ics, NONE);
    expect(readJson(dir, "plutus.json")).toEqual(build);
    expect(readJson(dir, "versions.json")).toEqual({
      promoted: ["ics_forever"],
      staged: [],
    });
  });

  test("a created hash the build lacks is a BlueprintError and nothing is written", async () => {
    const { root, dir } = snapshotRoot();
    const error = await expectFailure(
      layerAt(root),
      snapshot("replace", unknownHash, NONE),
      "BlueprintError",
    );
    expect(error.source).toBe("build");
    expect(error.reason).toContain("ab".repeat(28));
    expect(Object.values(filesOf(dir))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("an unreadable versions.json fails an extend before any write", async () => {
    const { root, dir } = snapshotRoot();
    writeFileSync(join(dir, "versions.json"), "{");
    await expectFailure(
      layerAt(root),
      snapshot("extend", ics, NONE),
      "BlueprintError",
    );
    expect(existsSync(join(dir, "plutus.json"))).toBe(false);
    expect(readFileSync(join(dir, "versions.json"), "utf-8")).toBe("{");
  });
});

describe("prepareValidatorMerge", () => {
  const merge = Effect.flatMap(
    prepareValidatorMerge("emulator", titled(ICS_FOREVER).hash, BUILD_PLUTUS),
    (prepared) => writeValidatorMerge("emulator", prepared),
  );

  test("takes the build entry in place and regenerates the blueprint; versions.json is untouched", async () => {
    const { root, dir } = snapshotRoot();
    const previous = snapshotWithout(
      {},
      new Map([[ICS_FOREVER, "dd".repeat(28)]]),
    );
    writeJson(dir, "plutus.json", previous);
    writeJson(dir, "versions.json", { promoted: ["ics_forever"], staged: [] });
    await runTest(layerAt(root), merge);
    const plutus = readJson(dir, "plutus.json");
    expect(plutus.validators).toEqual(
      previous.validators.map((v) =>
        v.title === ICS_FOREVER ? titled(ICS_FOREVER) : v,
      ),
    );
    expect(readFileSync(join(dir, "contract_blueprint.ts"), "utf-8")).toContain(
      "export class IlliquidCirculationSupplyIcsForeverElse ",
    );
    expect(readJson(dir, "versions.json")).toEqual({
      promoted: ["ics_forever"],
      staged: [],
    });
  });

  test("a blueprint generation that fails prepares nothing, so neither file is written", async () => {
    const { root, dir } = snapshotRoot();
    writeJson(dir, "plutus.json", snapshotWithout({ Data: { anyOf: "nope" } }));
    const before = filesOf(dir);
    await expectFailure(layerAt(root), merge, "BlueprintError");
    expect(filesOf(dir)).toEqual(before);
  });
});

describe("promotedAmong", () => {
  test("names the deployed validators versions.json already promotes", async () => {
    const { root, dir } = snapshotRoot();
    writeJson(dir, "versions.json", {
      promoted: ["reserve_forever", "council_forever"],
      staged: [],
    });
    expect(
      await runTest(
        layerAt(root),
        promotedAmong("emulator", BUILD_PLUTUS, reserve),
      ),
    ).toEqual(["reserve_forever"]);
  });

  test("is empty without a versions.json", async () => {
    expect(
      await runTest(
        layerAt(snapshotRoot().root),
        promotedAmong("emulator", BUILD_PLUTUS, reserve),
      ),
    ).toEqual([]);
  });

  test("a hash the build lacks is a BlueprintError, so the refusal cannot pass it", async () => {
    const error = await expectFailure(
      layerAt(snapshotRoot().root),
      promotedAmong("emulator", BUILD_PLUTUS, unknownHash),
      "BlueprintError",
    );
    expect(error.reason).toContain(BUILD_PLUTUS);
  });
});

describe("liveHashOf", () => {
  const mainGovAuth = contracts.govAuth.Script.hash();
  const live = liveHashOf("emulator", BUILD_PLUTUS, mainGovAuth);

  test("is the record's hash of a build validator that versions.json promotes", async () => {
    const { root, dir } = snapshotRoot();
    writeJson(
      dir,
      "plutus.json",
      snapshotWithout({}, new Map([[MAIN_GOV_AUTH, "ff".repeat(28)]])),
    );
    writeJson(dir, "versions.json", {
      promoted: ["main_gov_auth"],
      staged: [],
    });
    expect(await runTest(layerAt(root), live)).toEqual(
      Option.some("ff".repeat(28)),
    );
  });

  test("is None when versions.json does not promote it, whatever plutus.json holds", async () => {
    const { root, dir } = snapshotRoot();
    writeJson(
      dir,
      "plutus.json",
      snapshotWithout({}, new Map([[MAIN_GOV_AUTH, "ff".repeat(28)]])),
    );
    writeJson(dir, "versions.json", { promoted: [], staged: [] });
    expect(await runTest(layerAt(root), live)).toEqual(Option.none());
  });

  test("a promoted validator plutus.json lacks is a BlueprintError", async () => {
    const { root, dir } = snapshotRoot();
    writeJson(dir, "versions.json", {
      promoted: ["main_gov_auth"],
      staged: [],
    });
    const error = await expectFailure(layerAt(root), live, "BlueprintError");
    expect(error.reason).toContain(MAIN_GOV_AUTH);
  });
});
