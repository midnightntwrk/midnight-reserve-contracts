import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

/** The Effect runners; only the CLI entry point and the test helpers run an effect. */
const RUNNERS = ["runPromise", "runPromiseExit", "runSync", "runSyncExit", "runFork", "runCallback"];

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
      "no-restricted-imports": [
        "error",
        {
          paths: ["fs", "node:fs", "fs/promises", "node:fs/promises", "child_process", "node:child_process"].map(
            (name) => ({ name, message: "Files go through FileSystem, processes through Command." }),
          ),
        },
      ],
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
          message: "Read environment values through the Settings service.",
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
      "no-restricted-syntax": [
        "error",
        { selector: "ThrowStatement", message: "Fail with a tagged error in the Effect channel, or Effect.die for a defect." },
        { selector: "TryStatement", message: "Use Effect.try / Either.try into a tagged error." },
      ],
    },
  },
  {
    // Tests: no try/catch (expectFailure returns the tagged error) and one runtime helper.
    files: ["tests/**/*.ts"],
    ignores: ["tests/bridge/**"],
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
