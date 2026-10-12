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
