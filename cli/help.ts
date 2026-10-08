/**
 * The root help: one line per command, name and description. The library's
 * root help puts each command's full usage in the left column and pads
 * every row to the longest one, which no terminal fits.
 */
import {
  CliConfig,
  Command,
  CommandDescriptor,
  HelpDoc,
  type Span,
} from "@effect/cli";

/** The plain text of a help span. */
const spanText = (span: Span.Span): string =>
  span._tag === "Text" || span._tag === "URI"
    ? span.value
    : span._tag === "Sequence"
      ? spanText(span.left) + spanText(span.right)
      : spanText(span.value);

/** The blocks of a help document, in order. */
const blocksOf = (doc: HelpDoc.HelpDoc): readonly HelpDoc.HelpDoc[] =>
  HelpDoc.isSequence(doc)
    ? [...blocksOf(doc.left), ...blocksOf(doc.right)]
    : [doc];

/** A command's description: the paragraph under DESCRIPTION in its help. */
const descriptionOf = (
  descriptor: CommandDescriptor.Command<unknown>,
): string => {
  const blocks = blocksOf(
    CommandDescriptor.getHelp(descriptor, CliConfig.defaultConfig),
  );
  const description =
    blocks[
      blocks.findIndex(
        (block) =>
          HelpDoc.isHeader(block) && spanText(block.value) === "DESCRIPTION",
      ) + 1
    ];
  return HelpDoc.isParagraph(description) ? spanText(description.value) : "";
};

/** True when the arguments ask for the root help: none, or only --help or -h. */
export const isRootHelp = (args: readonly string[]): boolean =>
  args.length === 0 ||
  (args.length === 1 && (args[0] === "--help" || args[0] === "-h"));

/** The root help text of `root`: its subcommands by name, one line each. */
export const rootHelp = <Name extends string, R, E, A>(
  root: Command.Command<Name, R, E, A>,
  name: string,
  version: string,
): string => {
  const rows = [...Command.getSubcommands(root)]
    .map(([command, descriptor]) => [command, descriptionOf(descriptor)])
    .sort(([a], [b]) => a.localeCompare(b));
  const width = Math.max(...rows.map(([command]) => command.length));
  return [
    `${name} ${version}`,
    "",
    "USAGE",
    "",
    `  $ ${name} <command> [options]`,
    `  $ ${name} <command> --help`,
    "",
    "COMMANDS",
    "",
    ...rows.map(
      ([command, description]) => `  ${command.padEnd(width)}  ${description}`,
    ),
    "",
    "OPTIONS",
    "",
    "  -h, --help     Show this list, or the options of a command",
    "  --version      Show the version",
    "  --wizard       Build a command step by step",
    "  --completions  Print a completion script: sh, bash, fish or zsh",
    "  --log-level    The minimum log level",
  ].join("\n");
};
