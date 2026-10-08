/**
 * The deployment transactions, pure over their resolved inputs. Each spends
 * its one-shot UTxO and mints the NFT(s) that one-shot parameterises:
 * a two-stage deployment mints the forever NFT and the two-stage main and
 * staging NFTs (and registers the logic as a stake credential where the
 * deployment asks for it), the cNIGHT minting deployment mints only the
 * two-stage NFTs and registers its forever, a threshold deployment mints
 * the threshold NFT, a staging-forever deployment mints the staging forever
 * NFT. Every output holds its min ADA.
 */
import {
  addressFromValidator,
  AssetId,
  AssetName,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import { calculateMinAda, type TxBuilder } from "@blaze-cardano/tx";
import * as Contracts from "../../contract_blueprint";
import {
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
} from "../chain/governance-provider";
import { createUpgradeState, registerScriptStake } from "../chain/transaction";

/** The forever datum of reserve and ICS, main and staging: Constr 0 [0, 0]. */
export const ZERO_FOREVER_DATUM = PlutusData.fromCore({
  constructor: 0n,
  fields: {
    items: [
      PlutusData.newInteger(0n).toCore(),
      PlutusData.newInteger(0n).toCore(),
    ],
  },
});

/** What every deployment transaction is built with. */
export interface DeployParams {
  readonly networkId: NetworkId;
  readonly coinsPerUtxoByte: number;
  readonly collateral: TransactionUnspentOutput;
}

/** The two-stage states of a deployment: the validator, the logic both states start on, and the gov-auth scripts they name. */
export interface TwoStageStates {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly twoStage: Script;
  readonly logic: Script;
  readonly govAuth: Script;
  readonly stagingGovAuth: Script;
}

/** A two-stage validator's deployment: its states, its forever with its datum and mint redeemer, and whether the logic is registered. */
export interface TwoStageDeployment extends TwoStageStates {
  readonly forever: Script;
  readonly foreverDatum: PlutusData;
  readonly foreverRedeemer: PlutusData;
  readonly registerLogic: boolean;
}

/** cNIGHT minting's deployment: its states and its forever, which is registered and holds no NFT. */
export interface CnightMintingDeployment extends TwoStageStates {
  readonly forever: Script;
}

/** A threshold's deployment: its script and its datum. */
export interface ThresholdDeployment {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly threshold: Script;
  readonly datum: Contracts.MultisigThreshold;
}

/** A staging forever validator's deployment: its script, its datum and its mint redeemer. */
export interface StagingForeverDeployment {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly stagingForever: Script;
  readonly datum: PlutusData;
  readonly redeemer: PlutusData;
}

/** An output at the script's address holding one of its tokens with a datum, at its min ADA. */
const nftOutput = (
  script: Script,
  assetName: string,
  datum: PlutusData,
  params: DeployParams,
): TransactionOutput => {
  const output = TransactionOutput.fromCore({
    address: PaymentAddress(
      addressFromValidator(params.networkId, script).toBech32(),
    ),
    value: {
      coins: 0n,
      assets: new Map([[AssetId(script.hash() + assetName), 1n]]),
    },
    datum: datum.toCore(),
  });
  output.amount().setCoin(calculateMinAda(output, params.coinsPerUtxoByte));
  return output;
};

const upgradeStateDatum = (logic: Script, govAuth: Script): PlutusData =>
  serialize(
    Contracts.UpgradeState,
    createUpgradeState(logic.hash(), govAuth.hash()),
  );

const withCollateral = (txBuilder: TxBuilder, params: DeployParams) =>
  txBuilder.provideCollateral([params.collateral]);

/** Spend the one-shot, mint the two-stage main and staging NFTs and lock each at the two-stage with its UpgradeState. */
const mintTwoStageStates = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: TwoStageStates,
  params: DeployParams,
): TxBuilder =>
  blaze
    .newTransaction()
    .addInput(inputs.oneShotUtxo)
    .addMint(
      PolicyId(inputs.twoStage.hash()),
      new Map([
        [AssetName(MAIN_TOKEN_HEX), 1n],
        [AssetName(STAGING_TOKEN_HEX), 1n],
      ]),
      PlutusData.newInteger(0n),
    )
    .provideScript(inputs.twoStage)
    .addOutput(
      nftOutput(
        inputs.twoStage,
        MAIN_TOKEN_HEX,
        upgradeStateDatum(inputs.logic, inputs.govAuth),
        params,
      ),
    )
    .addOutput(
      nftOutput(
        inputs.twoStage,
        STAGING_TOKEN_HEX,
        upgradeStateDatum(inputs.logic, inputs.stagingGovAuth),
        params,
      ),
    );

/** Mint the two-stage states and the forever NFT, lock each at its script, and register the logic where the deployment asks. */
export const buildTwoStageDeploymentTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: TwoStageDeployment,
  params: DeployParams,
): TxBuilder => {
  const minted = mintTwoStageStates(blaze, inputs, params)
    .addMint(
      PolicyId(inputs.forever.hash()),
      new Map([[AssetName(""), 1n]]),
      inputs.foreverRedeemer,
    )
    .provideScript(inputs.forever)
    .addOutput(nftOutput(inputs.forever, "", inputs.foreverDatum, params));
  return withCollateral(
    inputs.registerLogic ? registerScriptStake(minted, inputs.logic) : minted,
    params,
  );
};

/** Mint the two-stage states and register the forever's stake credential: cNIGHT minting runs as a withdrawal from it, and it holds no NFT. */
export const buildCnightMintingDeploymentTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: CnightMintingDeployment,
  params: DeployParams,
): TxBuilder =>
  withCollateral(
    registerScriptStake(
      mintTwoStageStates(blaze, inputs, params),
      inputs.forever,
    ),
    params,
  );

/** Spend the one-shot, mint the threshold NFT and lock it at the threshold with its datum. */
export const buildThresholdDeploymentTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: ThresholdDeployment,
  params: DeployParams,
): TxBuilder =>
  withCollateral(
    blaze
      .newTransaction()
      .addInput(inputs.oneShotUtxo)
      .addMint(
        PolicyId(inputs.threshold.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .provideScript(inputs.threshold)
      .addOutput(
        nftOutput(
          inputs.threshold,
          "",
          serialize(Contracts.MultisigThreshold, inputs.datum),
          params,
        ),
      ),
    params,
  );

/** Spend the one-shot, mint the staging forever NFT and lock it at the staging forever with its datum. */
export const buildStagingForeverDeploymentTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: StagingForeverDeployment,
  params: DeployParams,
): TxBuilder =>
  withCollateral(
    blaze
      .newTransaction()
      .addInput(inputs.oneShotUtxo)
      .addMint(
        PolicyId(inputs.stagingForever.hash()),
        new Map([[AssetName(""), 1n]]),
        inputs.redeemer,
      )
      .provideScript(inputs.stagingForever)
      .addOutput(nftOutput(inputs.stagingForever, "", inputs.datum, params)),
    params,
  );
