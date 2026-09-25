import { describe, expect, test } from "bun:test";
import {
  describeCause,
  ProviderError,
  renderError,
  SubmitError,
} from "../cli/errors";

describe("describeCause", () => {
  test("a tagged cause renders through renderError, not its empty message", () => {
    const inner = new ProviderError({
      op: "postTransactionToChain",
      cause: new Error("socket hang up"),
      retryable: true,
    });
    expect(describeCause(inner)).toBe(
      "Provider call 'postTransactionToChain' failed: socket hang up",
    );
    expect(
      renderError(new SubmitError({ txId: "abc", attempts: 3, cause: inner })),
    ).toBe(
      "Submission failed after 3 attempt(s) (abc): Provider call 'postTransactionToChain' failed: socket hang up",
    );
  });

  test("a WebSocket ErrorEvent gives its message, not [object ErrorEvent]", () => {
    const event = new ErrorEvent("error", {
      message: "WebSocket connection to 'ws://127.0.0.1:9/' failed",
    });
    expect(
      renderError(
        new ProviderError({ op: "Ogmios.new", cause: event, retryable: false }),
      ),
    ).toBe(
      "Provider call 'Ogmios.new' failed: WebSocket connection to 'ws://127.0.0.1:9/' failed",
    );
  });
});
