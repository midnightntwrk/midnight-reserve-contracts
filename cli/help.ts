/**
 * The help text. The library's help puts each command's full usage in the
 * root list and a paragraph block under every option; this one prints a
 * line per command, and two lines per option. The names, value types and
 * descriptions still come from the library's help document.
 */
import {
  CliConfig,
  Command,
  CommandDescriptor,
  HelpDoc,
  type Span,
} from "@effect/cli";
import { Option } from "effect";

const WITHOUT_BUILT_INS = CliConfig.make({ showBuiltIns: false });

/** The library's notes on an option that may be left out. */
const OPTIONAL_NOTES = [
  "This setting is optional.",
  "This option can be set from environment variables.",
];

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

/** The blocks under the header `title`, up to the next header; none when the document has no such header. */
const under = (
  blocks: readonly HelpDoc.HelpDoc[],
  title: string,
): readonly HelpDoc.HelpDoc[] => {
  const at = blocks.findIndex(
    (block) => HelpDoc.isHeader(block) && spanText(block.value) === title,
  );
  if (at < 0) return [];
  const rest = blocks.slice(at + 1);
  const next = rest.findIndex(HelpDoc.isHeader);
  return next < 0 ? rest : rest.slice(0, next);
};

const textOf = (doc: HelpDoc.HelpDoc): string =>
  HelpDoc.isParagraph(doc) ? spanText(doc.value) : "";

/** The text of the paragraphs in these blocks. */
const textUnder = (blocks: readonly HelpDoc.HelpDoc[]): string =>
  blocks.map(textOf).join(" ").trim();

/** The arguments or options these blocks list. */
const definitionsUnder = (blocks: readonly HelpDoc.HelpDoc[]) =>
  blocks.flatMap((block) =>
    HelpDoc.isDescriptionList(block) ? block.definitions : [],
  );

const helpBlocks = (descriptor: CommandDescriptor.Command<unknown>) =>
  blocksOf(CommandDescriptor.getHelp(descriptor, WITHOUT_BUILT_INS));

/** "(-n, --network a | b)" -> "-n, --network <a|b>"; "<file> 1+" -> "<file>..."; a flag or a single argument stays as it is. */
const signature = (name: string): string => {
  const text = name.replace(/^\((.*)\)$/, "$1").replace(/ \d+\+$/, "...");
  const valued = text.match(/^(-{1,2}[\w-]+(?:, -{1,2}[\w-]+)*) (.+)$/);
  return valued ? `${valued[1]} <${valued[2].replaceAll(" | ", "|")}>` : text;
};

/** The library's own note on how often an argument repeats; the signature shows it. */
const REPEAT_NOTE = /^This argument (must|may) be repeated/;

/** An argument or option: its signature, then its description; the library's first paragraph names the value type and is left out. */
const entryLines = ([name, doc]: readonly [
  Span.Span,
  HelpDoc.HelpDoc,
]): readonly string[] => {
  const notes = blocksOf(doc).slice(1).map(textOf);
  const description = notes
    .filter((note) => !OPTIONAL_NOTES.includes(note) && !REPEAT_NOTE.test(note))
    .join(" ");
  const required = !notes.some((note) => OPTIONAL_NOTES.includes(note));
  return [
    `  ${signature(spanText(name))}${required ? "  (required)" : ""}`,
    ...(description === "" ? [] : [`      ${description}`]),
  ];
};

/** The help of one command: its description, usage, arguments and options. */
const commandHelp = (
  name: string,
  command: string,
  descriptor: CommandDescriptor.Command<unknown>,
): string => {
  const blocks = helpBlocks(descriptor);
  const args = definitionsUnder(under(blocks, "ARGUMENTS"));
  const options = definitionsUnder(under(blocks, "OPTIONS"));
  return [
    `${name} ${command}`,
    "",
    textUnder(under(blocks, "DESCRIPTION")),
    "",
    "USAGE",
    `  $ ${name} ${command}${args.map(([arg]) => ` ${signature(spanText(arg))}`).join("")}${options.length > 0 ? " [options]" : ""}`,
    ...(args.length > 0 ? ["", "ARGUMENTS", ...args.flatMap(entryLines)] : []),
    ...(options.length > 0
      ? ["", "OPTIONS", ...options.flatMap(entryLines)]
      : []),
  ].join("\n");
};

/** The root help: each subcommand by name with its description, one line each. */
const rootHelp = (
  name: string,
  version: string,
  subcommands: ReadonlyMap<string, CommandDescriptor.Command<unknown>>,
): string => {
  const rows = [...subcommands]
    .map(([command, descriptor]) => [
      command,
      textUnder(under(helpBlocks(descriptor), "DESCRIPTION")),
    ])
    .sort(([a], [b]) => a.localeCompare(b));
  const width = Math.max(...rows.map(([command]) => command.length));
  return [
    `${name} ${version}`,
    "",
    "USAGE",
    `  $ ${name} <command> [options]`,
    `  $ ${name} <command> --help`,
    "",
    "COMMANDS",
    ...rows.map(
      ([command, description]) => `  ${command.padEnd(width)}  ${description}`,
    ),
    "",
    "OPTIONS",
    "  -h, --help     Show this list, or the options of a command",
    "  --version      Show the version",
    "  --wizard       Build a command step by step",
    "  --completions  Print a completion script: sh, bash, fish or zsh",
    "  --log-level    The minimum log level",
  ].join("\n");
};

/** The help text these arguments ask for: the root help for none or for --help alone, a command's help for --help after its name; None when they ask for no help. */
export const helpFor = <Name extends string, R, E, A>(
  root: Command.Command<Name, R, E, A>,
  name: string,
  version: string,
  args: readonly string[],
): Option.Option<string> => {
  if (args.length > 0 && !args.includes("--help") && !args.includes("-h")) {
    return Option.none();
  }
  const subcommands = new Map(Command.getSubcommands(root));
  const descriptor = subcommands.get(args[0] ?? "");
  return Option.some(
    descriptor === undefined
      ? rootHelp(name, version, subcommands)
      : commandHelp(name, args[0], descriptor),
  );
};
