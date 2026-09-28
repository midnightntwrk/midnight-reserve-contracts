/**
 * The deployment transactions, pure over their resolved inputs. Each spends
 * its one-shot UTxO and mints the NFT(s) that one-shot parameterises:
 * a two-stage deployment mints the forever NFT and the two-stage main and
 * staging NFTs (and registers the logic as a stake credential where the
 * deployment asks for it), a threshold deployment mints the threshold NFT
 * (the BEEFY one also registers the bridge logic), a staging-forever
 * deployment mints the staging forever NFT. The reference-scripts
 * transaction spends no one-shot and locks scripts for later transactions to
 * reference. Every output holds its min ADA.
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
import {
  createRewardAccount,
  createUpgradeState,
  registerScriptStake,
} from "../chain/transaction";

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

/** A two-stage validator's deployment: its triple, the gov-auth scripts its upgrade states name, and its forever datum and mint redeemer. */
export interface TwoStageDeployment {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly twoStage: Script;
  readonly forever: Script;
  readonly logic: Script;
  readonly govAuth: Script;
  readonly stagingGovAuth: Script;
  readonly foreverDatum: PlutusData;
  readonly foreverRedeemer: PlutusData;
  readonly registerLogic: boolean;
}

/** A threshold's deployment: its script and its datum. */
export interface ThresholdDeployment {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly threshold: Script;
  readonly datum: Contracts.MultisigThreshold;
}

/** The BEEFY threshold's deployment: its script, its datum, and the bridge logic whose stake credential it registers. */
export interface BeefyThresholdDeployment {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly threshold: Script;
  readonly datum: Contracts.BeefyThreshold;
  readonly bridgeLogic: Script;
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

/** Spend the one-shot, mint the forever NFT and the two-stage main and staging NFTs, and lock each at its script. */
export const buildTwoStageDeploymentTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: TwoStageDeployment,
  params: DeployParams,
): TxBuilder => {
  const minted = blaze
    .newTransaction()
    .addInput(inputs.oneShotUtxo)
    .addMint(
      PolicyId(inputs.forever.hash()),
      new Map([[AssetName(""), 1n]]),
      inputs.foreverRedeemer,
    )
    .addMint(
      PolicyId(inputs.twoStage.hash()),
      new Map([
        [AssetName(MAIN_TOKEN_HEX), 1n],
        [AssetName(STAGING_TOKEN_HEX), 1n],
      ]),
      PlutusData.newInteger(0n),
    )
    .provideScript(inputs.twoStage)
    .provideScript(inputs.forever)
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
    )
    .addOutput(nftOutput(inputs.forever, "", inputs.foreverDatum, params));
  return withCollateral(
    inputs.registerLogic ? registerScriptStake(minted, inputs.logic) : minted,
    params,
  );
};

/** Spend the one-shot, mint a threshold NFT and lock it at the threshold with its datum. */
const mintThreshold = (
  blaze: Blaze<BlazeProvider, Wallet>,
  oneShotUtxo: TransactionUnspentOutput,
  threshold: Script,
  datum: PlutusData,
  params: DeployParams,
): TxBuilder =>
  blaze
    .newTransaction()
    .addInput(oneShotUtxo)
    .addMint(
      PolicyId(threshold.hash()),
      new Map([[AssetName(""), 1n]]),
      PlutusData.newInteger(0n),
    )
    .provideScript(threshold)
    .addOutput(nftOutput(threshold, "", datum, params));

/** Spend the one-shot, mint the threshold NFT and lock it at the threshold with its MultisigThreshold datum. */
export const buildThresholdDeploymentTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: ThresholdDeployment,
  params: DeployParams,
): TxBuilder =>
  withCollateral(
    mintThreshold(
      blaze,
      inputs.oneShotUtxo,
      inputs.threshold,
      serialize(Contracts.MultisigThreshold, inputs.datum),
      params,
    ),
    params,
  );

/** Mint the BEEFY threshold NFT with its BeefyThreshold datum (never MultisigThreshold, the same four-Int shape) and register the bridge logic, which the bridge NFT transaction has no room for. */
export const buildBeefyThresholdDeploymentTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: BeefyThresholdDeployment,
  params: DeployParams,
): TxBuilder =>
  withCollateral(
    registerScriptStake(
      mintThreshold(
        blaze,
        inputs.oneShotUtxo,
        inputs.threshold,
        serialize(Contracts.BeefyThreshold, inputs.datum),
        params,
      ),
      inputs.bridgeLogic,
    ),
    params,
  );

/** An output at `address` carrying `script` as its reference script, at its min ADA. */
const referenceScriptOutput = (
  script: Script,
  address: string,
  params: DeployParams,
): TransactionOutput => {
  const output = TransactionOutput.fromCore({
    address: PaymentAddress(address),
    value: { coins: 0n },
  });
  output.setScriptRef(script);
  output.amount().setCoin(calculateMinAda(output, params.coinsPerUtxoByte));
  return output;
};

/** Lock each script as a reference script in its own output at `address`, in order; no script runs. */
export const buildReferenceScriptsTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  scripts: readonly Script[],
  address: string,
  params: DeployParams,
): TxBuilder =>
  scripts.reduce(
    (txBuilder, script) =>
      txBuilder.addOutput(referenceScriptOutput(script, address, params)),
    blaze.newTransaction(),
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

/** The virtual account list's key of the tail sentinel; every stake key hash sorts below it. */
export const TAIL_KEY = "ff".repeat(28);

/** The rewards batcher's init: its script and its first state. */
export interface BatcherInitDeployment {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly batcher: Script;
  readonly state: Contracts.BatcherState;
}

/** The virtual account list's init: its one-shot and the account script. */
export interface AccountListDeployment {
  readonly oneShotUtxo: TransactionUnspentOutput;
  readonly account: Script;
}

/** Spend the one-shot, mint the batcher state NFT and lock the first state at the batcher; register the batcher's stake credential, whose withdraw-zero logic every batch runs. */
export const buildBatcherInitTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: BatcherInitDeployment,
  params: DeployParams,
): TxBuilder =>
  withCollateral(
    registerScriptStake(
      blaze
        .newTransaction()
        .addInput(inputs.oneShotUtxo)
        .addMint(
          PolicyId(inputs.batcher.hash()),
          new Map([[AssetName(""), 1n]]),
          PlutusData.newInteger(0n),
        )
        .provideScript(inputs.batcher)
        .addOutput(
          nftOutput(
            inputs.batcher,
            "",
            serialize(Contracts.BatcherState, inputs.state),
            params,
          ),
        ),
      inputs.batcher,
    ),
    params,
  );

/** Register the account's stake credential, alone: the list's InitList withdraws from it, and the ledger needs it registered in an earlier transaction. */
export const buildAccountStakeTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  account: Script,
  params: DeployParams,
): TxBuilder =>
  withCollateral(registerScriptStake(blaze.newTransaction(), account), params);

/** Spend the one-shot, mint the list head and tail NFTs and lock `Head { next: tail }` then `Tail` at the account address, under the account's InitList withdrawal over those two outputs (spec §4.2). */
export const buildAccountListTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: AccountListDeployment,
  params: DeployParams,
): TxBuilder => {
  const tail = `00${TAIL_KEY}`;
  return withCollateral(
    blaze
      .newTransaction()
      .addInput(inputs.oneShotUtxo)
      .addMint(
        PolicyId(inputs.account.hash()),
        new Map([
          [AssetName(""), 1n],
          [AssetName(tail), 1n],
        ]),
        serialize(Contracts.AccountGate, "User"),
      )
      .provideScript(inputs.account)
      .addOutput(
        nftOutput(
          inputs.account,
          "",
          serialize(Contracts.AccountDatum, { Head: { next: TAIL_KEY } }),
          params,
        ),
      )
      .addOutput(
        nftOutput(
          inputs.account,
          tail,
          serialize(Contracts.AccountDatum, "Tail"),
          params,
        ),
      )
      .addWithdrawal(
        createRewardAccount(inputs.account.hash(), params.networkId),
        0n,
        serialize(Contracts.AccountAction, { kind: "InitList", offset: 0n }),
      ),
    params,
  );
};
