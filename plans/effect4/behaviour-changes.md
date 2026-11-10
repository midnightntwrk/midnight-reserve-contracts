# Behaviour changes: main's yargs CLI → the Effect 4 CLI

What a user of main's CLI (`cli-yargs/`) sees change once the Effect 4 CLI
lands. The Effect 4 CLI follows the Effect 3 reference (`ouwrttzy`) on every
row except **row 17, which is fixed**. **Row 63 follows the reference.**
Rows were found by reading both CLIs and by offline runs; rows where both
fail are left out.

## Every transaction command

| # | Case | main | Effect 4 |
|---|---|---|---|
| 1 | Coin selection | may spend any deployer UTxO, one-shots, collateral and reference-script UTxOs included | never selects those |
| 2 | `--tx-hash/--tx-index` fee UTxO carrying a reference script | used | refused |
| 3 | Transaction over `maxTxSize` with its signatures | written | fails |
| 4 | Upper-case hex in `--tx-hash`/`--utxo*-hash` | "UTxO not found" | works |
| 5 | `--fee-padding -5` | used as negative padding | refused at parse |
| 6 | `--sign false` (change-*, stage, promote, mint-staging-state) | works | unknown argument; `--no-sign` only |
| 7 | `DEPLOYER_ADDRESS` on another network | accepted | config error |
| 8 | merge-utxos, mint-staging-state from another directory | fail (aiken.toml from cwd) | work |
| 9 | Stake-registration pre-check on a deregistered account | treated as registered (any HTTP 200) | not registered (`registered: true` required); other statuses retried 3×, then fail |

## Per command

| # | Case | main | Effect 4 |
|---|---|---|---|
| 10 | change-council, -tech-auth, -federated-ops, -terms with signing keys unset | writes `"signed": true` with no or half the witnesses | fails up front (`…PRIVATE_KEYS` required) |
| 11 | Any signing command with a 128-hex extended key | fails | works (keys trimmed) |
| 12 | change-council, -tech-auth: `*_SIGNERS` with an empty entry or extra `:field` | dropped silently | refused |
| 13 | change-federated-ops: `PERMISSIONED_CANDIDATES` line without `:` | ignored | refused |
| 14 | change-federated-ops: on-chain datum with an unknown candidate key id | dropped from the new datum | refused |
| 15 | change-tech-auth | needs the council two-stage UTxO | does not read it |
| 16 | change-federated-ops, change-terms | need the council and tech-auth two-stage UTxOs | do not read them |
| 17 | **stage-upgrade `--use-build` on preprod/qanet/govnet/devnet** | forevers, threshold, gov auth from the deployed record | **fixed:** from the deployed record wherever one exists; from the build only on local/emulator (the reference took them from the build, whose hashes differ on those four networks) |
| 18 | stage-upgrade `-n local --use-build` | fails | works, keeps no record |
| 19 | stage-upgrade with a logic hash in no blueprint | staged (with `--use-build`, fails after the tx file is written) | refused up front |
| 20 | stage-upgrade `--use-build`, hash already deployed | record entry overwritten from the build | record entry kept |
| 21 | mint-staging-state, profile collateral missing or too small | continues, Blaze picks collateral | fails |
| 22 | mint-staging-state, one-shot not at the deployer address | found anywhere | must be at the deployer address |
| 23 | run-cnight-mint-mainnet | needs the main and staging two-stage UTxOs | needs only main |
| 24 | register-gov-auth, register-cnight-mint-logic, credential already registered | builds the tx | refused; also needs `BLOCKFROST_<NET>_API_KEY` with `--provider kupmios` |
| 25 | merge-utxos with the same UTxO twice | builds | refused |
| 26 | simple-tx `--count` 0/negative/fraction, `--amount` hex or 0 | accepted (count 0 falls back to env) | refused |
| 27 | simple-tx `--to` script, reward or other-network address | accepted | key address on the network only |
| 28 | mint-tcnight `--burn --destination` | destination ignored | refused |
| 29 | mint-tcnight `--user-address`/`--destination` on another network, `--amount` hex | accepted | refused |
| 30 | mint-tcnight local script check | runs | not for a mint (the provider evaluates) |
| 31 | sign-and-submit `--sign-deployer false` | works | `--no-sign-deployer` only |
| 32 | sign-and-submit, single-tx file | prints `Confirmed: <txid>` | prints "Found 1 transactions…", `Submitted: <desc> - <txid>`, `Confirmed: <desc> - <txid>` |
| 33 | sign-and-submit, combine-signatures submit retry | on network-ish error text | on 429/5xx/transport; polls every 5 s up to 5 min |
| 34 | combine-signatures witness files | `--signatures <files…>` | positional files |
| 35 | combine-signatures with a bad witness | merged, fails at submit | refused before submit (checked against the tx id) |
| 36 | combine-signatures witness file as JSON `{name: cbor}` | works | refused (raw hex or a cardano-cli envelope) |
| 37 | combine-signatures `--tx` deployment file with one tx | refused | accepted |
| 38 | sign-and-submit, combine-signatures `-o/--output` | accepted, ignored | unknown option |

No outcome difference: change-council and change-terms beyond the shared
rows, migrate-federated-ops, promote-upgrade, register-gov-auth beyond the
shared rows, and the tx file format.

## Entry point, flags, env, config

| # | Case | main | Effect 4 |
|---|---|---|---|
| 39 | No arguments, `-h`, `<cmd> -h` | error, exit 1 | help, exit 0 |
| 40 | Global flags before the command (`-n preview info`) | work | unknown subcommand; flags go after the command |
| 41 | `-o`/`-p` on commands that do not use them | accepted, ignored | unknown argument |
| 42 | `--network Preview` (any case, any string) | accepted | the fixed lower-case list only |
| 43 | Root `--wizard`, `--completions`, `--log-level` | absent | present |
| 44 | `LOG_LEVEL` env | ignored | read; a bad value fails every command |
| 45 | `DEPLOY_UTXO_AMOUNT` / `--utxo-amount` | sets the synthetic one-shot value | gone |
| 46 | `*_THRESHOLD` env `3/3` | accepted | refused (numerator < denominator) |
| 47 | `TERMS_AND_CONDITIONS_INITIAL_HASH` not 64 hex | passed through | refused |
| 48 | `build`/`deploy` from another directory | fail (aiken.toml from cwd) | work on the repository root |
| 49 | aiken.toml profile missing `collateral_utxo` or `committee_*` | works | every command reading it fails (all 8 current profiles parse) |
| 50 | Blueprint missing `registeredCandidate`/`cnightGeneratesDust`, or one that throws | skipped | fails (no current blueprint hits it) |
| 51 | Provider calls | no timeout or retry | 30 s timeout; UTxO reads retried 3× on 429/5xx; Blockfrost 401/403 a config error |
| 52 | package.json `cli:*` and `clean` scripts, `just cli` | exist (`bun`) | the scripts are gone (`just check` also lints); `just cli` stays and runs `vpx cli/main.ts` (user, 11-11) |
| 53 | `create-witnesses.ts`, `extract-witnesses.ts` | exist | gone |

## Removed or renamed commands

| # | Case | main | Effect 4 |
|---|---|---|---|
| 54 | `deploy-cnight-minting` | writes `cnight-minting-deployment.json` | gone; `deploy --components cnight-minting` writes `deployment-transactions.json` |
| 55 | `build-from-deployed` | exists | gone; `build --from-deployed` |

## deploy, deploy-staging-track

| # | Case | main | Effect 4 |
|---|---|---|---|
| 56 | `deploy --name <tx>` | rebuilds one tx, merged into the existing file | no `--name`; `--components` writes only the selected txs |
| 57 | `deploy --components all` or empty | everything | refused; exact names only (adds `cnight-minting`) |
| 58 | One-shot UTxOs | synthetic, never looked up | must exist unspent at the deployer address |
| 59 | Collateral | only if the profile sets it | the profile collateral, always resolved and size-checked |
| 60 | deploy local script check | none | runs |
| 61 | Deployment file | has `config: {utxoAmount}` | `{network, timestamp, transactions}` |
| 62 | deploy on preprod/mainnet when the record already promotes a validator it would create | builds | refused before any chain call |
| 63 | **Full deploy on preview/qanet/govnet/devnet, deployed-scripts record** | keeps every entry, appends new titles | **replaces the record with the build** (a full deploy is a new environment) |
| 64 | `deploy --components`, any deploy on preprod/mainnet | whole-build merge | adds only what the run creates |
| 65 | Snapshot write fails | note printed, file written, exit 0 | command fails, no deployment file |
| 66 | Deploy with no build files | skips the snapshot | fails; local/emulator never snapshot |
| 67 | UpgradeState gov auth hashes in a deploy | always the build's | with `--components` or on preprod/mainnet, the record's promoted ones |
| 68 | deploy-staging-track `--name`, `--utxo-amount`, `--components all` | accepted | gone/refused |
| 69 | deploy-staging-track and the deployed-scripts record | never touched | extends it with the staging forevers; refused on preprod/mainnet if already promoted |

## build

| # | Case | main | Effect 4 |
|---|---|---|---|
| 70 | `build --from-deployed` vs `build-from-deployed` trace | `silent` by default | `verbose` |
| 71 | From-deployed mode | pins core hashes, compiles once | compiles in phases; `--components` compiles named validators fresh; fails `PinsMoved` if a pinned hash moves |
| 72 | From-deployed output | `plutus-<env>.json` only | also `contract_blueprint_<env>.ts`, copied to `contract_blueprint.ts` |
| 73 | Blueprint generator | `bunx …@0.9.1` (network) | the installed binary, offline; plain `build` output byte-identical |

## info, verify, dust-participants

| # | Case | main | Effect 4 |
|---|---|---|---|
| 74 | `info` table | hash cut to 16 chars, address to 40 | full hash; address `first16…last8` |
| 75 | `info` cNIGHT minting | not listed; `--component cnight-minting` refused | listed where the blueprint has it; accepted |
| 76 | `info --save`, `verify`, `dust-participants` data source | Blockfrost only | the selected provider |
| 77 | `info --save` `upgradeState` | `{logicHash, authHash}`, null on a bad datum | adds `mitigationLogicHash`, `logicRound`; a bad datum fails |
| 78 | `verify` | checks the original deployment txs in `deployments/<env>/` | checks the record (`plutus.json` + `versions.json`) against current unspent outputs; both write `release/<env>/verification-report.md` and exit 1 on failure |
| 79 | Data files | — | drops the never-deployed `beefy_signer_threshold.else` entry from the preview/qanet/govnet/devnet/preprod records |

No outcome difference: generate-key beyond the flag rows, plain `build`,
`info` JSON beyond cNIGHT, `--version`, the deploy default component set
and output path, signer parsing for valid input.
