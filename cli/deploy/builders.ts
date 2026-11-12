/**
 * The deployment transactions as plans, pure over their resolved inputs.
 * Each spends its one-shot UTxO and mints the NFT(s) that one-shot
 * parameterises: a two-stage deployment mints the forever NFT and the
 * two-stage main and staging NFTs (and registers the logic as a stake
 * credential where the deployment asks for it), the cNIGHT minting
 * deployment mints only the two-stage NFTs and registers its forever, a
 * threshold deployment mints the threshold NFT, a staging-forever
 * deployment mints the staging forever NFT. Every output holds its min ADA.
 */
import {
  addressFromValidator,
  AssetId,
  AssetName,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { calculateMinAda } from "@blaze-cardano/tx";
import { Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import {
  createUpgradeState,
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
} from "../governance/two-stage";
import type { TxPlan } from "../tx/plan";

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

/** What every deployment plan is built with. */
export interface DeployParams {
  readonly networkId: NetworkId;
  readonly coinsPerUtxoByte: number;
}

/** The two-stage states of a deployment: the one-shot and collateral UTxOs, the validator, the logic both states start on, and the gov-auth hashes they name. */
export interface TwoStageStates {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly collateral: TransactionUnspentOutput;
  readonly twoStage: Script;
  readonly logic: Script;
  readonly govAuth: string;
  readonly stagingGovAuth: string;
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
  readonly collateral: TransactionUnspentOutput;
  readonly threshold: Script;
  readonly datum: Contracts.MultisigThreshold;
}

/** A staging forever validator's deployment: its script, its datum and its mint redeemer. */
export interface StagingForeverDeployment {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly collateral: TransactionUnspentOutput;
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

const upgradeStateDatum = (logic: Script, govAuth: string): PlutusData =>
  serialize(Contracts.UpgradeState, createUpgradeState(logic.hash(), govAuth));

/** The plan every deployment starts from: it spends the one-shot and offers the collateral. */
const fromOneShot = (
  inputs: Pick<TwoStageStates, "oneShotUtxo" | "collateral">,
): TxPlan => ({
  spends: [{ utxo: inputs.oneShotUtxo, redeemer: Option.none() }],
  references: [],
  scripts: [],
  mints: [],
  outputs: [],
  withdrawals: [],
  registrations: [],
  collateral: [inputs.collateral],
  requiredSignatures: 0,
});

/** The empty-named NFT of `policy`, minted with `redeemer` and locked at the policy's address with `datum`. */
const mintEmptyNamed = (
  policy: Script,
  redeemer: PlutusData,
  datum: PlutusData,
  params: DeployParams,
): Pick<TxPlan, "mints" | "outputs"> => ({
  mints: [
    {
      policy,
      assets: new Map([[AssetName(""), 1n]]),
      redeemer: Option.some(redeemer),
    },
  ],
  outputs: [nftOutput(policy, "", datum, params)],
});

/** Spend the one-shot, mint the two-stage main and staging NFTs and lock each at the two-stage with its UpgradeState. */
const planTwoStageStates = (
  inputs: TwoStageStates,
  params: DeployParams,
): TxPlan => ({
  ...fromOneShot(inputs),
  mints: [
    {
      policy: inputs.twoStage,
      assets: new Map([
        [AssetName(MAIN_TOKEN_HEX), 1n],
        [AssetName(STAGING_TOKEN_HEX), 1n],
      ]),
      redeemer: Option.some(PlutusData.newInteger(0n)),
    },
  ],
  outputs: [
    nftOutput(
      inputs.twoStage,
      MAIN_TOKEN_HEX,
      upgradeStateDatum(inputs.logic, inputs.govAuth),
      params,
    ),
    nftOutput(
      inputs.twoStage,
      STAGING_TOKEN_HEX,
      upgradeStateDatum(inputs.logic, inputs.stagingGovAuth),
      params,
    ),
  ],
});

/** Mint the two-stage states and the forever NFT, lock each at its script, and register the logic where the deployment asks. */
export const planTwoStageDeployment = (
  inputs: TwoStageDeployment,
  params: DeployParams,
): TxPlan => {
  const states = planTwoStageStates(inputs, params);
  const forever = mintEmptyNamed(
    inputs.forever,
    inputs.foreverRedeemer,
    inputs.foreverDatum,
    params,
  );
  return {
    ...states,
    mints: [...states.mints, ...forever.mints],
    outputs: [...states.outputs, ...forever.outputs],
    registrations: inputs.registerLogic ? [inputs.logic] : [],
  };
};

/** Mint the two-stage states and register the forever's stake credential: cNIGHT minting runs as a withdrawal from it, and it holds no NFT. */
export const planCnightMintingDeployment = (
  inputs: CnightMintingDeployment,
  params: DeployParams,
): TxPlan => ({
  ...planTwoStageStates(inputs, params),
  registrations: [inputs.forever],
});

/** Spend the one-shot, mint the threshold NFT and lock it at the threshold with its datum. */
export const planThresholdDeployment = (
  inputs: ThresholdDeployment,
  params: DeployParams,
): TxPlan => ({
  ...fromOneShot(inputs),
  ...mintEmptyNamed(
    inputs.threshold,
    PlutusData.newInteger(0n),
    serialize(Contracts.MultisigThreshold, inputs.datum),
    params,
  ),
});

/** Spend the one-shot, mint the staging forever NFT and lock it at the staging forever with its datum. */
export const planStagingForeverDeployment = (
  inputs: StagingForeverDeployment,
  params: DeployParams,
): TxPlan => ({
  ...fromOneShot(inputs),
  ...mintEmptyNamed(
    inputs.stagingForever,
    inputs.redeemer,
    inputs.datum,
    params,
  ),
});
