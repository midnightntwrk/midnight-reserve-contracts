/**
 * A governed forever update: spend a forever UTxO into the same script with
 * a new datum, mint the council and tech-auth witnesses the threshold asks
 * for, and withdraw through the two-stage logic (and mitigation logic),
 * referencing the threshold, both authorities' forever UTxOs and the
 * two-stage main UTxO. change-terms and change-federated-ops are this
 * transaction with their own datum.
 */
import {
  addressFromValidator,
  AssetId,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Option } from "effect";
import type { Signers } from "../datum/signers";
import type { TxPlan } from "../tx/plan";
import {
  logicRedeemer,
  mintWitnesses,
  withdrawThroughLogic,
} from "../tx/scripts";
import type { WitnessRequirements } from "./threshold";

/** What a governed forever update spends and references, resolved from the chain and the blueprint. */
export interface GovernedForeverInputs {
  readonly forever: Script;
  readonly foreverUtxo: TransactionUnspentOutput;
  readonly thresholdUtxo: TransactionUnspentOutput;
  readonly councilForeverUtxo: TransactionUnspentOutput;
  readonly techAuthForeverUtxo: TransactionUnspentOutput;
  readonly twoStageUtxo: TransactionUnspentOutput;
  readonly userUtxo: TransactionUnspentOutput;
  readonly logicScript: Script;
  readonly mitigationLogicScript: Option.Option<Script>;
  /** logic_round of the two-stage UpgradeState (selects the redeemer wrapping). */
  readonly logicRound: number;
  readonly councilSigners: Signers;
  readonly techAuthSigners: Signers;
  /** What the threshold demands of both authorities, from the signers above. */
  readonly requirements: WitnessRequirements;
}

/** The network the update is built for. */
export interface GovernedForeverParams {
  readonly networkId: NetworkId;
}

/** The update with `newState` as the forever's datum: the user and forever UTxOs spent, the council and tech-auth witnesses minted, the logic (and mitigation logic) withdrawn through. */
export const planGovernedForeverUpdate = (
  inputs: GovernedForeverInputs,
  newState: PlutusData,
  params: GovernedForeverParams,
): TxPlan => {
  const { networkId } = params;
  const { techAuth, council } = inputs.requirements;
  return {
    spends: [
      { utxo: inputs.userUtxo, redeemer: Option.none() },
      {
        utxo: inputs.foreverUtxo,
        redeemer: Option.some(PlutusData.newInteger(0n)),
      },
    ],
    references: [
      inputs.thresholdUtxo,
      inputs.councilForeverUtxo,
      inputs.techAuthForeverUtxo,
      inputs.twoStageUtxo,
    ],
    scripts: [inputs.forever],
    ...mintWitnesses(
      [
        { ...council, signers: inputs.councilSigners, assetName: "" },
        { ...techAuth, signers: inputs.techAuthSigners, assetName: "" },
      ],
      networkId,
    ),
    outputs: [
      TransactionOutput.fromCore({
        address: PaymentAddress(
          addressFromValidator(networkId, inputs.forever).toBech32(),
        ),
        value: {
          coins: inputs.foreverUtxo.output().amount().coin(),
          assets: new Map([[AssetId(inputs.forever.hash()), 1n]]),
        },
        datum: newState.toCore(),
      }),
    ],
    withdrawals: withdrawThroughLogic(
      inputs.logicScript,
      inputs.mitigationLogicScript,
      logicRedeemer(PlutusData.newInteger(0n), inputs.logicRound),
      networkId,
    ),
    registrations: [],
    collateral: [],
  };
};
