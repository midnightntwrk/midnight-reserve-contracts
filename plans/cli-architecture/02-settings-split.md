# Phase 02 — Settings split

`Settings` (`cli/config/settings.ts`) is one service with five kinds of
value. Each kind gets its own service or function so a module can only
reach what it uses. `Settings` is deleted at the end; no compatibility tag.

| Today on `Settings` | Becomes | Read by |
|---|---|---|
| `blockfrostApiKey`, `kupmios` | `ProviderConfig` (`config/provider-config.ts`) | `chain/provider.ts`, `chain/blockfrost.ts`, `chain/registration.ts` |
| `privateKeys`, `signingKey` | `Keys` (`config/keys.ts`) | `signing/**` |
| `profile`, `reservedRefs` | `Profile` (`config/profile.ts`) | resolve steps, `chain/provider.ts` (`GuardedWallet`) |
| `deployerAddress` | `DeployerAddress` (`config/deployer.ts`) | resolve steps, `chain/utxo.ts` (`deployerUtxo`), `chain/provider.ts` |
| `newSigners`, `permissionedCandidates`, `initialTermsAndConditions` | plain `Effect`s over `ConfigProvider` (`config/intent-env.ts`), not a service | the commands that install them: deploy, change-council/tech-auth, change-federated-ops |

`logLevel`, `envFallback`, `parseNetworkConfig`, `parseLogLevel` stay as
they are (already free functions).

## Tasks

1. Add the four tags and their live layers, built from the same `Config`
   reads `SettingsLive` does today (same variable names, same
   `ConfigError`s). `run.ts` provides them where it provides
   `SettingsLive`.
2. Move every `yield* Settings` site to the narrow service. Order:
   `chain/` and `signing/` first, then `deploy/`, `governance/`,
   `wallet/`, `report/`.
3. `tests/helpers/effect.ts` (`EmulatorLive`) provides the four layers;
   `tests/config.test.ts` cases move to the module that now owns each read.
4. Delete `Settings` and `SettingsLive`.

One commit per task; task 2 may be one commit per folder.

## Acceptance

- `grep -rn "Settings" cli` finds no service tag named `Settings`.
- `config/keys.ts` is imported only from `cli/signing/**` and `run.ts`
  (layer wiring).
- Every `ConfigError` text an operator sees is unchanged (the config
  tests assert them).

## Deviations

- `config/env.ts` holds the shared env readers (required/optional values
  and secrets, `envError`) the four services and `intent-env` build on,
  plus `envFallback`, `parseLogLevel` and `logLevel`, which lived in
  `settings.ts`. `ConfigLive(environment)` (the four layers) is exported
  from `run.ts`; the test helpers `ConfigOver` / `ConfigWith` wrap it.
- Task 1 kept `SettingsLive` as a facade over the four services, so
  task 2 could move callers without a broken build in between.
- `tests/config.test.ts` stays one file; each case reads through the
  service that owns its variable.
- Review follow-up: `DeployerAddress.address` and `Profile.config` are
  static accessors on the tags (`yield* Profile.config`), replacing
  `Effect.flatMap(Tag, (s) => s.field)` at every call site.
