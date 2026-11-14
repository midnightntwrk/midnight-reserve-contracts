import { Effect, Layer } from "effect";
import { Output } from "../../cli/output";

/** An Output that keeps each message it is given, in order, without markers. */
export const captureOutput = () => {
  const lines: string[] = [];
  const keep = (line: string) => Effect.sync(() => void lines.push(line));
  return {
    lines,
    layer: Layer.succeed(Output)({
      log: keep,
      error: keep,
      success: keep,
      info: keep,
      progress: keep,
    }),
  };
};
