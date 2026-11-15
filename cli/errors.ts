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
    case "DatumParseError":
      return `Cannot parse ${error.what} datum: ${error.reason}`;
    case "VerificationFailed":
      return `VERIFICATION FAILED: ${error.failed} check(s) failed.`;
    case "SubmitError":
      return `Submission failed${error.attempts ? ` after ${error.attempts} attempt(s)` : ""}${error.txId ? ` (${error.txId})` : ""}: ${isCliError(error.cause) ? renderError(error.cause) : error.cause instanceof Error ? error.cause.message : String(error.cause)}`;
  }
}
