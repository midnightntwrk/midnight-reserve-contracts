import {
  Transaction,
  TransactionUnspentOutput,
  NetworkId,
  SLOT_CONFIG_NETWORK,
} from "@blaze-cardano/core";
import type { Provider, TxBuilder } from "@blaze-cardano/sdk";
import { makeUplcEvaluator } from "@blaze-cardano/vm";
import { printError, printSuccess, printWarning } from "./output";

export interface CompleteTxOptions {
  commandName: string;
  provider: Provider;
  networkId: NetworkId;
  knownUtxos?: TransactionUnspentOutput[];
}

export interface CompleteTxResult {
  tx: Transaction;
  traces: string[];
}

/** Extract UPLC trace lines from an error message string. */
function extractTraces(errorMsg: string): string[] {
  const traces: string[] = [];
  for (const line of errorMsg.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith("Trace") ||
      trimmed.includes("Validator returned false") ||
      trimmed.includes("crashed / exited prematurely") ||
      trimmed.includes("failed script execution") ||
      trimmed.includes("EvaluationFailure") ||
      trimmed.includes("ScriptFailure")
    ) {
      traces.push(trimmed);
    }
  }
  return traces;
}

/**
 * Two-phase transaction completion:
 *   Phase 1 — Snapshot the draft tx via toCbor() (does NOT mutate the builder),
 *             parse it back, and run the local UPLC evaluator against it.
 *             Warns on failure (the WASM UPLC evaluator can give false negatives).
 *   Phase 2 — Call .complete() on the pristine builder via Blockfrost
 *             for authoritative fee calculation and balancing.
 *
 * Returns the built transaction and any UPLC traces from Phase 1.
 */
export async function completeTx(
  txBuilder: TxBuilder,
  options: CompleteTxOptions,
): Promise<CompleteTxResult> {
  const { commandName, provider, networkId, knownUtxos } = options;
  let traces: string[] = [];

  // Phase 1: Local UPLC test against draft (non-mutating, advisory)
  if (knownUtxos && knownUtxos.length > 0) {
    try {
      console.log("  Testing transaction locally (UPLC)...");
      const params = await provider.getParameters();
      const slotConfig =
        networkId === NetworkId.Mainnet
          ? SLOT_CONFIG_NETWORK.Mainnet
          : SLOT_CONFIG_NETWORK.Preprod;

      const draftCbor = txBuilder.toCbor();
      const draftTx = Transaction.fromCbor(draftCbor);
      const evaluator = makeUplcEvaluator(params, 1.2, 1.2, slotConfig);
      await evaluator(draftTx, knownUtxos);
      printSuccess("Local UPLC test passed");
    } catch (testError) {
      const msg = String(testError);
      traces = extractTraces(msg);

      printWarning(`Local UPLC test failed (non-fatal): ${commandName}`);
      console.error(`  ${msg}`);
      if (traces.length > 0) {
        printError("UPLC traces:");
        for (const trace of traces) {
          console.error(`  ${trace}`);
        }
      }
    }
  }

  // Phase 2: Real complete via provider (Blockfrost) — authoritative
  try {
    const tx = await txBuilder.complete();
    printSuccess(`Transaction built: ${tx.getId()}`);
    return { tx, traces };
  } catch (error) {
    const msg = String(error);
    const phase2Traces = extractTraces(msg);
    if (phase2Traces.length > 0) {
      traces = [...traces, ...phase2Traces];
    }

    printError(`Transaction build failed: ${commandName}`);
    if (error instanceof Error) {
      console.error("  Error:", error.message);
      if ("cause" in error && error.cause) {
        try {
          console.error("  Cause:", JSON.stringify(error.cause, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
        } catch { console.error("  Cause:", String(error.cause)); }
      }
    } else {
      console.error(error);
    }

    if (traces.length > 0) {
      printError("UPLC traces:");
      for (const trace of traces) {
        console.error(`  ${trace}`);
      }
    }

    const txError = new Error(`Transaction failed: ${commandName}`);
    (txError as any).traces = traces;
    (txError as any).cause = error;
    throw txError;
  }
}
