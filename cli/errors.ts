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

/** A chain provider call failed; `status` is the HTTP status when the provider answered, `reason` the HTTP client's classification. */
export class ProviderError extends Data.TaggedError("ProviderError")<{
  readonly op: string;
  readonly cause: unknown;
  readonly retryable: boolean;
  readonly status?: number;
  readonly reason?:
    | "Transport"
    | "Encode"
    | "InvalidUrl"
    | "StatusCode"
    | "Decode"
    | "EmptyBody"
    | "Timeout";
}> {}

/** How a UTxO was looked up: any at an address, one holding an asset there, or one by reference (optionally at an address). */
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

/** Inline datum bytes did not decode to the expected shape. */
export class DatumParseError extends Data.TaggedError("DatumParseError")<{
  readonly what: string;
  readonly cbor: string;
  readonly reason: string;
}> {}

/** Transaction building or evaluation failed, or the built transaction is larger than the protocol allows. */
export class TxBuildError extends Data.TaggedError("TxBuildError")<{
  readonly command: string;
  readonly traces: readonly string[];
  readonly cause: unknown;
  /** The transaction's size at submit with its vkey witnesses, and the protocol maximum, when it is too large. */
  readonly size?: {
    readonly bytes: number;
    readonly witnesses: number;
    readonly max: number;
  };
}> {}

/** Submission failed after the retry budget. */
export class SubmitError extends Data.TaggedError("SubmitError")<{
  readonly txId?: string;
  readonly attempts?: number;
  readonly cause: unknown;
}> {}

/** A user-supplied file or argument did not parse. */
export class InputParseError extends Data.TaggedError("InputParseError")<{
  readonly source: string;
  readonly issues: readonly string[];
}> {}

/** --provider blockfrost on an environment that is not a Cardano network (local, the emulator). */
export class BlockfrostUnavailable extends Data.TaggedError(
  "BlockfrostUnavailable",
)<{
  readonly environment: string;
}> {}

/** Reward accounts a governance transaction withdraws from are not registered on chain. */
export class StakeNotRegistered extends Data.TaggedError("StakeNotRegistered")<{
  readonly environment: string;
  readonly accounts: readonly {
    readonly label: string;
    readonly rewardAccount: string;
    readonly scriptHash: string;
  }[];
}> {}

/** A validator whose deployed hash the build does not reproduce. */
export interface MovedHash {
  readonly validator: string;
  readonly deployed: string;
  readonly built: string;
}

/** A from-deployed build compiled pinned validators to other hashes. */
export class PinsMoved extends Data.TaggedError("PinsMoved")<{
  readonly moved: readonly MovedHash[];
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

/** Why the chain state or the record does not admit a command, with its data. */
export type Refusal =
  | {
      readonly _tag: "Promoted";
      readonly environment: string;
      readonly validators: readonly string[];
    }
  | {
      readonly _tag: "CollateralTooSmall";
      readonly lovelace: bigint;
      readonly required: bigint;
      readonly collateralPercentage: number;
      readonly estimatedMaxFee: bigint;
    }
  | {
      readonly _tag: "NightTooLow";
      readonly held: bigint;
      readonly required: bigint;
    }
  | {
      readonly _tag: "DatumNotMigrated";
      readonly datumRound: number;
      readonly logicRound: number;
    }
  | { readonly _tag: "LogicNotV2"; readonly logicHash: string }
  | {
      readonly _tag: "PromotedLogicMoved";
      readonly name: string;
      readonly logicHash: string;
      readonly environment: string;
      readonly profile: string;
    }
  | {
      readonly _tag: "LogicNotFound";
      readonly logicHash: string;
      readonly environment: string;
      readonly profile: string;
      readonly buildPath: string;
    }
  | { readonly _tag: "DatumAlreadyMigrated" }
  | { readonly _tag: "NoCnight"; readonly asset: string }
  | { readonly _tag: "MitigationActive"; readonly mitigationLogicHash: string }
  | {
      readonly _tag: "AlreadyRegistered";
      readonly environment: string;
      readonly scripts: readonly {
        readonly label: string;
        readonly scriptHash: string;
      }[];
    };

/** The chain state or the record does not admit the command. */
export class PreconditionFailed extends Data.TaggedError("PreconditionFailed")<{
  readonly command: string;
  readonly refusal: Refusal;
}> {}

/** `verify` found failing checks; the report has already been written. */
export class VerificationFailed extends Data.TaggedError("VerificationFailed")<{
  readonly failed: number;
}> {}

const CLI_ERRORS = [
  ConfigError,
  BlueprintError,
  ProviderError,
  BlockfrostUnavailable,
  UtxoNotFound,
  DatumParseError,
  TxBuildError,
  SubmitError,
  InputParseError,
  StakeNotRegistered,
  AikenBuildError,
  PinsMoved,
  PreconditionFailed,
  VerificationFailed,
  FileWriteError,
] as const;

/** Union of every expected CLI failure. */
export type CliError = InstanceType<(typeof CLI_ERRORS)[number]>;

const isCliError = (value: unknown): value is CliError =>
  CLI_ERRORS.some((error) => value instanceof error);

const hasMessage = (value: unknown): value is { message: string } =>
  typeof value === "object" &&
  value !== null &&
  "message" in value &&
  typeof value.message === "string";

/** One line for an unknown cause: a CliError renders, anything with a string message (an Error, a WebSocket ErrorEvent) gives it, anything else its string. */
export const describeCause = (cause: unknown): string =>
  isCliError(cause)
    ? renderError(cause)
    : hasMessage(cause)
      ? cause.message
      : String(cause);

const renderLookup = (lookup: UtxoLookup): string => {
  switch (lookup.by) {
    case "address":
      return `No UTxO at ${lookup.address}`;
    case "asset":
      return `No UTxO holding ${lookup.asset} at ${lookup.address}`;
    case "ref":
      return `UTxO ${lookup.ref} not found${lookup.address ? ` at ${lookup.address}` : ""}`;
  }
};

const movedNames = (moved: readonly MovedHash[]): string =>
  moved.map((m) => m.validator).join(", ");

const renderRefusal = (refusal: Refusal): string => {
  switch (refusal._tag) {
    case "Promoted":
      return `${refusal.environment} has already promoted ${refusal.validators.join(", ")}; promoted validators are permanent`;
    case "CollateralTooSmall":
      return `Collateral UTxO has ${refusal.lovelace} lovelace but requires at least ${refusal.required} lovelace (collateralPercentage: ${refusal.collateralPercentage}%, estimated max fee: ${refusal.estimatedMaxFee} lovelace)`;
    case "NightTooLow":
      return `Insufficient TCnight tokens. Found: ${refusal.held}, Required: ${refusal.required}`;
    case "DatumNotMigrated":
      return (
        `datum has logic_round=${refusal.datumRound} but v2 logic is active (logicRound=${refusal.logicRound}). ` +
        `Run 'migrate-federated-ops' first to update the datum to the v2 format.`
      );
    case "LogicNotV2":
      return `Active logic is still v1 (${refusal.logicHash}). Migration requires v2 logic to be promoted. Run promote-upgrade first.`;
    case "PromotedLogicMoved":
      return `${refusal.name} is promoted in deployed-scripts/${refusal.environment} under another hash, and the ${refusal.profile} build has it as ${refusal.logicHash}; a promoted validator keeps its hash: stage its recorded hash, or a logic whose name is not promoted`;
    case "LogicNotFound":
      return `logic ${refusal.logicHash} is not in deployed-scripts/${refusal.environment} or in the ${refusal.profile} build (${refusal.buildPath}); check the hash, or build first: just build ${refusal.profile}`;
    case "DatumAlreadyMigrated":
      return "Federated ops datum already has 4+ elements (already FederatedOpsV2). Migration is not needed.";
    case "NoCnight":
      return `Neither UTxO contains CNIGHT asset ${refusal.asset}`;
    case "MitigationActive":
      return (
        `Mitigation logic is active (hash: ${refusal.mitigationLogicHash}). ` +
        `merge-utxos does not support mitigation logic — the forever contract ` +
        `requires both logic and mitigation_logic withdrawals when mitigation is set.`
      );
    case "AlreadyRegistered":
      return `already registered on ${refusal.environment}: ${refusal.scripts
        .map(({ label, scriptHash }) => `${label} ${scriptHash}`)
        .join(", ")}`;
  }
};

/** Render a CliError as the one line the user sees. */
export function renderError(error: CliError): string {
  switch (error._tag) {
    case "ConfigError":
      return error.key
        ? `Invalid ${error.source} ${error.key}: ${error.reason}`
        : `Invalid ${error.source}: ${error.reason}`;
    case "BlueprintError":
      return `Blueprint (${error.source}, ${error.environment}): ${error.reason}`;
    case "ProviderError":
      return `Provider call '${error.op}' failed: ${describeCause(error.cause)}`;
    case "BlockfrostUnavailable":
      return (
        `Blockfrost provider requires a real Cardano network (preview/preprod/mainnet). ` +
        `Environment '${error.environment}' maps to local/emulator. ` +
        `Use --provider emulator or --provider kupmios instead.`
      );
    case "UtxoNotFound":
      return renderLookup(error.lookup);
    case "DatumParseError":
      return `Cannot parse ${error.what} datum: ${error.reason}`;
    case "TxBuildError":
      return [
        error.size
          ? `${error.command}: the transaction is ${error.size.bytes} bytes with its ${error.size.witnesses} signatures, over the protocol maximum of ${error.size.max}`
          : `${error.command}: transaction build failed: ${describeCause(error.cause)}`,
        ...error.traces.map((trace) => `  ${trace}`),
      ].join("\n");
    case "SubmitError":
      return `Submission failed${error.attempts ? ` after ${error.attempts} attempt(s)` : ""}${error.txId ? ` (${error.txId})` : ""}: ${describeCause(error.cause)}`;
    case "InputParseError":
      return [
        `Invalid ${error.source}:`,
        ...error.issues.map((i) => `  ${i}`),
      ].join("\n");
    case "StakeNotRegistered":
      return [
        "The following reward accounts are not registered on-chain:",
        ...error.accounts.map(
          (a) => `  - ${a.label}: ${a.scriptHash} (${a.rewardAccount})`,
        ),
        "",
        "Register them first with:",
        `  bun cli/index.ts register-gov-auth -n ${error.environment}`,
        "Or for v2 logic scripts, register the stake credential manually.",
      ].join("\n");
    case "AikenBuildError":
      return `Build failed (${error.phase}): ${error.reason}`;
    case "PinsMoved":
      return `Build failed (pins): the build changes the deployed ${movedNames(error.moved)}: they depend on a component compiled from new, or aiken.toml does not describe the deployment; add the components that create them to --components, or build without the new ones`;
    case "PreconditionFailed":
      return `${error.command}: ${renderRefusal(error.refusal)}`;
    case "VerificationFailed":
      return `VERIFICATION FAILED: ${error.failed} check(s) failed.`;
    case "FileWriteError":
      return `Cannot write ${error.path}: ${error.reason}`;
  }
}
