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
  }
}
