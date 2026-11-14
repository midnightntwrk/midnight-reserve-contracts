import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { DeployedScripts, type Environment } from "../cli/config";
import { ContractResolver } from "../cli/contracts/resolver";

const empty = mkdtempSync(join(tmpdir(), "deployed-scripts-"));
/** A record root whose devnet record is preview's, and whose qanet record has no bindings. Its node_modules links the repository's, so the bindings resolve their packages. */
const other = mkdtempSync(join(tmpdir(), "deployed-scripts-"));
symlinkSync(resolve("node_modules"), join(other, "node_modules"));
mkdirSync(join(other, "devnet"));
for (const file of ["plutus.json", "versions.json", "contract_blueprint.ts"]) {
  copyFileSync(
    join("deployed-scripts/preview", file),
    join(other, "devnet", file),
  );
}
mkdirSync(join(other, "qanet"));
copyFileSync(
  "deployed-scripts/qanet/plutus.json",
  join(other, "qanet", "plutus.json"),
);
afterAll(() => {
  rmSync(empty, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});

/** The resolver of `environment`; its record root is the repository's deployed-scripts/, or `root`. */
const resolverOf = (environment: Environment, root?: string) =>
  Effect.provide(
    ContractResolver,
    Layer.provide(
      ContractResolver.layer(environment),
      Layer.merge(
        NodeServices.layer,
        root === undefined ? DeployedScripts.layer : DeployedScripts.at(root),
      ),
    ),
  );

/** The hash of the validator with this title in a plutus.json. */
const hashIn = (path: string, title: string) => {
  const plutus: { validators: { title: string; hash: string }[] } = JSON.parse(
    readFileSync(path, "utf-8"),
  );
  return plutus.validators.find((v) => v.title === title)?.hash;
};
const MAIN_GOV_AUTH = "gov_auth.main_gov_auth.else";

const RECORDED = [
  "preview",
  "qanet",
  "govnet",
  "devnet",
  "preprod",
  "mainnet",
] as const;

describe("ContractResolver.contracts", () => {
  it.live.each(RECORDED)(
    "a command acting on the contracts of %s reads its record",
    (environment) =>
      Effect.gen(function* () {
        const contracts = (yield* resolverOf(environment)).contracts("actsOn");
        expect(contracts.source).toBe("deployed");
        const { govAuth } = yield* contracts.instances;
        expect(govAuth.Script.hash()).toBe(
          hashIn(`deployed-scripts/${environment}/plutus.json`, MAIN_GOV_AUTH),
        );
      }),
  );

  it.live(
    "on devnet the record and the build differ, and acting on the contracts takes the record's",
    () =>
      Effect.gen(function* () {
        const deployed = hashIn(
          "deployed-scripts/devnet/plutus.json",
          MAIN_GOV_AUTH,
        );
        const built = hashIn("plutus-devnet.json", MAIN_GOV_AUTH);
        expect(deployed).not.toBe(built);
        const resolver = yield* resolverOf("devnet");
        const actsOn = yield* resolver.contracts("actsOn").instances;
        const creates = yield* resolver.contracts("creates").instances;
        expect(actsOn.govAuth.Script.hash()).toBe(deployed);
        expect(creates.govAuth.Script.hash()).toBe(built);
      }),
  );

  it.live.each(RECORDED)(
    "a command creating contracts on %s reads the build",
    (environment) =>
      Effect.gen(function* () {
        const contracts = (yield* resolverOf(environment)).contracts("creates");
        expect(contracts.source).toBe("build");
        const { govAuth } = yield* contracts.instances;
        expect(govAuth.Script.hash()).toBe(
          hashIn(`plutus-${environment}.json`, MAIN_GOV_AUTH),
        );
      }),
  );

  it.live("local and the emulator have no record and read the build", () =>
    Effect.gen(function* () {
      for (const environment of ["local", "emulator"] as const) {
        const resolver = yield* resolverOf(environment);
        expect(resolver.contracts("actsOn").source).toBe("build");
        expect(resolver.contracts("creates").source).toBe("build");
      }
      const { govAuth } = yield* (yield* resolverOf("emulator")).contracts(
        "actsOn",
      ).instances;
      expect(govAuth.Script.hash()).toBe(
        hashIn("plutus-default.json", MAIN_GOV_AUTH),
      );
    }),
  );

  it.live(
    "a full deploy reads only the build: an empty record root changes nothing",
    () =>
      Effect.gen(function* () {
        const resolver = yield* resolverOf("preview", empty);
        const { govAuth } = yield* resolver.contracts("creates").instances;
        expect(govAuth.Script.hash()).toBe(
          hashIn("plutus-preview.json", MAIN_GOV_AUTH),
        );
        expect(resolver.deployRule(true)).toEqual(Option.some("replace"));
      }),
  );

  it.live(
    "acting on the contracts reads the record under the selected root, not the repository's",
    () =>
      Effect.gen(function* () {
        const { govAuth } = yield* (yield* resolverOf(
          "devnet",
          other,
        )).contracts("actsOn").instances;
        expect(govAuth.Script.hash()).toBe(
          hashIn("deployed-scripts/preview/plutus.json", MAIN_GOV_AUTH),
        );
        expect(govAuth.Script.hash()).not.toBe(
          hashIn("deployed-scripts/devnet/plutus.json", MAIN_GOV_AUTH),
        );
      }),
  );

  it.live(
    "a record without its bindings under the selected root is a BlueprintError naming the file",
    () =>
      Effect.gen(function* () {
        for (const root of [other, empty]) {
          const error = yield* Effect.flip(
            (yield* resolverOf("qanet", root)).contracts("actsOn").instances,
          );
          expect(error).toMatchObject({
            _tag: "BlueprintError",
            source: "deployed",
            reason: `no ${join(root, "qanet", "contract_blueprint.ts")}`,
          });
        }
      }),
  );

  it.live("a class the record lacks is a BlueprintError naming it", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        (yield* resolverOf("preview")).contracts("actsOn").classOf(["Nope"]),
      );
      expect(error).toMatchObject({
        _tag: "BlueprintError",
        source: "deployed",
        reason: "none of the contract classes Nope is in the blueprint",
      });
    }),
  );
});

describe("ContractResolver.deployRule", () => {
  it.live.each(["preview", "qanet", "govnet", "devnet"] as const)(
    "a full deploy on %s replaces the record; a --components deploy extends it",
    (environment) =>
      Effect.gen(function* () {
        const resolver = yield* resolverOf(environment);
        expect(resolver.deployRule(true)).toEqual(Option.some("replace"));
        expect(resolver.deployRule(false)).toEqual(Option.some("extend"));
      }),
  );

  it.live.each(["preprod", "mainnet"] as const)(
    "any deploy on %s extends the record",
    (environment) =>
      Effect.gen(function* () {
        const resolver = yield* resolverOf(environment);
        expect(resolver.deployRule(true)).toEqual(Option.some("extend"));
        expect(resolver.deployRule(false)).toEqual(Option.some("extend"));
      }),
  );

  it.live.each(["local", "emulator"] as const)(
    "a deploy on %s keeps no record",
    (environment) =>
      Effect.gen(function* () {
        const resolver = yield* resolverOf(environment);
        expect(resolver.deployRule(true)).toEqual(Option.none());
        expect(resolver.deployRule(false)).toEqual(Option.none());
      }),
  );
});
