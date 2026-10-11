/** The upgrade state a two-stage deployment starts from. */
import type * as Contracts from "../../contract_blueprint";

export function createUpgradeState(
  logicScriptHash: string,
  govAuthScriptHash: string,
): Contracts.UpgradeState {
  return [logicScriptHash, "", govAuthScriptHash, "", 0n, 0n];
}
