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
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import { DeployedScripts } from "../cli/config";
import { ContractResolver } from "../cli/contracts/resolver";
import { PlutusJson } from "../cli/contracts/snapshot-read";
import {
  applyRecordUpdate,
  prepareDeploySnapshot,
  prepareValidatorMerge,
} from "../cli/contracts/snapshot-write";
import type { SnapshotRule } from "../cli/contracts/resolver";

const BUILD_PLUTUS = resolve("plutus-default.json");
const BUILD_BLUEPRINT = resolve("contract_blueprint_default.ts");
const build = Schema.decodeUnknownSync(PlutusJson)(
  JSON.parse(readFileSync(BUILD_PLUTUS, "utf-8")),
);

/** The build entry with this title. */
const titled = (title: string) => {
  const found = build.validators.find((v) => v.title === title);
  if (found === undefined) expect.fail(`no ${title} in ${BUILD_PLUTUS}`);
  return found;
};
const hashes = (...titles: string[]) =>
  new Set(titles.map((title) => titled(title).hash));

const ICS_FOREVER = "illiquid_circulation_supply.ics_forever.else";
const RESERVE_FOREVER = "reserve.reserve_forever.else";
const COUNCIL_LOGIC_V2 = "permissioned_v2.council_logic_v2.else";
const MAIN_GOV_AUTH = "gov_auth.main_gov_auth.else";
const reserve = hashes(
  "reserve.reserve_two_stage_upgrade.else",
  RESERVE_FOREVER,
  "reserve.reserve_logic.else",
);
const ics = hashes(ICS_FOREVER);
const govAuths = hashes(MAIN_GOV_AUTH, "gov_auth.staging_gov_auth.else");
const NONE: ReadonlySet<string> = new Set();

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A temporary record root with an empty directory for `env`. */
const recordRoot = (env = "emulator") => {
  const root = mkdtempSync(join(tmpdir(), "deployed-scripts-"));
  roots.push(root);
  const dir = join(root, env);
  mkdirSync(dir);
  return { root, dir };
};
const layerAt = (root: string) =>
  Layer.merge(NodeServices.layer, DeployedScripts.at(root));
const readJson = (dir: string, file: string) =>
  JSON.parse(readFileSync(join(dir, file), "utf-8"));
const writeJson = (dir: string, file: string, data: unknown) =>
  writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + "\n");
/** The four files of a record directory, as text. */
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

/** Prepare and apply a deploy's record update on the emulator record under `root`. */
const save = (
  root: string,
  rule: SnapshotRule,
  created: ReadonlySet<string>,
  installed: ReadonlySet<string>,
) =>
  Effect.provide(
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
      (update) => applyRecordUpdate("emulator", [update]),
    ),
    layerAt(root),
  );

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

/** A validator only the record has, reading `Old/Type` and `Int`. */
const RECORD_ONLY = {
  ...titled(ICS_FOREVER),
  title: "old.gone.else",
  hash: "0a".repeat(28),
  datum: { title: "d", schema: { $ref: "#/definitions/Old~1Type" } },
  redeemer: { title: "r", schema: { $ref: "#/definitions/Int" } },
};

/** A record of the build without the two-stage type entries and their own definitions, with a validator only it has, these hashes and these definitions changed. */
const recordWithout = (
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

describe("prepareDeploySnapshot and applyRecordUpdate", () => {
  it.live(
    "replace writes the build output over a stale record: promoted = the created and installed validators, nothing staged, the changelog started again",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(dir, "plutus.json", recordWithout({}));
        writeJson(dir, "versions.json", {
          promoted: ["council_forever"],
          staged: ["council_logic_v2"],
        });
        writeJson(dir, "changelog.json", {
          timestamp: "t",
          gitCommit: "c",
          changes: [{ type: "initial", validator: "old" }],
        });
        expect(yield* save(root, "replace", reserve, govAuths)).toEqual([
          { _tag: "Saved", dir },
        ]);
        expect(readJson(dir, "plutus.json")).toEqual(build);
        expect(Object.keys(readJson(dir, "plutus.json"))).toEqual([
          "preamble",
          "validators",
          "definitions",
        ]);
        expect(readFileSync(join(dir, "contract_blueprint.ts"), "utf-8")).toBe(
          readFileSync(BUILD_BLUEPRINT, "utf-8"),
        );
        const versions = readJson(dir, "versions.json");
        expect(versions.staged).toEqual([]);
        expect(versions.promoted.toSorted()).toEqual([
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
      }),
  );

  it.live(
    "extend takes only the created entries in place, keeps every other entry and the key order, and appends to the changelog, which keeps its start and gitCommit",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        const previous = recordWithout(
          { ByteArray: { title: "snapshot ByteArray", dataType: "bytes" } },
          new Map([
            [COUNCIL_LOGIC_V2, "ee".repeat(28)],
            [ICS_FOREVER, "dd".repeat(28)],
          ]),
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
        yield* save(root, "extend", ics, NONE);

        const plutus = readJson(dir, "plutus.json");
        expect(plutus.validators).toEqual(
          previous.validators.map((v) =>
            v.title === ICS_FOREVER ? titled(ICS_FOREVER) : v,
          ),
        );
        expect(Object.keys(plutus)).toEqual(Object.keys(previous));
        expect(plutus.definitions["Old/Type"]).toEqual({
          title: "OldType",
          dataType: "bytes",
        });
        expect(
          readFileSync(join(dir, "contract_blueprint.ts"), "utf-8"),
        ).toContain("export class IlliquidCirculationSupplyIcsForeverElse ");
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
      }),
  );

  it.live(
    "extend appends a created validator the record lacks, with the definitions it reaches",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(dir, "plutus.json", recordWithout({}));
        writeJson(dir, "versions.json", { promoted: [], staged: [] });
        yield* save(root, "extend", twoStageTypes, NONE);
        const plutus = readJson(dir, "plutus.json");
        expect(plutus.validators.slice(-TWO_STAGE_TYPES.length)).toEqual(
          TWO_STAGE_TYPES,
        );
        for (const key of TWO_STAGE_ONLY) {
          expect(plutus.definitions[key]).toEqual(build.definitions[key]);
        }
      }),
  );

  it.live.each([
    { name: "promoted", promoted: ["reserve_forever"] },
    { name: "not promoted", promoted: [] },
  ])(
    "extend keeps the recorded entry of a $name validator it does not create, when the build has another hash",
    ({ promoted }) =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(
          dir,
          "plutus.json",
          recordWithout({}, new Map([[RESERVE_FOREVER, "ff".repeat(28)]])),
        );
        writeJson(dir, "versions.json", { promoted, staged: [] });
        yield* save(root, "extend", ics, NONE);
        expect(
          readJson(dir, "plutus.json").validators.find(
            (v: { title: string }) => v.title === RESERVE_FOREVER,
          ).hash,
        ).toBe("ff".repeat(28));
      }),
  );

  it.live.each([
    {
      name: "a definition a created entry and a kept entry read with different shapes",
      changed: { Int: { title: "Int", dataType: "bytes" } },
      reason:
        "definitions Int differ between the build and the entries the snapshot keeps",
    },
    {
      name: "a definition a kept entry references and the record lacks",
      changed: { "Old/Type": undefined },
      reason: "missing definitions Old/Type",
    },
  ])("extend refuses $name, before any write", ({ changed, reason }) =>
    Effect.gen(function* () {
      const { root, dir } = recordRoot();
      writeJson(dir, "plutus.json", recordWithout(changed));
      writeJson(dir, "versions.json", { promoted: [], staged: [] });
      const before = filesOf(dir);
      const error = yield* Effect.flip(
        save(root, "extend", twoStageTypes, NONE),
      );
      expect(error).toMatchObject({ _tag: "BlueprintError", reason });
      expect(filesOf(dir)).toEqual(before);
    }),
  );

  it.live(
    "a bindings generation that fails leaves the four files as they were",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(
          dir,
          "plutus.json",
          recordWithout({ "Old/Type": { anyOf: "nope" } }),
        );
        writeJson(dir, "versions.json", { promoted: [], staged: [] });
        writeJson(dir, "changelog.json", { timestamp: "t", changes: [] });
        const before = filesOf(dir);
        const error = yield* Effect.flip(save(root, "extend", ics, NONE));
        expect(error).toMatchObject({
          _tag: "BlueprintError",
          reason: "blueprint generation failed with exit code 1",
        });
        expect(filesOf(dir)).toEqual(before);
      }),
  );

  it.live(
    "extend without a plutus.json keeps versions.json and adds the created",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(dir, "versions.json", {
          promoted: ["reserve_forever"],
          staged: ["council_logic_v2"],
        });
        yield* save(root, "extend", ics, NONE);
        expect(readJson(dir, "plutus.json")).toEqual(build);
        expect(readJson(dir, "versions.json")).toEqual({
          promoted: ["reserve_forever", "ics_forever"],
          staged: ["council_logic_v2"],
        });
      }),
  );

  it.live("extend on a missing directory writes the build output", () =>
    Effect.gen(function* () {
      const { root, dir } = recordRoot();
      rmSync(dir, { recursive: true });
      yield* save(root, "extend", ics, NONE);
      expect(readJson(dir, "plutus.json")).toEqual(build);
      expect(readJson(dir, "versions.json")).toEqual({
        promoted: ["ics_forever"],
        staged: [],
      });
    }),
  );

  it.live(
    "a created hash the build lacks is a BlueprintError and nothing is written",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        const error = yield* Effect.flip(
          save(root, "replace", new Set(["ab".repeat(28)]), NONE),
        );
        expect(error).toMatchObject({
          _tag: "BlueprintError",
          source: "build",
        });
        expect(error.reason).toContain("ab".repeat(28));
        expect(Object.values(filesOf(dir))).toEqual([
          undefined,
          undefined,
          undefined,
          undefined,
        ]);
      }),
  );

  it.live("an unreadable versions.json fails an extend before any write", () =>
    Effect.gen(function* () {
      const { root, dir } = recordRoot();
      writeFileSync(join(dir, "versions.json"), "{");
      yield* Effect.flip(save(root, "extend", ics, NONE));
      expect(existsSync(join(dir, "plutus.json"))).toBe(false);
      expect(readFileSync(join(dir, "versions.json"), "utf-8")).toBe("{");
    }),
  );
});

describe("prepareValidatorMerge", () => {
  const merge = (root: string) =>
    Effect.provide(
      Effect.flatMap(
        prepareValidatorMerge(
          "emulator",
          "ics_forever",
          titled(ICS_FOREVER).hash,
          BUILD_PLUTUS,
        ),
        (update) => applyRecordUpdate("emulator", [update]),
      ),
      layerAt(root),
    );

  it.live(
    "takes the build entry in place and regenerates the bindings; versions.json is untouched",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        const previous = recordWithout(
          {},
          new Map([[ICS_FOREVER, "dd".repeat(28)]]),
        );
        writeJson(dir, "plutus.json", previous);
        writeJson(dir, "versions.json", {
          promoted: ["ics_forever"],
          staged: [],
        });
        expect(yield* merge(root)).toEqual([
          { _tag: "Merged", name: "ics_forever" },
        ]);
        expect(readJson(dir, "plutus.json").validators).toEqual(
          previous.validators.map((v) =>
            v.title === ICS_FOREVER ? titled(ICS_FOREVER) : v,
          ),
        );
        expect(
          readFileSync(join(dir, "contract_blueprint.ts"), "utf-8"),
        ).toContain("export class IlliquidCirculationSupplyIcsForeverElse ");
        expect(readJson(dir, "versions.json")).toEqual({
          promoted: ["ics_forever"],
          staged: [],
        });
      }),
  );

  it.live(
    "a bindings generation that fails prepares nothing, so neither file is written",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(
          dir,
          "plutus.json",
          recordWithout({ Data: { anyOf: "nope" } }),
        );
        const before = filesOf(dir);
        expect(yield* Effect.flip(merge(root))).toMatchObject({
          _tag: "BlueprintError",
        });
        expect(filesOf(dir)).toEqual(before);
      }),
  );
});

describe("applyRecordUpdate Track", () => {
  const track = (root: string, as: "staged" | "promoted") =>
    Effect.provide(
      applyRecordUpdate("emulator", [
        { _tag: "Track", as, name: "council_logic_v2" },
      ]),
      layerAt(root),
    );

  it.live(
    "staged then promoted moves the name from staged[] to promoted[], each Tracked",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(dir, "versions.json", {
          promoted: ["council_logic"],
          staged: [],
        });
        expect(yield* track(root, "staged")).toEqual([
          { _tag: "Tracked", as: "staged", name: "council_logic_v2" },
        ]);
        expect(readJson(dir, "versions.json")).toEqual({
          promoted: ["council_logic"],
          staged: ["council_logic_v2"],
        });
        expect(yield* track(root, "promoted")).toEqual([
          { _tag: "Tracked", as: "promoted", name: "council_logic_v2" },
        ]);
        expect(readJson(dir, "versions.json")).toEqual({
          promoted: ["council_logic", "council_logic_v2"],
          staged: [],
        });
      }),
  );

  it.live("without versions.json is VersionsMissing and writes nothing", () =>
    Effect.gen(function* () {
      const { root, dir } = recordRoot();
      expect(yield* track(root, "staged")).toEqual([
        { _tag: "VersionsMissing", as: "staged", name: "council_logic_v2" },
      ]);
      expect(existsSync(join(dir, "versions.json"))).toBe(false);
    }),
  );
});

describe("record reads through ContractResolver", () => {
  /** The resolver of the emulator over the record under `root`. */
  const resolver = (root: string) =>
    Effect.provide(
      ContractResolver,
      Layer.provide(ContractResolver.layer("emulator"), layerAt(root)),
    );

  it.live(
    "promotedAmong names the deployed validators versions.json already promotes",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(dir, "versions.json", {
          promoted: ["reserve_forever", "council_forever"],
          staged: [],
        });
        const contracts = yield* resolver(root);
        expect(yield* contracts.promotedAmong(reserve)).toEqual([
          "reserve_forever",
        ]);
      }),
  );

  it.live("promotedAmong is empty without a versions.json", () =>
    Effect.gen(function* () {
      const contracts = yield* resolver(recordRoot().root);
      expect(yield* contracts.promotedAmong(reserve)).toEqual([]);
    }),
  );

  it.live(
    "promotedAmong of a hash the build lacks is a BlueprintError, so a refusal cannot pass it",
    () =>
      Effect.gen(function* () {
        const contracts = yield* resolver(recordRoot().root);
        const error = yield* Effect.flip(
          contracts.promotedAmong(new Set(["ab".repeat(28)])),
        );
        expect(error.reason).toContain(BUILD_PLUTUS);
      }),
  );

  const mainGovAuth = titled(MAIN_GOV_AUTH).hash;

  it.live(
    "liveHashOf is the record's hash of a build validator that versions.json promotes",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(
          dir,
          "plutus.json",
          recordWithout({}, new Map([[MAIN_GOV_AUTH, "ff".repeat(28)]])),
        );
        writeJson(dir, "versions.json", {
          promoted: ["main_gov_auth"],
          staged: [],
        });
        const contracts = yield* resolver(root);
        expect(yield* contracts.liveHashOf(mainGovAuth)).toEqual(
          Option.some("ff".repeat(28)),
        );
        expect(yield* contracts.isPromoted("main_gov_auth")).toBe(true);
      }),
  );

  it.live(
    "liveHashOf is None when versions.json does not promote it, whatever plutus.json holds",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(
          dir,
          "plutus.json",
          recordWithout({}, new Map([[MAIN_GOV_AUTH, "ff".repeat(28)]])),
        );
        writeJson(dir, "versions.json", { promoted: [], staged: [] });
        const contracts = yield* resolver(root);
        expect(yield* contracts.liveHashOf(mainGovAuth)).toEqual(Option.none());
      }),
  );

  it.live(
    "liveHashOf of a promoted validator plutus.json lacks is a BlueprintError",
    () =>
      Effect.gen(function* () {
        const { root, dir } = recordRoot();
        writeJson(dir, "versions.json", {
          promoted: ["main_gov_auth"],
          staged: [],
        });
        const contracts = yield* resolver(root);
        const error = yield* Effect.flip(contracts.liveHashOf(mainGovAuth));
        expect(error.reason).toContain(MAIN_GOV_AUTH);
      }),
  );
});
