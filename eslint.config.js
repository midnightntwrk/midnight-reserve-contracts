import globals from "globals";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["cli/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsparser,
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsparser,
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
    },
  },
  {
    ignores: ["node_modules/**", "dist/**", "*.js"],
  },
];
