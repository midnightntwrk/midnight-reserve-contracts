/**
 * The UpgradeState of a two-stage validator (logic, auth, mitigation logic,
 * mitigation auth) as stage-upgrade and promote-upgrade move it: the field
 * transitions, the target UTxOs they act on and the output that carries the
 * next state. Pure.
 */
import { serialize } from "@blaze-cardano/data";
import {
  addressFromValidator,
  AssetId,
  type NetworkId,
  PaymentAddress,
  type Script,
  type TransactionInput,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Option } from "effect";
import * as Contracts from "../../../contract_blueprint";
import type { GovernanceAuthority } from "../authority";

/** The UpgradeState field a transaction moves. */
export type UpgradeField =
  "Logic" | "Auth" | "MitigationLogic" | "MitigationAuth";

/** One two-stage validator with its main and staging UTxOs. */
export interface TwoStageTarget {
  readonly twoStage: Script;
  readonly mainUtxo: TransactionUnspentOutput;
  readonly stagingUtxo: TransactionUnspentOutput;
  /** A reference-script UTxO carrying `twoStage`; None provides the script inline. */
  readonly scriptRef: Option.Option<TransactionUnspentOutput>;
}

export interface UpgradeInputs {
  readonly target: TwoStageTarget;
  readonly authority: GovernanceAuthority;
  readonly userUtxo: TransactionUnspentOutput;
}

/** UpgradeState is [logic, mitigation_logic, auth, mitigation_auth, round, logic_round]. */
export const nextStagingState = (
  field: UpgradeField,
  current: Contracts.UpgradeState,
  newHash: string,
): Contracts.UpgradeState => {
  const [logic, mitigationLogic, auth, mitigationAuth, round, logicRound] =
    current;
  switch (field) {
    case "Logic":
      return [
        newHash,
        mitigationLogic,
        auth,
        mitigationAuth,
        round,
        logicRound + 1n,
      ];
    case "Auth":
      return [
        logic,
        mitigationLogic,
        newHash,
        mitigationAuth,
        round + 1n,
        logicRound,
      ];
    case "MitigationLogic":
      return [logic, newHash, auth, mitigationAuth, round + 1n, logicRound];
    case "MitigationAuth":
      return [logic, mitigationLogic, auth, newHash, round + 1n, logicRound];
  }
};

/** The main state after promotion: the staged field and its round are copied over. */
export const promotedMainState = (
  field: UpgradeField,
  main: Contracts.UpgradeState,
  staging: Contracts.UpgradeState,
): Contracts.UpgradeState => {
  const [logic, mitigationLogic, auth, mitigationAuth, round, logicRound] =
    main;
  switch (field) {
    case "Logic":
      return [
        staging[0],
        mitigationLogic,
        auth,
        mitigationAuth,
        round,
        staging[5],
      ];
    case "Auth":
      return [
        logic,
        mitigationLogic,
        staging[2],
        mitigationAuth,
        staging[4],
        logicRound,
      ];
    case "MitigationLogic":
      return [logic, staging[1], auth, mitigationAuth, staging[4], logicRound];
    case "MitigationAuth":
      return [logic, mitigationLogic, auth, staging[3], staging[4], logicRound];
  }
};

export const outputRef = (input: TransactionInput) => ({
  transaction_id: input.transactionId(),
  output_index: BigInt(input.index()),
});

/** The target's output holding `state` under `tokenHex`, with the spent UTxO's coin. */
export const twoStageOutput = (
  target: TwoStageTarget,
  spent: TransactionUnspentOutput,
  tokenHex: string,
  state: Contracts.UpgradeState,
  networkId: NetworkId,
) =>
  TransactionOutput.fromCore({
    address: PaymentAddress(
      addressFromValidator(networkId, target.twoStage).toBech32(),
    ),
    value: {
      coins: spent.output().amount().coin(),
      assets: new Map([[AssetId(target.twoStage.hash() + tokenHex), 1n]]),
    },
    datum: serialize(Contracts.UpgradeState, state).toCore(),
  });

export const withTwoStageScript = (
  txBuilder: TxBuilder,
  target: TwoStageTarget,
) =>
  Option.match(target.scriptRef, {
    onNone: () => txBuilder.provideScript(target.twoStage),
    onSome: (ref) => txBuilder.addReferenceInput(ref),
  });
