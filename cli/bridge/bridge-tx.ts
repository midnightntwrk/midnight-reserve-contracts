/**
 * The committee bridge transactions, pure over their resolved inputs
 * (spec §9): an update (MIP rules 0–10, spec §5), funded from the pool on a
 * handover (rules 12–17, §7); a top-up of the pool; and a BEEFY threshold
 * edit under Council + Tech Auth (§6). An update takes the forever, logic
 * and pool scripts from their reference-script UTxOs (§11): in the witness
 * set no useful committee fits.
 */
import {
  type Address,
  addressFromValidator,
  AssetId,
  type Evaluator,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  type Script,
  Transaction,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import {
  createRewardAccount,
  createTxMetadata,
  mintWitnesses,
} from "../chain/transaction";
import type { Signers } from "../datum/signers";
import type { WitnessRequirements } from "../governance/threshold";

/** What an update spends and references: the light client, the two-stage main and BEEFY threshold UTxOs, and the reference scripts. */
export interface BridgeUpdateInputs {
  readonly forever: Script;
  readonly logic: Script;
  readonly mitigationLogic: Option.Option<Script>;
  readonly pool: Script;
  readonly foreverUtxo: TransactionUnspentOutput;
  readonly mainUtxo: TransactionUnspentOutput;
  readonly thresholdUtxo: TransactionUnspentOutput;
  /** The UTxOs carrying the forever and logic scripts, and the pool script when the update is funded. */
  readonly scriptRefs: readonly TransactionUnspentOutput[];
}

/** A funded update: the pool UTxOs it spends and what the pool pays; the fee is at least the debit (rule 16). */
export interface PoolFunding {
  readonly poolUtxos: readonly TransactionUnspentOutput[];
  readonly debit: bigint;
}

/** Blaze's provider evaluation of a draft whose fee is raised to `floor`: Blaze evaluates its first draft at fee 0, and rule 16 checks the pool's debit against the fee. */
const evaluateAtFeeFloor =
  (blaze: Blaze<BlazeProvider, Wallet>, floor: bigint): Evaluator =>
  (tx, additionalUtxos) => {
    const draft = Transaction.fromCbor(tx.toCbor());
    const body = draft.body();
    if (body.fee() < floor) {
      body.setFee(floor);
      draft.setBody(body);
    }
    return blaze.provider.evaluateTransaction(draft, additionalUtxos);
  };

/** The update transaction: the light client into `stateOut` (output 0) under the logic withdrawal with `update` as its redeemer; with funding, the pool UTxOs merge into output 1 less the debit. */
export const buildBridgeUpdateTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: BridgeUpdateInputs,
  update: Contracts.BridgeUpdate,
  stateOut: Contracts.BeefyConsensusState,
  funding: Option.Option<PoolFunding>,
  networkId: NetworkId,
): TxBuilder => {
  const redeemer = serialize(Contracts.BridgeUpdate, update);
  const base = inputs.scriptRefs.reduce(
    (tx, ref) => tx.addReferenceInput(ref),
    blaze
      .newTransaction()
      .addInput(inputs.foreverUtxo, PlutusData.newInteger(0n))
      .addReferenceInput(inputs.mainUtxo)
      .addReferenceInput(inputs.thresholdUtxo)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(
            addressFromValidator(networkId, inputs.forever).toBech32(),
          ),
          value: {
            coins: inputs.foreverUtxo.output().amount().coin(),
            assets: new Map([[AssetId(inputs.forever.hash()), 1n]]),
          },
          datum: serialize(Contracts.BeefyConsensusState, stateOut).toCore(),
        }),
      )
      .addWithdrawal(
        createRewardAccount(inputs.logic.hash(), networkId),
        0n,
        redeemer,
      ),
  );
  const mitigated = Option.match(inputs.mitigationLogic, {
    onNone: () => base,
    onSome: (script) =>
      base
        .addWithdrawal(
          createRewardAccount(script.hash(), networkId),
          0n,
          redeemer,
        )
        .provideScript(script),
  });
  return Option.match(funding, {
    onNone: () => mitigated,
    onSome: ({ poolUtxos, debit }) => {
      const poolIn = poolUtxos.reduce(
        (sum, utxo) => sum + utxo.output().amount().coin(),
        0n,
      );
      return poolUtxos
        .reduce(
          (tx, utxo) => tx.addInput(utxo, PlutusData.newInteger(0n)),
          mitigated,
        )
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(
              addressFromValidator(networkId, inputs.pool).toBech32(),
            ),
            value: { coins: poolIn - debit },
          }),
        )
        .setMinimumFee(debit)
        .useEvaluator(evaluateAtFeeFloor(blaze, debit));
    },
  });
};

/** A payment of `lovelace` to the pool address (no stake part, no datum). */
export const buildBridgeTopupTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  pool: Script,
  lovelace: bigint,
  networkId: NetworkId,
): TxBuilder =>
  blaze.newTransaction().addOutput(
    TransactionOutput.fromCore({
      address: PaymentAddress(addressFromValidator(networkId, pool).toBech32()),
      value: { coins: lovelace },
    }),
  );

/** What a threshold edit spends and references: the BEEFY threshold and the deployer's fee UTxO; main_gov_threshold (the fractions both authorities sign under) and both authorities' forever UTxOs. */
export interface BridgeThresholdInputs {
  readonly threshold: Script;
  readonly thresholdUtxo: TransactionUnspentOutput;
  readonly userUtxo: TransactionUnspentOutput;
  readonly mainGovThresholdUtxo: TransactionUnspentOutput;
  readonly councilForeverUtxo: TransactionUnspentOutput;
  readonly techAuthForeverUtxo: TransactionUnspentOutput;
  readonly councilSigners: Signers;
  readonly techAuthSigners: Signers;
  readonly requirements: WitnessRequirements;
}

/** The network, change address, fee padding and CIP-20 type of a threshold edit. */
export interface BridgeThresholdParams {
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
  readonly txType: string;
}

/** The threshold edit: the BEEFY threshold NFT back to its script with `datum`, under the council and tech-auth witness mints. */
export const buildBridgeThresholdTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: BridgeThresholdInputs,
  datum: Contracts.BeefyThreshold,
  params: BridgeThresholdParams,
): TxBuilder => {
  const { networkId } = params;
  const { techAuth, council } = inputs.requirements;
  return mintWitnesses(
    blaze
      .newTransaction()
      .addInput(inputs.userUtxo)
      .addInput(inputs.thresholdUtxo, PlutusData.newInteger(0n))
      .addReferenceInput(inputs.mainGovThresholdUtxo)
      .addReferenceInput(inputs.councilForeverUtxo)
      .addReferenceInput(inputs.techAuthForeverUtxo)
      .provideScript(inputs.threshold),
    [
      { ...council, signers: inputs.councilSigners, assetName: "" },
      { ...techAuth, signers: inputs.techAuthSigners, assetName: "" },
    ],
    networkId,
  )
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(
          addressFromValidator(networkId, inputs.threshold).toBech32(),
        ),
        value: {
          coins: inputs.thresholdUtxo.output().amount().coin(),
          assets: new Map([[AssetId(inputs.threshold.hash()), 1n]]),
        },
        datum: serialize(Contracts.BeefyThreshold, datum).toCore(),
      }),
    )
    .setChangeAddress(params.changeAddress)
    .setMetadata(createTxMetadata(params.txType))
    .setFeePadding(params.feePadding);
};
