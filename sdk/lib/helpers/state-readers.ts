/**
 * Helper functions to read on-chain state from UTxOs
 */

import type { TransactionUnspentOutput } from "@blaze-cardano/sdk";
import { parse } from "@blaze-cardano/data";
import type * as Contracts from "../../../contract_blueprint";

/**
 * Read VersionedMultisig state from a UTxO
 */
export async function readVersionedMultisigState(
  utxo: TransactionUnspentOutput
): Promise<typeof Contracts.VersionedMultisig> {
  const Contracts = await import("../../../contract_blueprint");

  const datum = utxo.output().datum();
  if (!datum) {
    throw new Error("UTxO has no datum");
  }

  const datumCbor = datum.asInlineData();
  if (!datumCbor) {
    throw new Error("UTxO datum is not inline");
  }

  return parse(Contracts.VersionedMultisig, datumCbor);
}

/**
 * Read MultisigThreshold state from a UTxO
 */
export async function readMultisigThresholdState(
  utxo: TransactionUnspentOutput
): Promise<typeof Contracts.MultisigThreshold> {
  const Contracts = await import("../../../contract_blueprint");

  const datum = utxo.output().datum();
  if (!datum) {
    throw new Error("UTxO has no datum");
  }

  const datumCbor = datum.asInlineData();
  if (!datumCbor) {
    throw new Error("UTxO datum is not inline");
  }

  return parse(Contracts.MultisigThreshold, datumCbor);
}

/**
 * Read UpgradeState from a UTxO
 */
export async function readUpgradeState(
  utxo: TransactionUnspentOutput
): Promise<typeof Contracts.UpgradeState> {
  const Contracts = await import("../../../contract_blueprint");

  const datum = utxo.output().datum();
  if (!datum) {
    throw new Error("UTxO has no datum");
  }

  const datumCbor = datum.asInlineData();
  if (!datumCbor) {
    throw new Error("UTxO datum is not inline");
  }

  return parse(Contracts.UpgradeState, datumCbor);
}
