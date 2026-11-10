/** Console output: the only place text reaches the user. */
import { Console, Context, Effect, Layer } from "effect";

export class Output extends Context.Service<
  Output,
  {
    /** A plain line. */
    readonly log: (line: string) => Effect.Effect<void>;
    /** A line with the error marker, on stderr. */
    readonly error: (message: string) => Effect.Effect<void>;
  }
>()("cli/Output") {
  /** Output through Console. */
  static readonly layer = Layer.succeed(this, {
    log: (line) => Console.log(line),
    error: (message) => Console.error(`❌ ${message}\n`),
  });
}
