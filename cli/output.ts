/**
 * Console and file output. OutputLive is the Output service for the CLI;
 * the formatters are pure and return lines for it. The transaction file
 * itself is chain/tx-file.ts.
 */
import { dirname } from "path";
import { FileSystem } from "@effect/platform";
import { Console, Context, Effect, Layer } from "effect";
import type { TransactionFile } from "./chain/tx-file";
import { FileWriteError } from "./errors";

/** Console and file output; the only place text reaches the user. */
export class Output extends Context.Tag("cli/Output")<
  Output,
  {
    /** A plain line. */
    readonly log: (line: string) => Effect.Effect<void>;
    /** A plain line on stderr. */
    readonly stderr: (line: string) => Effect.Effect<void>;
    /** A line with the success marker. */
    readonly success: (message: string) => Effect.Effect<void>;
    /** A line with the error marker, on stderr. */
    readonly error: (message: string) => Effect.Effect<void>;
    /** A line with the info marker. */
    readonly info: (message: string) => Effect.Effect<void>;
    /** A line with the progress marker. */
    readonly progress: (message: string) => Effect.Effect<void>;
    /** Write pretty-printed JSON, creating the directory. */
    readonly writeJson: (
      path: string,
      data: unknown,
    ) => Effect.Effect<void, FileWriteError>;
    /** Write a text file, creating the directory. */
    readonly writeText: (
      path: string,
      text: string,
    ) => Effect.Effect<void, FileWriteError>;
  }
>() {}

export function formatLovelaceToAda(lovelace: bigint): string {
  const ADA_DECIMALS = 1_000_000n;
  const whole = lovelace / ADA_DECIMALS;
  const fractional = lovelace % ADA_DECIMALS;

  return `${whole}.${fractional.toString().padStart(6, "0")}`;
}

/** A text table: separator, header, separator, rows, separator. */
export const formatTable = (headers: string[], rows: string[][]): string[] => {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );

  const separator = widths.map((w) => "-".repeat(w + 2)).join("+");
  const formatRow = (row: string[]) =>
    row.map((cell, i) => ` ${cell.padEnd(widths[i])} `).join("|");

  return [
    separator,
    formatRow(headers),
    separator,
    ...rows.map(formatRow),
    separator,
  ];
};

/** The numbered summary of the transactions in a deployment file. */
export const transactionSummaryLines = (
  transactions: TransactionFile[],
): string[] => [
  "\nTransaction Summary:",
  ...transactions.flatMap((tx, index) => [
    `${index + 1}. ${tx.description}`,
    `   Hash: ${tx.txHash}`,
    "",
  ]),
];

/** Write a text file through FileSystem, creating its directory. */
const writeText = (
  fs: FileSystem.FileSystem,
  path: string,
  text: string,
): Effect.Effect<void, FileWriteError> =>
  Effect.mapError(
    Effect.zipRight(
      fs.makeDirectory(dirname(path), { recursive: true }),
      fs.writeFileString(path, text),
    ),
    (cause) => new FileWriteError({ path, reason: cause.message }),
  );

/** Output through Console and the filesystem. */
export const OutputLive: Layer.Layer<Output, never, FileSystem.FileSystem> =
  Layer.effect(
    Output,
    Effect.map(FileSystem.FileSystem, (fs) => ({
      log: (line) => Console.log(line),
      stderr: (line) => Console.error(line),
      success: (message) => Console.log(`✅ ${message}\n`),
      error: (message) => Console.error(`❌ ${message}\n`),
      info: (message) => Console.log(`ℹ️  ${message}`),
      progress: (message) => Console.log(`⏳ ${message}`),
      writeJson: (path, data) =>
        writeText(fs, path, JSON.stringify(data, null, 2)),
      writeText: (path, text) => writeText(fs, path, text),
    })),
  );
