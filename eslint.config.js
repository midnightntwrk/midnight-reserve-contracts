import { readdirSync } from "node:fs";
import { posix } from "node:path";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

/** The Effect runners; only the CLI entry point and the test helpers run an effect. */
const RUNNERS = ["runPromise", "runPromiseExit", "runSync", "runSyncExit", "runFork", "runCallback"];

/**
 * The imports every file of cli/ is refused. A block that sets no-restricted-imports replaces
 * the options of every earlier block, so each per-file block below repeats these.
 */
const NO_FILES_OR_PROCESSES = ["fs", "node:fs", "fs/promises", "node:fs/promises", "child_process", "node:child_process"].map(
  (name) => ({ name, message: "Files go through FileSystem, processes through Command." }),
);

/** The syntax every file of cli/ is refused; no-restricted-syntax is replaced the same way. */
const NO_THROW_OR_TRY = [
  { selector: "ThrowStatement", message: "Fail with a tagged error in the Effect channel, or Effect.die for a defect." },
  { selector: "TryStatement", message: "Use Effect.try / Either.try into a tagged error." },
];

/** Blaze is built by Provider.blazeFor, read only by tx/compile.ts (plans/cli-architecture/00-index.md). */
const NO_BLAZE_FOR = [
  {
    selector: "MemberExpression[property.name='blazeFor']",
    message: "Only tx/compile.ts builds Blaze (Provider.blazeFor): a command returns a TxPlan and calls compile.",
  },
  {
    selector: "ObjectPattern > Property[key.name='blazeFor']",
    message: "Only tx/compile.ts builds Blaze (Provider.blazeFor): a command returns a TxPlan and calls compile.",
  },
];

/** Every module of cli/ as its path under cli/ without the extension: "tx/compile". */
const MODULES = readdirSync("cli", { recursive: true })
  .filter((file) => file.endsWith(".ts"))
  .map((file) => file.slice(0, -".ts".length));

/** Whether the module is one of `scopes` or inside a folder among them. */
const within = (module, ...scopes) => scopes.some((scope) => module === scope || module.startsWith(`${scope}/`));

/**
 * The dependency rules of plans/cli-architecture/00-index.md. `forbids(from, to)` is true when
 * module `from` must not import module `to` (both as paths under cli/ without extension).
 * An "only imported by" rule forbids every importer outside its list.
 */
const BOUNDARIES = [
  {
    message: "tx/** imports no contracts, config or signing, and chain only through chain/provider.",
    forbids: (from, to) =>
      within(from, "tx") &&
      (within(to, "contracts", "config", "signing") || (within(to, "chain") && to !== "chain/provider")),
  },
  {
    message:
      "deploy/builders holds the deployment plans, which are pure: no chain, config, contracts or output.",
    forbids: (from, to) => from === "deploy/builders" && within(to, "chain", "config", "contracts", "output"),
  },
  {
    message: "signing/** imports no contracts.",
    forbids: (from, to) => within(from, "signing") && within(to, "contracts"),
  },
  {
    message: "config/keys is imported only by signing/** and the layers in run.ts.",
    forbids: (from, to) => to === "config/keys" && !within(from, "signing", "run"),
  },
  {
    message: "config/provider-config is imported only by the Blockfrost and Provider modules of chain/ and the layers in run.ts.",
    forbids: (from, to) =>
      to === "config/provider-config" &&
      !within(from, "chain/provider", "chain/blockfrost", "chain/registration", "run"),
  },
  {
    message: "contracts/snapshot/write is imported only by deploy/** and governance/two-stage-upgrade/logic-record.",
    forbids: (from, to) =>
      to === "contracts/snapshot/write" && !within(from, "deploy", "governance/two-stage-upgrade/logic-record"),
  },
  {
    message:
      "contracts/snapshot/read is imported only by contracts/**, deploy/**, governance/two-stage-upgrade/** and report/verify.",
    forbids: (from, to) =>
      to === "contracts/snapshot/read" &&
      !within(from, "contracts", "deploy", "governance/two-stage-upgrade", "report/verify"),
  },
  {
    message: "contracts/bindings is imported only by contracts/build and contracts/snapshot/write.",
    forbids: (from, to) =>
      to === "contracts/bindings" && !within(from, "contracts/build", "contracts/snapshot/write"),
  },
  {
    message: "contracts/snapshot/storage is imported only by contracts/snapshot/read and contracts/snapshot/write.",
    forbids: (from, to) =>
      to === "contracts/snapshot/storage" && !within(from, "contracts/snapshot/read", "contracts/snapshot/write"),
  },
  {
    message: "contracts/snapshot/names and contracts/snapshot/context are the leaves: they import nothing under contracts/snapshot/.",
    forbids: (from, to) =>
      within(from, "contracts/snapshot/names", "contracts/snapshot/context") && within(to, "contracts/snapshot"),
  },
  {
    message: "The contract system returns outcomes and commands print: contracts/snapshot/** and contracts/bindings do not import output.",
    forbids: (from, to) => within(from, "contracts/snapshot", "contracts/bindings") && to === "output",
  },
  {
    message: "contracts/build-engine is imported only by contracts/build and commands/build.",
    forbids: (from, to) =>
      to === "contracts/build-engine" && !within(from, "contracts/build", "commands/build"),
  },
];

/** The import specifier of module `to` in module `from`. */
const specifier = (from, to) => {
  const relative = posix.relative(posix.dirname(from), to);
  return relative.startsWith(".") ? relative : `./${relative}`;
};

/** For each module with an import the boundaries refuse: its no-restricted-imports block, in which the refusals follow the fs and child_process bans. */
const BOUNDARY_BLOCKS = MODULES.flatMap((from) => {
  const refused = MODULES.flatMap((to) => {
    const broken = BOUNDARIES.filter((boundary) => boundary.forbids(from, to));
    return broken.length === 0
      ? []
      : [{ name: specifier(from, to), message: broken.map((boundary) => boundary.message).join(" ") }];
  });
  return refused.length === 0
    ? []
    : [
        {
          files: [`cli/${from}.ts`],
          rules: { "no-restricted-imports": ["error", { paths: [...NO_FILES_OR_PROCESSES, ...refused] }] },
        },
      ];
});

export default [
  {
    files: ["cli/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsparser,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // The Effect surface: all of cli/.
    files: ["cli/**/*.ts"],
    rules: {
      "no-throw-literal": "error",
      "no-console": "error",
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "HTTP goes through the HttpClient service." },
        { name: "Bun", message: "Use the @effect/platform services (FileSystem, Command, ...)." },
      ],
      "no-restricted-imports": ["error", { paths: NO_FILES_OR_PROCESSES }],
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "exit",
          message: "runMain exits the process, with the code the teardown in cli/run.ts gives it.",
        },
        {
          object: "process",
          property: "env",
          message: "Read environment values through cli/config (Profile, DeployerAddress, ProviderConfig, Keys, intent-env, env).",
        },
        ...RUNNERS.map((property) => ({
          object: "Effect",
          property,
          message: "The CLI runs through BunRuntime.runMain in cli/index.ts.",
        })),
        {
          object: "Effect",
          property: "promise",
          message: "A promise can reject: wrap it with Effect.tryPromise into a tagged error.",
        },
      ],
      "no-restricted-syntax": ["error", ...NO_THROW_OR_TRY],
    },
  },
  ...BOUNDARY_BLOCKS,
  {
    // Blaze is built in tx/compile.ts alone; chain/provider.ts defines blazeFor.
    files: ["cli/**/*.ts"],
    ignores: ["cli/tx/**", "cli/chain/provider.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...NO_THROW_OR_TRY, ...NO_BLAZE_FOR],
    },
  },
  {
    // Tests: no try/catch (expectFailure returns the tagged error) and one runtime helper.
    files: ["tests/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "TryStatement", message: "Use expectFailure, or Either for a pure failure." },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    ignores: ["tests/helpers/effect.ts", "tests/effect-output.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...RUNNERS.map((property) => ({
          object: "Effect",
          property,
          message: "Run effects through runTest / expectFailure in tests/helpers/effect.ts.",
        })),
      ],
    },
  },
  {
    ignores: ["node_modules/**", "dist/**", "*.js"],
  },
];
