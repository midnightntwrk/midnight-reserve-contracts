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

/**
 * Two-phase transaction completion:
 *   Phase 1 — Snapshot the draft tx via toCbor() (does NOT mutate the builder),
 *             parse it back, and run the local UPLC evaluator against it.
 *             Warns on failure (the WASM UPLC evaluator can give false negatives).
 *   Phase 2 — Call .complete() on the pristine builder via Blockfrost
 *             for authoritative fee calculation and balancing.
 */
export async function completeTx(
  txBuilder: TxBuilder,
  options: CompleteTxOptions,
): Promise<Transaction> {
  const { commandName, provider, networkId, knownUtxos } = options;

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
      // The WASM UPLC evaluator can disagree with the Cardano node
      // (e.g. different datum encoding handling). Warn but continue —
      // Blockfrost/Ogmios evaluation in Phase 2 is authoritative.
      const msg = String(testError);
      printWarning(`Local UPLC test failed (non-fatal): ${commandName}`);
      for (const line of msg.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        console.error(`  ${trimmed}`);
      }
    }
  }

  // Phase 2: Real complete via provider (Blockfrost) — authoritative
  try {
    const tx = await txBuilder.complete();
    printSuccess(`Transaction built: ${tx.getId()}`);
    return tx;
  } catch (error) {
    printError(`Transaction build failed: ${commandName}`);
    if (error instanceof Error) {
      console.error("  Error:", error.message);
      if ("cause" in error && error.cause) {
        console.error("  Cause:", JSON.stringify(error.cause, null, 2));
      }
    } else {
      console.error(error);
    }
    throw error;
  }
}
