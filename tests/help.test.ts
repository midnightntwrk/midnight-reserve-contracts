import { describe, expect, test } from "bun:test";
import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { helpFor } from "../cli/help";

const root = Command.make("tool").pipe(
  Command.withSubcommands([
    Command.make(
      "stage-upgrade",
      {
        file: Args.text({ name: "file" }).pipe(
          Args.withDescription("The transaction file"),
        ),
        witnesses: Args.text({ name: "witness" }).pipe(
          Args.withDescription("The witness files"),
          Args.atLeast(1),
        ),
        network: Options.choice("network", ["local", "mainnet"]).pipe(
          Options.withAlias("n"),
          Options.withDescription("The environment (default: local)"),
          Options.withDefault("local"),
        ),
        txHash: Options.text("tx-hash").pipe(
          Options.withDescription("The fee UTxO's transaction"),
        ),
        noSign: Options.boolean("no-sign").pipe(
          Options.withDescription("Write the transaction unsigned"),
        ),
      },
      () => Effect.void,
    ).pipe(Command.withDescription("Stage a new logic")),
    Command.make("build", {}, () => Effect.void).pipe(
      Command.withDescription("Compile the validators"),
    ),
  ]),
);

const help = (...args: string[]) =>
  Option.getOrThrow(helpFor(root, "tool", "1.2.3", args)).split("\n");

describe("help", () => {
  test.each([[[]], [["--help"]], [["-h"]], [["nosuch", "--help"]]])(
    "arguments %p give the root help: each command once, by name, with its description",
    (args) => {
      expect(help(...args)).toEqual([
        "tool 1.2.3",
        "",
        "USAGE",
        "  $ tool <command> [options]",
        "  $ tool <command> --help",
        "",
        "COMMANDS",
        "  build          Compile the validators",
        "  stage-upgrade  Stage a new logic",
        "",
        "OPTIONS",
        "  -h, --help     Show this list, or the options of a command",
        "  --version      Show the version",
        "  --wizard       Build a command step by step",
        "  --completions  Print a completion script: sh, bash, fish or zsh",
        "  --log-level    The minimum log level",
      ]);
    },
  );

  test.each([
    [["stage-upgrade", "--help"]],
    [["stage-upgrade", "-n", "mainnet", "-h"]],
  ])(
    "arguments %p give the command's help: two lines per argument and option, a required one marked, a repeated one with dots",
    (args) => {
      expect(help(...args)).toEqual([
        "tool stage-upgrade",
        "",
        "Stage a new logic",
        "",
        "USAGE",
        "  $ tool stage-upgrade <file> <witness>... [options]",
        "",
        "ARGUMENTS",
        "  <file>  (required)",
        "      The transaction file",
        "  <witness>...  (required)",
        "      The witness files",
        "",
        "OPTIONS",
        "  -n, --network <local|mainnet>",
        "      The environment (default: local)",
        "  --tx-hash <text>  (required)",
        "      The fee UTxO's transaction",
        "  --no-sign",
        "      Write the transaction unsigned",
      ]);
    },
  );

  test("a command with no option has no OPTIONS section", () => {
    expect(help("build", "--help")).toEqual([
      "tool build",
      "",
      "Compile the validators",
      "",
      "USAGE",
      "  $ tool build",
    ]);
  });

  test.each([
    [["build"]],
    [["stage-upgrade", "--tx-hash", "ab"]],
    [["--version"]],
  ])("arguments %p ask for no help", (args) => {
    expect(Option.isNone(helpFor(root, "tool", "1.2.3", args))).toBe(true);
  });
});
