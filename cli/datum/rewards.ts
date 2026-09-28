/**
 * The rewards contracts' deploy datums (`lib/rewards/types.ak`, spec §5.1).
 */
import type { BatcherState } from "../../contract_blueprint";

const ZERO28 = "00".repeat(28);

/** The batcher state at init: the account policy and pool forever it serves, the epoch before `firstEpoch`, no epoch loaded. */
export const initialBatcherState = (
  accountPolicy: string,
  poolForever: string,
  firstEpoch: bigint,
): BatcherState => ({
  account_policy: accountPolicy,
  pool_forever: poolForever,
  epoch: firstEpoch - 1n,
  root: "00".repeat(32),
  min_key: ZERO28,
  max_key: ZERO28,
  cursor: ZERO28,
  complete: true,
});
