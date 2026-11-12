import { describe, expect, test } from "bun:test";
import { HelpDoc, ValidationError } from "@effect/cli";
import { Cause, Console, Effect, FiberId } from "effect";
import { reportFailure } from "../cli/run";
import { ConfigError, type CliError } from "../cli/errors";
import { captureOutput, OutputCaptured, runTest } from "./helpers/effect";

const failure = new ConfigError({
  source: "env",
  key: "LOG_LEVEL",
  reason: "'bogus' is not a log level",
});
const rendered = "❌ Invalid env LOG_LEVEL: 'bogus' is not a log level\n";
const interrupt = Cause.interrupt(FiberId.none);

/** The Output lines and the Console.error lines reportFailure prints for a cause. */
const report = async (
  cause: Cause.Cause<CliError | ValidationError.ValidationError>,
) => {
  const capture = captureOutput();
  const stderr: string[] = [];
  await runTest(
    OutputCaptured(capture),
    Console.consoleWith((console) =>
      Console.withConsole(reportFailure(cause), {
        ...console,
        error: (...args: readonly unknown[]) =>
          Effect.sync(() => void stderr.push(args.join(" "))),
      }),
    ),
  );
  return { output: capture.lines, stderr };
};

describe("reportFailure", () => {
  test("a CliError prints once through Output", async () => {
    expect(await report(Cause.fail(failure))).toEqual({
      output: [rendered],
      stderr: [],
    });
  });

  test("a CliError beside an interrupt prints once, and the interrupt not at all", async () => {
    expect(
      await report(Cause.parallel(Cause.fail(failure), interrupt)),
    ).toEqual({ output: [rendered], stderr: [] });
  });

  test("a CliError beside a defect prints once; the defect prints without it", async () => {
    const boom = new Error("boom");
    expect(
      await report(Cause.parallel(Cause.fail(failure), Cause.die(boom))),
    ).toEqual({ output: [rendered], stderr: [Cause.pretty(Cause.die(boom))] });
  });

  test("an interrupt alone prints its one line", async () => {
    expect(await report(interrupt)).toEqual({
      output: [],
      stderr: ["All fibers interrupted without errors."],
    });
  });

  test("a ValidationError prints nothing: @effect/cli has printed it", async () => {
    expect(
      await report(
        Cause.fail(ValidationError.invalidValue(HelpDoc.p("Invalid --x"))),
      ),
    ).toEqual({ output: [], stderr: [] });
  });
});
