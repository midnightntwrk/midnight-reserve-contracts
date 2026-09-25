import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { FileSystem } from "@effect/platform";
import { Effect, Either, Layer, Option } from "effect";
import { PlatformLive, runTest } from "./helpers/effect";
import {
  type DeployedScripts,
  DeployedScriptsLive,
  readVersions,
  validatorNameByHash,
} from "../cli/contracts/versions";
import { logicToStage } from "../cli/governance/two-stage-upgrade";
import { parseScriptHash } from "../cli/input";

/** The hash of a validator title in an environment's deployed plutus.json. */
const logicHash = (env: string, title: string): string => {
  const plutus: { validators: { title: string; hash: string }[] } = JSON.parse(
    readFileSync(
      resolve(import.meta.dir, `../deployed-scripts/${env}/plutus.json`),
      "utf-8",
    ),
  );
  return plutus.validators.find((v) => v.title === title)!.hash;
};

const councilLogicHash = (env: string) =>
  logicHash(env, "permissioned.council_logic.else");

/** Read-only runs over the repository's snapshots. */
const run = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | DeployedScripts>,
) => runTest(Layer.merge(PlatformLive, DeployedScriptsLive), effect);

test.each(["devnet", "govnet", "mainnet", "preprod", "preview", "qanet"])(
  "the %s plutus.json names council_logic by hash and versions.json lists it promoted",
  async (env) => {
    expect(await run(validatorNameByHash(env, councilLogicHash(env)))).toEqual(
      Option.some("council_logic"),
    );
    expect(Option.getOrThrow(await run(readVersions(env))).promoted).toContain(
      "council_logic",
    );
  },
);

describe("logicToStage", () => {
  const hash = (hex: string) => Either.getOrThrow(parseScriptHash(hex));
  const mainnetAsBuild = {
    profile: "devnet" as const,
    plutusPath: resolve(
      import.meta.dir,
      "../deployed-scripts/mainnet/plutus.json",
    ),
  };

  test("a hash in the record is named from it and not copied", async () => {
    expect(
      await run(
        logicToStage(
          "devnet",
          hash(councilLogicHash("devnet")),
          mainnetAsBuild,
        ),
      ),
    ).toEqual({ name: "council_logic", copyFrom: Option.none() });
  });

  test("a build logic whose name is not promoted is named from the build and copied", async () => {
    const v2 = logicHash(
      "mainnet",
      "cnight_minting_v2.cnight_mint_logic_v2.else",
    );
    expect(await run(logicToStage("devnet", hash(v2), mainnetAsBuild))).toEqual(
      {
        name: "cnight_mint_logic_v2",
        copyFrom: Option.some(mainnetAsBuild.plutusPath),
      },
    );
  });

  test("a build logic whose name is promoted under another hash is refused", async () => {
    const error = await run(
      Effect.flip(
        logicToStage(
          "devnet",
          hash(councilLogicHash("mainnet")),
          mainnetAsBuild,
        ),
      ),
    );
    expect(error).toMatchObject({
      _tag: "PreconditionFailed",
      refusal: { _tag: "PromotedLogicMoved", name: "council_logic" },
    });
  });

  test("a hash in neither is refused with the build to run", async () => {
    const error = await run(
      Effect.flip(
        logicToStage("devnet", hash("ab".repeat(28)), mainnetAsBuild),
      ),
    );
    expect(error).toMatchObject({
      _tag: "PreconditionFailed",
      refusal: {
        _tag: "LogicNotFound",
        logicHash: "ab".repeat(28),
        environment: "devnet",
        profile: "devnet",
      },
    });
  });
});
