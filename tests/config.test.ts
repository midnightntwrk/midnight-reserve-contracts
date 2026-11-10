import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, afterEach, describe, expect, it } from "@effect/vitest";
import { Config, Effect, Layer, Option } from "effect";
import { envLayer } from "../cli/config";

const tmp = mkdtempSync(join(tmpdir(), "env-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const dotEnv = join(tmp, ".env");
writeFileSync(
  dotEnv,
  [
    "MRC_TEST_SHELL_EMPTY=from-dotenv",
    "MRC_TEST_SHELL_SET=from-dotenv",
    "MRC_TEST_DOTENV_ONLY=from-dotenv",
  ].join("\n"),
);

afterEach(() => {
  delete process.env.MRC_TEST_SHELL_EMPTY;
  delete process.env.MRC_TEST_SHELL_SET;
});

/** The values of the test variables through envLayer over the given dotenv file. */
const read = (dotEnvPath: string) =>
  Effect.gen(function* () {
    process.env.MRC_TEST_SHELL_EMPTY = "";
    process.env.MRC_TEST_SHELL_SET = "from-shell";
    const value = (name: string) => Config.option(Config.String(name));
    return yield* Effect.all({
      shellEmpty: value("MRC_TEST_SHELL_EMPTY"),
      shellSet: value("MRC_TEST_SHELL_SET"),
      dotEnvOnly: value("MRC_TEST_DOTENV_ONLY"),
      neither: value("MRC_TEST_NEITHER"),
    }).pipe(
      Effect.provide(Layer.provide(envLayer(dotEnvPath), NodeServices.layer)),
    );
  });

describe("envLayer", () => {
  it.live(
    "the environment wins, an empty value included; .env fills only what it does not set",
    () =>
      Effect.gen(function* () {
        expect(yield* read(dotEnv)).toEqual({
          shellEmpty: Option.some(""),
          shellSet: Option.some("from-shell"),
          dotEnvOnly: Option.some("from-dotenv"),
          neither: Option.none(),
        });
      }),
  );

  it.live("a missing .env adds nothing", () =>
    Effect.gen(function* () {
      expect(yield* read(join(tmp, "absent.env"))).toEqual({
        shellEmpty: Option.some(""),
        shellSet: Option.some("from-shell"),
        dotEnvOnly: Option.none(),
        neither: Option.none(),
      });
    }),
  );
});
