import { describe, expect, test } from "bun:test";
import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { isRootHelp, rootHelp } from "../cli/help";

const root = Command.make("tool").pipe(
  Command.withSubcommands([
    Command.make(
      "stage-upgrade",
      {
        network: Options.choice("network", ["local", "preview", "mainnet"]),
        output: Options.text("output").pipe(Options.optional),
      },
      () => Effect.void,
    ).pipe(Command.withDescription("Stage a new logic")),
    Command.make("build", {}, () => Effect.void).pipe(
      Command.withDescription("Compile the validators"),
    ),
  ]),
);

describe("root help", () => {
  test("lists each command once, by name, with its description and none of its options", () => {
    const lines = rootHelp(root, "tool", "1.2.3").split("\n");
    expect(lines[0]).toBe("tool 1.2.3");
    const commands = lines.slice(
      lines.indexOf("COMMANDS") + 2,
      lines.indexOf("OPTIONS") - 1,
    );
    expect(commands).toEqual([
      "  build          Compile the validators",
      "  stage-upgrade  Stage a new logic",
    ]);
  });

  test.each([
    [[], true],
    [["--help"], true],
    [["-h"], true],
    [["build", "--help"], false],
    [["--version"], false],
    [["--help", "build"], false],
  ])("arguments %p ask for the root help: %p", (args, expected) => {
    expect(isRootHelp(args)).toBe(expected);
  });
});
