import {
  Transaction,
  TransactionUnspentOutput,
  CredentialType,
  AssetId,
  RewardAccount,
} from "@blaze-cardano/core";
import { enumerateContracts } from "./blueprint-diff";
import { loadContractModule } from "./contracts";
import { getConfigSection } from "./types";

export interface RedeemerMapping {
  [indexRef: string]: string;
}

/**
 * Builds a mapping from redeemer index references (e.g., "spend[0]", "withdraw[1]")
 * to human-readable validator names by analyzing the draft transaction.
 * Non-fatal: returns empty mapping on any failure.
 */
export function buildRedeemerMapping(
  draftCbor: string,
  knownUtxos: TransactionUnspentOutput[],
  environment?: string,
): RedeemerMapping {
  const mapping: RedeemerMapping = {};

  // Load blueprint module for name resolution
  let module: Record<string, unknown>;
  const configSection = environment ? getConfigSection(environment) : "default";
  try {
    module = loadContractModule(configSection, false);
  } catch {
    try {
      module = loadContractModule(configSection, true);
    } catch {
      return mapping;
    }
  }

  // Enumerate all contracts once and build hash→name lookup
  const contracts = enumerateContracts(module);
  const hashToName = new Map<string, string>();
  for (const c of contracts) {
    hashToName.set(c.hash, c.className);
  }

  const tx = Transaction.fromCbor(draftCbor);
  const body = tx.body();

  // Build UTxO lookup: "txHash#index" → TransactionUnspentOutput
  const utxoMap = new Map<string, TransactionUnspentOutput>();
  for (const utxo of knownUtxos) {
    const key = `${utxo.input().transactionId()}#${utxo.input().index()}`;
    utxoMap.set(key, utxo);
  }

  // --- Spends: sorted by txId+index.toString() (matches Blaze insertSorted) ---
  const inputs = [...body.inputs().values()].sort((a, b) => {
    const aKey = a.transactionId() + a.index().toString();
    const bKey = b.transactionId() + b.index().toString();
    return aKey.localeCompare(bKey);
  });

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const key = `${input.transactionId()}#${input.index()}`;
    const utxo = utxoMap.get(key);
    if (!utxo) continue;

    try {
      const addr = utxo.output().address();
      const props = addr.getProps();
      if (
        props.paymentPart &&
        props.paymentPart.type === CredentialType.ScriptHash
      ) {
        const name = hashToName.get(props.paymentPart.hash);
        if (name) {
          mapping[`spend[${i}]`] = name;
        }
      }
    } catch {
      // Skip unresolvable inputs
    }
  }

  // --- Mints: sorted by policy ID ---
  const mint = body.mint();
  if (mint) {
    const policyIds = new Set<string>();
    for (const assetId of mint.keys()) {
      policyIds.add(AssetId.getPolicyId(assetId));
    }
    const sortedPolicies = [...policyIds].sort();
    for (let i = 0; i < sortedPolicies.length; i++) {
      const name = hashToName.get(sortedPolicies[i]);
      if (name) {
        mapping[`mint[${i}]`] = name;
      }
    }
  }

  // --- Withdrawals: sorted by credential hash (matches Blaze insertSorted) ---
  const withdrawals = body.withdrawals();
  if (withdrawals) {
    const entries: { hash: string; account: string }[] = [];
    for (const account of withdrawals.keys()) {
      try {
        entries.push({ hash: RewardAccount.toHash(account), account });
      } catch {
        // Skip undecodable accounts
      }
    }
    entries.sort((a, b) => a.hash.localeCompare(b.hash));
    for (let i = 0; i < entries.length; i++) {
      const name = hashToName.get(entries[i].hash);
      if (name) {
        mapping[`withdraw[${i}]`] = name;
      }
    }
  }

  return mapping;
}

/**
 * Enriches an error message by replacing redeemer index references
 * like "spend[0]" with "spend[0] (ValidatorClassName)".
 */
export function enrichErrorMessage(
  message: string,
  mapping: RedeemerMapping,
): string {
  return message.replace(/(spend|mint|withdraw|reward)\[\d+\]/gi, (match) => {
    const name = mapping[match.toLowerCase()];
    return name ? `${match} (${name})` : match;
  });
}
