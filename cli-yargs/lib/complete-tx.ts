import {
  Transaction,
  TransactionUnspentOutput,
  NetworkId,
  SLOT_CONFIG_NETWORK,
} from "@blaze-cardano/core";
import type { Provider, TxBuilder } from "@blaze-cardano/sdk";
import { makeUplcEvaluator } from "@blaze-cardano/vm";
import { printError, printSuccess, printWarning } from "./output";
import { getCardanoNetwork } from "./network-mapping";
import { buildRedeemerMapping, enrichErrorMessage } from "./redeemer-mapping";
import type { RedeemerMapping } from "./redeemer-mapping";

export class TransactionBuildError extends Error {
  readonly traces: string[];
  constructor(commandName: string, traces: string[], cause?: unknown) {
    super(`Transaction failed: ${commandName}`);
    this.name = "TransactionBuildError";
    this.traces = traces;
    this.cause = cause;
  }
}

export interface CompleteTxOptions {
  commandName: string;
  provider: Provider;
  networkId: NetworkId;
  environment?: string;
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
  const { commandName, provider, environment, knownUtxos } = options;
  let traces: string[] = [];
  let redeemerMap: RedeemerMapping = {};

  // Phase 1: Local UPLC test against draft (non-mutating, advisory)
  if (knownUtxos && knownUtxos.length > 0) {
    try {
      console.log("  Testing transaction locally (UPLC)...");
      const params = await provider.getParameters();
      const cardanoNetwork = environment
        ? getCardanoNetwork(environment)
        : null;
      const slotConfig =
        cardanoNetwork === "mainnet"
          ? SLOT_CONFIG_NETWORK.Mainnet
          : cardanoNetwork === "preprod"
            ? SLOT_CONFIG_NETWORK.Preprod
            : SLOT_CONFIG_NETWORK.Preview;

      const draftCbor = txBuilder.toCbor();

      try {
        redeemerMap = buildRedeemerMapping(draftCbor, knownUtxos, environment);
      } catch {
        // Non-fatal: mapping is best-effort
      }

      const draftTx = Transaction.fromCbor(draftCbor);
      const evaluator = makeUplcEvaluator(params, 1.2, 1.2, slotConfig);
      await evaluator(draftTx, knownUtxos);
      printSuccess("Local UPLC test passed");
    } catch (testError) {
      const rawMsg = String(testError);
      traces = extractTraces(rawMsg);
      const msg = enrichErrorMessage(rawMsg, redeemerMap);

      printWarning(`Local UPLC test failed (non-fatal): ${commandName}`);
      if (Object.keys(redeemerMap).length > 0) {
        console.error("\n  Redeemer → Validator mapping:");
        for (const [ref, name] of Object.entries(redeemerMap)) {
          console.error(`    ${ref} → ${name}`);
        }
      }
      console.error(`  ${msg}`);
      if (traces.length > 0) {
        printError("UPLC traces:");
        for (const trace of traces) {
          console.error(`  ${enrichErrorMessage(trace, redeemerMap)}`);
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
    const rawMsg = String(error);
    const phase2Traces = extractTraces(rawMsg);
    if (phase2Traces.length > 0) {
      traces = [...traces, ...phase2Traces];
    }

    printError(`Transaction build failed: ${commandName}`);
    if (Object.keys(redeemerMap).length > 0) {
      console.error("\n  Redeemer → Validator mapping:");
      for (const [ref, name] of Object.entries(redeemerMap)) {
        console.error(`    ${ref} → ${name}`);
      }
    }
    if (error instanceof Error) {
      console.error("  Error:", enrichErrorMessage(error.message, redeemerMap));
      if ("cause" in error && error.cause) {
        try {
          console.error(
            "  Cause:",
            enrichErrorMessage(
              JSON.stringify(
                error.cause,
                (_k, v) => (typeof v === "bigint" ? v.toString() : v),
                2,
              ),
              redeemerMap,
            ),
          );
        } catch {
          console.error(
            "  Cause:",
            enrichErrorMessage(String(error.cause), redeemerMap),
          );
        }
      }
    } else {
      console.error(error);
    }

    if (traces.length > 0) {
      printError("UPLC traces:");
      for (const trace of traces) {
        console.error(`  ${enrichErrorMessage(trace, redeemerMap)}`);
      }
    }

    throw new TransactionBuildError(commandName, traces, error);
  }
}
