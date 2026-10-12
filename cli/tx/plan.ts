/**
 * A transaction as a value: what it spends, references, provides, pays and
 * withdraws, and how compile completes it. tx/compile.ts is the only module
 * that turns a plan into a Blaze transaction. Fields arrive with the first
 * command that needs them (plans/cli-architecture/04-tx-plan-compile.md).
 */
import type {
  Address,
  PlutusData,
  RewardAccount,
  Script,
  SlotConfig,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type { Option } from "effect";
import type { WalletContext } from "../chain/provider";
import type { NamedContract } from "./labels";

/** A transaction before completion: coin selection, balancing and evaluation are compile's. */
export interface TxPlan {
  /** Inputs, with the spend redeemer of a script input. */
  readonly spends: readonly {
    readonly utxo: TransactionUnspentOutput;
    readonly redeemer: Option.Option<PlutusData>;
  }[];
  readonly references: readonly TransactionUnspentOutput[];
  /** Scripts provided in the witness set for the spends. */
  readonly scripts: readonly Script[];
  /** Outputs in transaction order; the change output follows them. */
  readonly outputs: readonly TransactionOutput[];
  /** Zero withdrawals, each with its script, which is provided in the witness set. */
  readonly withdrawals: readonly {
    readonly rewardAccount: RewardAccount;
    readonly script: Script;
    readonly redeemer: PlutusData;
  }[];
}

/** How compile completes a plan; the program resolves every field. */
export interface CompileOptions {
  readonly commandName: string;
  /** The chain's slot configuration (slotConfigOf), for the local evaluator. */
  readonly slotConfig: SlotConfig;
  /** The wallet coin selection draws from: the deployer's, or the user's for a user-paid transaction. */
  readonly wallet: WalletContext;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
  /** The CIP-20 transaction type (createTxMetadata); None for no metadata. */
  readonly metadata: Option.Option<string>;
  /** The vkey witnesses the transaction carries at submit (witnessCount), counted in its size. */
  readonly expectedWitnesses: number;
  /** The blueprint contracts that name validators in traces; empty when there is no blueprint. */
  readonly contracts: readonly NamedContract[];
}
