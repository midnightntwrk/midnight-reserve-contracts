/** The lint rules Oxlint lacks, as a JS plugin (vite.config.ts registers it as `mrc`). */
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

/** ESLint's no-restricted-syntax: each option is an AST selector and the message a match reports. */
const noRestrictedSyntax = defineRule({
  meta: { schema: false },
  create: (context) =>
    Object.fromEntries(
      context.options.map(({ selector, message }) => [
        selector,
        (node) => context.report({ node, message }),
      ]),
    ),
});

export default definePlugin({
  meta: { name: "mrc" },
  rules: { "no-restricted-syntax": noRestrictedSyntax },
});
