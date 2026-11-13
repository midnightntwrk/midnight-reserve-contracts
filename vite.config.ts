import { readdirSync } from "node:fs";
import { posix, resolve } from "node:path";
import { defineConfig } from "vite-plus";
import type { OxlintOverride } from "vite-plus/lint";

/** The Effect runners; only cli/main.ts (through runMain) and the test helpers run an effect. */
const RUNNERS = [
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
  "runFork",
  "runCallback",
];

/** Bun left the project (plans/effect4 D7): neither the CLI nor the tests may reach it. */
const NO_BUN = {
  group: ["bun", "bun:*", "@effect/platform-bun", "@effect/platform-bun/*"],
  message:
    "The CLI and the tests run on Node through Vite+; Bun is not a dependency.",
};

/**
 * The imports every file of cli/ is refused. A block that sets no-restricted-imports replaces
 * the options of every earlier block, so each per-file block below repeats these.
 */
const NO_FILES_OR_PROCESSES = [
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "child_process",
  "node:child_process",
].map((name) => ({
  name,
  message: "Files go through FileSystem, processes through ChildProcess.",
}));

/** Blaze's sdk and tx packages are used only by tx.ts, in compile (plans/effect4/00-index.md). */
const NO_BLAZE = ["@blaze-cardano/sdk", "@blaze-cardano/tx"].map((name) => ({
  name,
  message:
    "Only tx.ts (compile) uses Blaze's sdk and tx packages: a command returns a TxPlan and calls compile.",
}));

/** The syntax every file of cli/ is refused; mrc/no-restricted-syntax is replaced the same way. */
const NO_THROW_OR_TRY = [
  {
    selector: "ThrowStatement",
    message:
      "Fail with a tagged error in the Effect channel, or Effect.die for a defect.",
  },
  {
    selector: "TryStatement",
    message: "Use Effect.try into a tagged error.",
  },
];

/**
 * The boundary blocks below match exact specifiers ("./keys"). A relative specifier is refused
 * unless it is in that form, so a rule cannot be dodged with "./keys.js" (which TypeScript
 * resolves to keys.ts) or "./contracts/../keys".
 */
const CANONICAL_IMPORTS = [
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
  "ImportExpression",
].flatMap((node) => [
  {
    selector: `${node}[source.value=/^\\./]:not([source.value=/^(\\.\\/|(\\.\\.\\/)+)([^.\\/][^\\/]*\\/)*[^.\\/][^\\/]*$/])`,
    message:
      "Name a module as ./a/b or ../a/b: no ./ or ../ after the first segment.",
  },
  {
    selector: `${node}[source.value=/^\\..*\\.[cm]?[jt]sx?$/]`,
    message:
      "Name a module without its extension, as the dependency rules match it.",
  },
]);

/** Every module of cli/ as its path under cli/ without the extension: "contracts/build". */
const MODULES = readdirSync(resolve(import.meta.dirname, "cli"), {
  recursive: true,
  encoding: "utf8",
})
  .filter((file) => file.endsWith(".ts"))
  .map((file) => file.slice(0, -".ts".length));

/** Whether the module is one of `scopes` or inside a folder among them. */
const within = (module: string, ...scopes: string[]) =>
  scopes.some((scope) => module === scope || module.startsWith(`${scope}/`));

/**
 * The dependency rules of plans/effect4/00-index.md. `forbids(from, to)` is true when module
 * `from` must not import module `to` (both as paths under cli/ without extension). An "only
 * imported by" rule forbids every importer outside its list. A rule may name a module that
 * does not exist yet; it applies from the commit that adds it.
 */
const BOUNDARIES: {
  message: string;
  forbids: (from: string, to: string) => boolean;
}[] = [
  {
    message:
      "tx imports no contracts, config, keys or signing: compile gets everything in its TxPlan and CompileOptions.",
    forbids: (from, to) =>
      from === "tx" && within(to, "contracts", "config", "keys", "signing"),
  },
  {
    message: "signing imports no contracts.",
    forbids: (from, to) => from === "signing" && within(to, "contracts"),
  },
  {
    message: "keys is imported only by signing and the layers in main.",
    forbids: (from, to) => to === "keys" && !within(from, "signing", "main"),
  },
  {
    message:
      "contracts/snapshot-write is imported only by deploy and governance/two-stage.",
    forbids: (from, to) =>
      to === "contracts/snapshot-write" &&
      !within(from, "deploy", "governance/two-stage"),
  },
  {
    message:
      "contracts/snapshot-read is imported only by contracts/**, deploy, governance/two-stage and report.",
    forbids: (from, to) =>
      to === "contracts/snapshot-read" &&
      !within(from, "contracts", "deploy", "governance/two-stage", "report"),
  },
  {
    message:
      "contracts/build (the build engine and the bindings) is imported only by commands and contracts/snapshot-write.",
    forbids: (from, to) =>
      to === "contracts/build" &&
      !within(from, "commands", "contracts/snapshot-write"),
  },
  {
    message:
      "The snapshot returns outcomes and commands print: contracts/snapshot-read and contracts/snapshot-write do not import output.",
    forbids: (from, to) =>
      within(from, "contracts/snapshot-read", "contracts/snapshot-write") &&
      to === "output",
  },
];

/** The import specifier of module `to` in module `from`. */
const specifier = (from: string, to: string) => {
  const relative = posix.relative(posix.dirname(from), to);
  return relative.startsWith(".") ? relative : `./${relative}`;
};

/**
 * The no-restricted-imports paths of a module of cli/. The fs and child_process bans come
 * first, then Blaze outside tx.ts, then the modules the boundaries refuse it, then
 * ProviderConfig, which no module but chain.ts names: the provider credentials never leave
 * chain.ts.
 */
const boundaryPaths = (from: string) => [
  ...NO_FILES_OR_PROCESSES,
  ...(from === "tx" ? [] : NO_BLAZE),
  ...MODULES.flatMap((to) => {
    const broken = BOUNDARIES.filter((boundary) => boundary.forbids(from, to));
    return broken.length === 0
      ? []
      : [
          {
            name: specifier(from, to),
            message: broken.map((boundary) => boundary.message).join(" "),
          },
        ];
  }),
  ...(from === "chain" || !MODULES.includes("chain")
    ? []
    : [
        {
          name: specifier(from, "chain"),
          importNames: ["ProviderConfig"],
          message:
            "ProviderConfig stays inside chain.ts: no other module reads provider credentials.",
        },
      ]),
];

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
  fmt: {
    printWidth: 80,
    // Formatted: the CLI and the tests; everything else keeps its own format.
    ignorePatterns: ["/*", "!/cli/", "!/tests/", "/tests/golden/"],
  },
  lint: {
    // Linted: the CLI and the tests.
    ignorePatterns: ["/*", "!/cli/", "!/tests/"],
    // Type-aware rules run through oxlint-tsgolint; type errors come from tsc (TypeScript 6) in `just check`.
    options: { typeAware: true, typeCheck: false },
    jsPlugins: [
      "./lint-plugin.js",
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
    ],
    rules: {
      // The rules of @typescript-eslint's recommended set that Oxlint has.
      "no-array-constructor": "error",
      "no-unused-expressions": "error",
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "typescript/ban-ts-comment": "error",
      "typescript/no-duplicate-enum-values": "error",
      "typescript/no-empty-object-type": "error",
      "typescript/no-explicit-any": "error",
      "typescript/no-extra-non-null-assertion": "error",
      "typescript/no-misused-new": "error",
      "typescript/no-namespace": "error",
      "typescript/no-non-null-asserted-optional-chain": "error",
      "typescript/no-require-imports": "error",
      "typescript/no-this-alias": "error",
      "typescript/no-unnecessary-type-constraint": "error",
      "typescript/no-unsafe-declaration-merging": "error",
      "typescript/no-unsafe-function-type": "error",
      "typescript/no-wrapper-object-types": "error",
      "typescript/prefer-as-const": "error",
      "typescript/prefer-namespace-keyword": "error",
      "typescript/triple-slash-reference": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
      "no-restricted-globals": [
        "error",
        { name: "Bun", message: NO_BUN.message },
      ],
      "no-restricted-imports": ["error", { patterns: [NO_BUN] }],
    },
    overrides: [
      {
        // The Effect surface: all of cli/.
        files: ["cli/**/*.ts"],
        rules: {
          "no-throw-literal": "error",
          "no-console": "error",
          "no-restricted-globals": [
            "error",
            {
              name: "fetch",
              message: "HTTP goes through the HttpClient service.",
            },
            { name: "Bun", message: NO_BUN.message },
          ],
          "no-restricted-imports": [
            "error",
            {
              paths: [...NO_FILES_OR_PROCESSES, ...NO_BLAZE],
              patterns: [NO_BUN],
            },
          ],
          "no-restricted-properties": [
            "error",
            {
              object: "process",
              property: "exit",
              message:
                "runMain exits the process, with the code the teardown in cli/main.ts gives it.",
            },
            {
              object: "process",
              property: "env",
              message:
                "Read environment values through Config, in the module that owns them (config.ts, keys.ts, chain.ts).",
            },
            ...RUNNERS.map((property) => ({
              object: "Effect",
              property,
              message:
                "The CLI runs through NodeRuntime.runMain in cli/main.ts.",
            })),
            {
              object: "Effect",
              property: "promise",
              message:
                "A promise can reject: wrap it with Effect.tryPromise into a tagged error.",
            },
          ],
          "mrc/no-restricted-syntax": [
            "error",
            ...NO_THROW_OR_TRY,
            ...CANONICAL_IMPORTS,
          ],
        },
      },
      // Per module of cli/: its import boundaries (see boundaryPaths).
      ...MODULES.map((from): OxlintOverride => ({
        files: [`cli/${from}.ts`],
        rules: {
          "no-restricted-imports": [
            "error",
            { paths: boundaryPaths(from), patterns: [NO_BUN] },
          ],
        },
      })),
      {
        // Tests: no try/catch (Effect.flip or Result for a failure).
        files: ["tests/**/*.ts"],
        rules: {
          "typescript/no-non-null-asserted-optional-chain": "off",
          "mrc/no-restricted-syntax": [
            "error",
            {
              selector: "TryStatement",
              message: "Use Effect.flip, or Result for a pure failure.",
            },
          ],
        },
      },
      {
        // Effects run through it.effect / it.live; only the helpers may run one directly.
        files: ["tests/**/*.ts"],
        excludeFiles: ["tests/helpers/**"],
        rules: {
          "no-restricted-properties": [
            "error",
            ...RUNNERS.map((property) => ({
              object: "Effect",
              property,
              message:
                "Run effects through it.effect / it.live from @effect/vitest.",
            })),
          ],
        },
      },
    ],
  },
});
