/**
 * A governed forever update: spend a forever UTxO into the same script with
 * a new datum, mint the council and tech-auth witnesses the threshold asks
 * for, and withdraw through the two-stage logic (and mitigation logic),
 * referencing the threshold, both authorities' forever UTxOs and the
 * two-stage main UTxO. change-terms and change-federated-ops are this
 * transaction with their own datum.
 */
import {
  type Address,
  addressFromValidator,
  AssetId,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import type { Option } from "effect";
import type { Signers } from "../datum/signers";
import {
  createTxMetadata,
  logicRedeemer,
  mintWitnesses,
  withdrawThroughLogic,
} from "../chain/transaction";
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

/** The network, change address and fee padding of a transaction, and its CIP-20 type. */
export interface GovernedForeverParams {
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
  readonly txType: string;
}

/** The update transaction with `newState` as the forever's datum. */
export const buildGovernedForeverUpdateTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: GovernedForeverInputs,
  newState: PlutusData,
  params: GovernedForeverParams,
): TxBuilder => {
  const { networkId } = params;
  const { techAuth, council } = inputs.requirements;
  const spent = blaze
    .newTransaction()
    .addInput(inputs.userUtxo)
    .addInput(inputs.foreverUtxo, PlutusData.newInteger(0n))
    .addReferenceInput(inputs.thresholdUtxo)
    .addReferenceInput(inputs.councilForeverUtxo)
    .addReferenceInput(inputs.techAuthForeverUtxo)
    .addReferenceInput(inputs.twoStageUtxo)
    .provideScript(inputs.forever);
  const witnessed = mintWitnesses(
    spent,
    [
      { ...council, signers: inputs.councilSigners, assetName: "" },
      { ...techAuth, signers: inputs.techAuthSigners, assetName: "" },
    ],
    networkId,
  ).addOutput(
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
  );
  return withdrawThroughLogic(
    witnessed,
    inputs.logicScript,
    inputs.mitigationLogicScript,
    logicRedeemer(PlutusData.newInteger(0n), inputs.logicRound),
    networkId,
  )
    .setChangeAddress(params.changeAddress)
    .setMetadata(createTxMetadata(params.txType))
    .setFeePadding(params.feePadding);
};
