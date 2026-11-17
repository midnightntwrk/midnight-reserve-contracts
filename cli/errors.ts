/**
 * Every failure the CLI can report, one tagged class each. A new string
 * reason is not a new class; anything outside this union is a defect.
 */
import { Data } from "effect";

/** An aiken.toml field or a .env value is missing or malformed. */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly source: "aiken.toml" | "env";
  readonly key: string;
  readonly reason: string;
}> {}

/** The blueprint for the environment could not be loaded, or lacks a validator. */
export class BlueprintError extends Data.TaggedError("BlueprintError")<{
  readonly environment: string;
  readonly source: "deployed" | "build";
  readonly reason: string;
}> {}

/** A build phase failed: aiken exited non-zero, the blueprint file is stale, or logic bytecode is stale. */
export class AikenBuildError extends Data.TaggedError("AikenBuildError")<{
  readonly phase: string;
  readonly reason: string;
}> {}

/** A `build --from-deployed` compiled pinned validators to other hashes than the deployed ones. */
export class PinsMoved extends Data.TaggedError("PinsMoved")<{
  readonly moved: readonly {
    readonly validator: string;
    readonly deployed: string;
    readonly built: string;
  }[];
}> {}

/** What a UTxO lookup searched for. */
type UtxoLookup =
  | { readonly by: "address"; readonly address: string }
  | { readonly by: "asset"; readonly address: string; readonly asset: string }
  | { readonly by: "ref"; readonly ref: string; readonly address?: string };

/** The lookup found no UTxO. */
export class UtxoNotFound extends Data.TaggedError("UtxoNotFound")<{
  readonly lookup: UtxoLookup;
}> {
  static at(address: string): UtxoNotFound {
    return new UtxoNotFound({ lookup: { by: "address", address } });
  }
  static holding(address: string, asset: string): UtxoNotFound {
    return new UtxoNotFound({ lookup: { by: "asset", address, asset } });
  }
  static byRef(ref: string, address?: string): UtxoNotFound {
    return new UtxoNotFound({ lookup: { by: "ref", ref, address } });
  }
}

/** Why the chain state or the record does not admit a command. */
export type Refusal =
  | {
      readonly _tag: "NightTooLow";
      readonly held: bigint;
      readonly required: bigint;
    }
  | { readonly _tag: "NoCnight"; readonly asset: string }
  | { readonly _tag: "MitigationActive"; readonly mitigationLogicHash: string }
  | {
      readonly _tag: "DatumNotMigrated";
      readonly datumRound: number;
      readonly logicRound: number;
    }
  | { readonly _tag: "LogicNotV2"; readonly logicHash: string }
  | { readonly _tag: "DatumAlreadyMigrated" }
  | {
      readonly _tag: "AlreadyRegistered";
      readonly environment: string;
      readonly scripts: readonly {
        readonly label: string;
        readonly scriptHash: string;
      }[];
    }
  | {
      readonly _tag: "CollateralTooSmall";
      readonly lovelace: bigint;
      readonly required: bigint;
      readonly collateralPercentage: number;
      readonly estimatedMaxFee: bigint;
    };

/** What a refusal says. */
const refusalText = (refusal: Refusal): string => {
  switch (refusal._tag) {
    case "NightTooLow":
      return `Insufficient TCnight tokens. Found: ${refusal.held}, Required: ${refusal.required}`;
    case "NoCnight":
      return `Neither UTxO contains CNIGHT asset ${refusal.asset}`;
    case "MitigationActive":
      return `Mitigation logic is active (hash: ${refusal.mitigationLogicHash}). merge-utxos does not support mitigation logic — the forever contract requires both logic and mitigation_logic withdrawals when mitigation is set.`;
    case "DatumNotMigrated":
      return (
        `datum has logic_round=${refusal.datumRound} but v2 logic is active (logicRound=${refusal.logicRound}). ` +
        `Run 'migrate-federated-ops' first to update the datum to the v2 format.`
      );
    case "LogicNotV2":
      return `Active logic is still v1 (${refusal.logicHash}). Migration requires v2 logic to be promoted. Run promote-upgrade first.`;
    case "DatumAlreadyMigrated":
      return "Federated ops datum already has 4+ elements (already FederatedOpsV2). Migration is not needed.";
    case "AlreadyRegistered":
      return `already registered on ${refusal.environment}: ${refusal.scripts
        .map(({ label, scriptHash }) => `${label} ${scriptHash}`)
        .join(", ")}`;
    case "CollateralTooSmall":
      return `Collateral UTxO has ${refusal.lovelace} lovelace but requires at least ${refusal.required} lovelace (collateralPercentage: ${refusal.collateralPercentage}%, estimated max fee: ${refusal.estimatedMaxFee} lovelace)`;
  }
};

/** The chain state or the record does not admit the command. */
export class PreconditionFailed extends Data.TaggedError("PreconditionFailed")<{
  readonly command: string;
  readonly refusal: Refusal;
}> {}

/** A UTxO's inline datum is missing or does not decode as `what`. */
export class DatumParseError extends Data.TaggedError("DatumParseError")<{
  readonly what: string;
  readonly cbor: string;
  readonly reason: string;
}> {}

/** verify found `failed` checks failing. */
export class VerificationFailed extends Data.TaggedError("VerificationFailed")<{
  readonly failed: number;
}> {}

/** compile could not complete a transaction: Blaze failed (`traces` name the validators), or the transaction with its vkey witnesses is over the protocol maximum (`size`). */
export class TxBuildError extends Data.TaggedError("TxBuildError")<{
  readonly command: string;
  readonly traces: readonly string[];
  readonly cause: unknown;
  readonly size?: {
    readonly bytes: number;
    readonly witnesses: number;
    readonly max: number;
  };
}> {}

/** A file the CLI writes (transaction, snapshot, report) could not be written. */
export class FileWriteError extends Data.TaggedError("FileWriteError")<{
  readonly path: string;
  readonly reason: string;
}> {}

/** An environment value with a structure (signers, candidates) failed to parse; one issue per line. */
export class InputParseError extends Data.TaggedError("InputParseError")<{
  readonly source: string;
  readonly issues: readonly string[];
}> {}

/** A chain provider call failed. `status` is the HTTP status when the provider answered; `retryable` is true for a transport failure, a timeout, 429 and 5xx. */
export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly op: string;
  readonly cause: unknown;
  readonly retryable: boolean;
  readonly status?: number;
  readonly reason?: "Transport" | "StatusCode" | "Decode" | "Timeout";
}> {}

/** A transaction was not submitted or not confirmed (the provider refused every attempt, a lookup kept failing, or the wait ran out), or a file's run had failed transactions. */
export class SubmitError extends Data.TaggedError("SubmitError")<{
  readonly txId?: string;
  readonly attempts?: number;
  readonly cause: unknown;
}> {}

/** --provider blockfrost on an environment that is not a Cardano network (local, the emulator). */
export class BlockfrostUnavailable extends Data.TaggedError(
  "BlockfrostUnavailable",
)<{
  readonly environment: string;
}> {}

/** Reward accounts a transaction withdraws from are not registered on chain. */
export class StakeNotRegistered extends Data.TaggedError("StakeNotRegistered")<{
  readonly environment: string;
  readonly accounts: readonly {
    readonly label: string;
    readonly rewardAccount: string;
    readonly scriptHash: string;
  }[];
}> {}

const CLI_ERRORS = [
  ConfigError,
  BlueprintError,
  AikenBuildError,
  FileWriteError,
  InputParseError,
  ProviderError,
  BlockfrostUnavailable,
  PinsMoved,
  TxBuildError,
  SubmitError,
  DatumParseError,
  VerificationFailed,
  UtxoNotFound,
  PreconditionFailed,
  StakeNotRegistered,
] as const;

/** Union of every expected CLI failure. */
export type CliError = InstanceType<(typeof CLI_ERRORS)[number]>;

/** Whether a failure is one of the CLI's own, which it reports; argument errors are effect/cli's, which it has printed. */
export const isCliError = (value: unknown): value is CliError =>
  CLI_ERRORS.some((error) => value instanceof error);

/** Render a CliError as the text the user sees. */
export function renderError(error: CliError): string {
  switch (error._tag) {
    case "ConfigError":
      return error.key
        ? `Invalid ${error.source} ${error.key}: ${error.reason}`
        : `Invalid ${error.source}: ${error.reason}`;
    case "BlueprintError":
      return `Blueprint (${error.source}, ${error.environment}): ${error.reason}`;
    case "AikenBuildError":
      return `Build failed (${error.phase}): ${error.reason}`;
    case "FileWriteError":
      return `Cannot write ${error.path}: ${error.reason}`;
    case "InputParseError":
      return [
        `Invalid ${error.source}:`,
        ...error.issues.map((issue) => `  ${issue}`),
      ].join("\n");
    case "ProviderError":
      return `Provider call '${error.op}' failed: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`;
    case "BlockfrostUnavailable":
      return `Blockfrost provider requires a real Cardano network (preview/preprod/mainnet). Environment '${error.environment}' maps to local/emulator. Use --provider emulator or --provider kupmios instead.`;
    case "PinsMoved":
      return `Build failed (pins): the build changes the deployed ${error.moved.map((m) => m.validator).join(", ")}: they depend on a component compiled from new, or aiken.toml does not describe the deployment; add the components that create them to --components, or build without the new ones`;
    case "TxBuildError":
      return [
        error.size
          ? `${error.command}: the transaction is ${error.size.bytes} bytes with its ${error.size.witnesses} signatures, over the protocol maximum of ${error.size.max}`
          : `${error.command}: transaction build failed: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`,
        ...error.traces.map((trace) => `  ${trace}`),
      ].join("\n");
    case "UtxoNotFound":
      return error.lookup.by === "address"
        ? `No UTxO at ${error.lookup.address}`
        : error.lookup.by === "asset"
          ? `No UTxO holding ${error.lookup.asset} at ${error.lookup.address}`
          : `UTxO ${error.lookup.ref} not found${error.lookup.address ? ` at ${error.lookup.address}` : ""}`;
    case "PreconditionFailed":
      return `${error.command}: ${refusalText(error.refusal)}`;
    case "DatumParseError":
      return `Cannot parse ${error.what} datum: ${error.reason}`;
    case "VerificationFailed":
      return `VERIFICATION FAILED: ${error.failed} check(s) failed.`;
    case "SubmitError":
      return `Submission failed${error.attempts ? ` after ${error.attempts} attempt(s)` : ""}${error.txId ? ` (${error.txId})` : ""}: ${isCliError(error.cause) ? renderError(error.cause) : error.cause instanceof Error ? error.cause.message : String(error.cause)}`;
    case "StakeNotRegistered":
      return [
        "The following reward accounts are not registered on-chain:",
        ...error.accounts.map(
          (a) => `  - ${a.label}: ${a.scriptHash} (${a.rewardAccount})`,
        ),
        "",
        "Register them first with:",
        `  just cli register-gov-auth -n ${error.environment}`,
        "Or for v2 logic scripts, register the stake credential manually.",
      ].join("\n");
  }
}
