/**
 * stage-upgrade: move one field of a two-stage validator's UpgradeState into
 * its staging UTxO. The transaction is the target step (spend the staging
 * UTxO, reference main, write the next state) plus the governance
 * authority. The program resolves everything through Provider/Blueprint and
 * keeps the deployed-scripts snapshot in step with the chain.
 */
import { serialize } from "@blaze-cardano/data";
import {
  type Address,
  addressFromValidator,
  type NetworkId,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Either, Option } from "effect";
import { environmentOf } from "../../config/network-mapping";
import { Blueprint, type UpgradableValidator } from "../../contracts/contracts";
import { contractUtxos, deployerUtxo, deployerWallet } from "../../chain/utxo";
import {
  STAGING_TOKEN_HEX,
  rawUpgradeStateAt,
  twoStageUtxos,
} from "../two-stage";
import { createTxMetadata } from "../../tx/scripts";
import { signAndWrite, signerFor, witnessCount } from "../../signing/signer";
import { Output } from "../../output";
import { buildTx } from "../../tx/complete-tx";
import { buildOutput, PROJECT_ROOT } from "../../contracts/paths";
import { isPromoted } from "../../contracts/snapshot/read";
import {
  type FeeInput,
  type ScriptHash,
  type TxFileInput,
  txFilePath,
} from "../../input";
import { Provider } from "../../chain/provider";
import type { DatumParseError } from "../../errors";
import * as Contracts from "../../../contract_blueprint";
import {
  requiredSignatures,
  resolveAuthority,
  withGovernanceAuthority,
} from "../authority";
import {
  applyRecord,
  logicToStage,
  prepareLogicCopy,
  stageRecord,
} from "./logic-record";
import {
  nextStagingState,
  outputRef,
  twoStageOutput,
  type TwoStageTarget,
  type UpgradeField,
  type UpgradeInputs,
  withTwoStageScript,
} from "./state";

export interface StageUpgradeParams {
  readonly field: UpgradeField;
  readonly newHash: string;
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
}

/** Spend the target's staging UTxO into its next state, referencing main. */
export const stageUpgradeStep = (
  txBuilder: TxBuilder,
  target: TwoStageTarget,
  field: UpgradeField,
  newHash: string,
  networkId: NetworkId,
): Either.Either<TxBuilder, DatumParseError> =>
  Either.map(rawUpgradeStateAt(target.stagingUtxo), (current) => {
    const redeemer = serialize(Contracts.TwoStageRedeemer, [
      field,
      { Staging: [outputRef(target.mainUtxo.input()), newHash] },
    ]);
    return withTwoStageScript(
      txBuilder
        .addInput(target.stagingUtxo, redeemer)
        .addReferenceInput(target.mainUtxo)
        .addOutput(
          twoStageOutput(
            target,
            target.stagingUtxo,
            STAGING_TOKEN_HEX,
            nextStagingState(field, current, newHash),
            networkId,
          ),
        ),
      target,
    );
  });

/** The stage transaction: one target step, the fee UTxO, the authority. */
export const buildStageUpgradeTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: UpgradeInputs,
  params: StageUpgradeParams,
): Either.Either<TxBuilder, DatumParseError> =>
  Either.gen(function* () {
    const stepped = yield* stageUpgradeStep(
      blaze.newTransaction(),
      inputs.target,
      params.field,
      params.newHash,
      params.networkId,
    );
    const authorized = withGovernanceAuthority(
      stepped.addInput(inputs.userUtxo),
      inputs.authority,
      params.networkId,
    );
    return authorized
      .setChangeAddress(params.changeAddress)
      .setMetadata(createTxMetadata("stage-upgrade"))
      .setFeePadding(params.feePadding);
  });

/** A stage: the validator and the logic hash to stage, its fee UTxO, whether to sign, where the file goes. */
export interface StageUpgradeInput extends TxFileInput, FeeInput {
  readonly validator: UpgradableValidator;
  readonly newLogicHash: ScriptHash;
  readonly sign: boolean;
}

const sameUtxo = (a: TransactionUnspentOutput, b: TransactionUnspentOutput) =>
  a.input().transactionId() === b.input().transactionId() &&
  a.input().index() === b.input().index();

/** Resolve the inputs, build, complete and write the stage transaction; then, where the environment keeps a record, copy a logic that only the build has into it and track it as staged. */
export const stageUpgradeProgram = (input: StageUpgradeInput) =>
  Effect.gen(function* () {
    const { network, validator, sign, newLogicHash } = input;
    const { txHash, txIndex } = input;
    const signer = yield* signerFor(sign, "both");
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);
    const profile = environmentOf(network).aikenConfigSection;

    yield* out.log(`\nStaging upgrade for ${validator} on ${network} network`);
    yield* out.log(`New logic hash: ${newLogicHash}`);
    const logic = yield* logicToStage(network, newLogicHash, {
      profile,
      plutusPath: buildOutput(PROJECT_ROOT, profile).plutusPath,
    });
    const copy = yield* prepareLogicCopy(network, newLogicHash, logic.copyFrom);
    if (Option.isSome(copy)) {
      yield* out.log(
        `  Not in deployed-scripts/${network}; found in the ${profile} build as ${logic.name}`,
      );
    }
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

    const restage = yield* isPromoted(network, logic.name);
    if (restage) {
      yield* out.log(
        `\n  Re-staging promoted validator: ${logic.name} (${newLogicHash})`,
      );
    }
    const record = stageRecord(logic.name, copy, restage);

    const { networkId } = environmentOf(network);
    const contracts = yield* blueprint.instances;
    const target = yield* blueprint.twoStage(validator);
    const twoStage = target.twoStage.Script;
    yield* out.log(
      `\nTwo Stage Address: ${addressFromValidator(networkId, twoStage).toBech32()}`,
    );

    const blaze = yield* provider.blazeFor(yield* deployerWallet);
    const scripts = {
      techAuthForever: contracts.techAuthForever.Script,
      councilForever: contracts.councilForever.Script,
      threshold: contracts.stagingGovThreshold.Script,
      councilTwoStage: contracts.councilTwoStage.Script,
    };
    const [{ main: targetMain, staging: stagingUtxo }, found] =
      yield* Effect.all(
        [twoStageUtxos(twoStage, networkId), contractUtxos(scripts, networkId)],
        { concurrency: "unbounded" },
      );
    yield* out.log("\nFound contract UTxOs:");
    yield* out.log("  Two stage: main and staging found");
    yield* out.log(
      `  Tech auth forever: ${found.at("techAuthForever").length}`,
    );
    yield* out.log(`  Council forever: ${found.at("councilForever").length}`);
    yield* out.log(`  Staging gov threshold: ${found.at("threshold").length}`);
    yield* out.log(
      `  Council two stage: ${found.at("councilTwoStage").length}`,
    );

    const councilMainUtxo = yield* found.main("councilTwoStage");
    const authority = yield* resolveAuthority(
      found,
      "Staging",
      contracts.stagingGovAuth.Script,
      sameUtxo(councilMainUtxo, targetMain)
        ? Option.none()
        : Option.some(councilMainUtxo),
      networkId,
      network,
    );

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );

    const txBuilder = yield* buildStageUpgradeTx(
      blaze,
      {
        target: {
          twoStage,
          mainUtxo: targetMain,
          stagingUtxo,
          scriptRef: Option.none(),
        },
        authority,
        userUtxo,
      },
      {
        field: "Logic",
        newHash: newLogicHash,
        networkId,
        changeAddress,
        feePadding: input.feePadding,
      },
    );
    const required = requiredSignatures(authority);
    const tx = yield* buildTx(txBuilder, {
      commandName: "stage-upgrade",
      environment: network,
      witnesses: witnessCount(signer, required),
      knownUtxos: [
        stagingUtxo,
        targetMain,
        authority.thresholdUtxo,
        authority.techAuthForeverUtxo,
        authority.councilForeverUtxo,
        ...Option.toArray(authority.councilMainUtxo),
        userUtxo,
      ],
    });

    yield* signAndWrite(tx, outputPath, signer, "Stage Upgrade Transaction");

    yield* applyRecord(network, record);
    return tx;
  });
