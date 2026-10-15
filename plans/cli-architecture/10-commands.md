# Phase 10 — One commands file

Runs after 08, once the programs under `cli/commands/` stop moving.

`cli/commands/` holds 23 files (705 lines, median 27). Each is one
`Command.make(name, options, (input) => program(input))` with its
description and services layer. `cli/index.ts` is the only importer
(23 imports); no test imports a command file.

## Target

```
cli/
  commands.ts   every command declaration, in help order; exports only the ordered `commands` array
  index.ts      runtime assembly (root command, runMain, teardown); imports `commands`
```

`cli/commands/` is deleted; no barrel, no re-exports.

## Tasks

1. Pure move: each command's declaration into `commands.ts`, imports
   merged; options two commands share stay in `options.ts`. `index.ts`
   registers `commands`. No behaviour change.

One commit.

## Acceptance

- `cli/commands/` gone; `commands.ts` is the only importer of the command
  programs it wires.
- `help.test` unchanged and green; `bun cli/index.ts --help` and each
  command's `--help` print the same text as before (manual smoke, no test
  drives the binary).

## Deviations

- Options that only one command uses moved with it and are prefixed with the
  command (`deployComponents`, `buildComponents`, `stageUpgradeValidator`,
  `mintTcnightAmount`, ...), because several commands each had a local
  `components`, `validator` or `amount`. Their flag names are unchanged.
- `commands` is declared `as const`; `cli/commands.ts` is 691 lines, a flat
  list of declarations in help order.
- `eslint.config.js` allows `contracts/build-engine` to `commands` instead of
  `commands/build`; README and `00-index.md` / `09-contract-system.md` name the
  new module.
- Help output: `--help` of the root and of all 23 commands is byte-identical
  to the tree before the change.
