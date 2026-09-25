import {
  type Transaction,
  type TransactionUnspentOutput,
  CredentialType,
  AssetId,
  RewardAccount,
} from "@blaze-cardano/core";
import { refOf } from "./transaction";

export interface ValidatorLabels {
  [indexRef: string]: string;
}

/** Map redeemer index references ("spend[0]", "withdraw[1]") of a draft transaction to the class names of the blueprint contracts. */
export function validatorLabels(
  tx: Transaction,
  knownUtxos: readonly TransactionUnspentOutput[],
  contracts: readonly { readonly className: string; readonly hash: string }[],
): ValidatorLabels {
  const labels: ValidatorLabels = {};
  const hashToName = new Map(contracts.map((c) => [c.hash, c.className]));

  const body = tx.body();

  const utxoMap = new Map(
    knownUtxos.map((utxo) => [refOf(utxo.input()), utxo]),
  );

  // matches Blaze insertSorted
  const inputs = [...body.inputs().values()].sort((a, b) => {
    const aKey = a.transactionId() + a.index().toString();
    const bKey = b.transactionId() + b.index().toString();
    return aKey.localeCompare(bKey);
  });

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const utxo = utxoMap.get(refOf(input));
    if (!utxo) continue;

    const paymentPart = utxo.output().address().getProps().paymentPart;
    if (paymentPart && paymentPart.type === CredentialType.ScriptHash) {
      const name = hashToName.get(paymentPart.hash);
      if (name) labels[`spend[${i}]`] = name;
    }
  }

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
        labels[`mint[${i}]`] = name;
      }
    }
  }

  const withdrawals = body.withdrawals();
  if (withdrawals) {
    // matches Blaze insertSorted
    const hashes = [...withdrawals.keys()]
      .map((account) => RewardAccount.toHash(account))
      .sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < hashes.length; i++) {
      const name = hashToName.get(hashes[i]);
      if (name) {
        labels[`withdraw[${i}]`] = name;
      }
    }
  }

  return labels;
}

/** Name the validator after each redeemer reference, "spend[0]" -> "spend[0] (ValidatorClassName)"; a "reward" reference is a withdrawal. */
export function labelValidators(
  message: string,
  labels: ValidatorLabels,
): string {
  return message.replace(
    /(spend|mint|withdraw|reward)\[(\d+)\]/gi,
    (match, tag: string, index: string) => {
      const purpose = tag.toLowerCase();
      const name =
        labels[`${purpose === "reward" ? "withdraw" : purpose}[${index}]`];
      return name ? `${match} (${name})` : match;
    },
  );
}
