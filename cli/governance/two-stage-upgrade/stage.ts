/**
 * stage-upgrade: move one field of a two-stage validator's UpgradeState into
 * its staging UTxO. The transaction is the target step (spend the staging
 * UTxO, reference main, write the next state), the fee UTxO and the
 * governance authority. The program resolves everything through
 * Provider/Blueprint and keeps the deployed-scripts snapshot in step with the
 * chain.
 */
import { serialize } from "@blaze-cardano/data";
import {
  type Address,
  addressFromValidator,
  type NetworkId,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect, Either, Option } from "effect";
import { environmentOf, slotConfigOf } from "../../config/network-mapping";
import { Blueprint, type UpgradableValidator } from "../../contracts/contracts";
import { contractUtxos, deployerUtxo, deployerWallet } from "../../chain/utxo";
import {
  STAGING_TOKEN_HEX,
  rawUpgradeStateAt,
  twoStageUtxos,
} from "../two-stage";
import { signAndWrite, signerFor, witnessCount } from "../../signing/signer";
import { Output } from "../../output";
import { compile } from "../../tx/compile";
import type { TxPlan } from "../../tx/plan";
import { buildOutput, PROJECT_ROOT } from "../../contracts/paths";
import { isPromoted } from "../../contracts/snapshot/read";
import {
  type FeeInput,
  type ScriptHash,
  type TxFileInput,
  txFilePath,
} from "../../input";
import type { DatumParseError } from "../../errors";
import * as Contracts from "../../../contract_blueprint";
import { governanceAuthorityPlan, resolveAuthority } from "../authority";
import {
  applyRecord,
  type LogicRecord,
  logicToStage,
  prepareLogicCopy,
  stageRecord,
} from "./logic-record";
import {
  nextStagingState,
  outputRef,
  twoStageOutput,
  type TwoStageStep,
  twoStageStep,
  type TwoStageTarget,
  type UpgradeField,
  type UpgradeInputs,
} from "./state";

const COMMAND = "stage-upgrade";

/** What the stage is for: the field, the hash to stage in it and the network. */
export interface StageUpgradeParams {
  readonly field: UpgradeField;
  readonly newHash: string;
  readonly networkId: NetworkId;
}

/** Spend the target's staging UTxO into its next state, referencing main. */
export const stageStep = (
  target: TwoStageTarget,
  field: UpgradeField,
  newHash: string,
  networkId: NetworkId,
): Either.Either<TwoStageStep, DatumParseError> =>
  Either.map(rawUpgradeStateAt(target.stagingUtxo), (current) =>
    twoStageStep(
      target,
      target.stagingUtxo,
      serialize(Contracts.TwoStageRedeemer, [
        field,
        { Staging: [outputRef(target.mainUtxo.input()), newHash] },
      ]),
      target.mainUtxo,
      twoStageOutput(
        target,
        target.stagingUtxo,
        STAGING_TOKEN_HEX,
        nextStagingState(field, current, newHash),
        networkId,
      ),
    ),
  );

/** The stage transaction: one target step, the fee UTxO, the authority. */
export const planStage = (
  inputs: UpgradeInputs,
  params: StageUpgradeParams,
): Either.Either<TxPlan, DatumParseError> =>
  Either.map(
    stageStep(inputs.target, params.field, params.newHash, params.networkId),
    (step) => {
      const authority = governanceAuthorityPlan(
        inputs.authority,
        params.networkId,
      );
      return {
        spends: [
          ...step.spends,
          { utxo: inputs.userUtxo, redeemer: Option.none() },
        ],
        references: [...step.references, ...authority.references],
        scripts: step.scripts,
        mints: authority.mints,
        outputs: step.outputs,
        withdrawals: authority.withdrawals,
        registrations: [],
        collateral: [],
        requiredSignatures: authority.requiredSignatures,
      };
    },
  );

/** A stage: the validator and the logic hash to stage, its fee UTxO, whether to sign, where the file goes. */
export interface StageUpgradeInput extends TxFileInput, FeeInput {
  readonly validator: UpgradableValidator;
  readonly newLogicHash: ScriptHash;
  readonly sign: boolean;
}

const sameUtxo = (a: TransactionUnspentOutput, b: TransactionUnspentOutput) =>
  a.input().transactionId() === b.input().transactionId() &&
  a.input().index() === b.input().index();

/** What the stage plan is built from, where its change goes and the record update that follows it. */
export interface ResolvedStage {
  readonly inputs: UpgradeInputs;
  readonly params: StageUpgradeParams;
  readonly changeAddress: Address;
  readonly record: LogicRecord;
}

/** Read and report everything the stage needs: the logic to stage (a build-only one is prepared for the record), the target's UTxOs, the authority and the fee UTxO. */
export const resolveStage = (input: StageUpgradeInput) =>
  Effect.gen(function* () {
    const { network, validator, newLogicHash, txHash, txIndex } = input;
    const out = yield* Output;
    const blueprint = yield* Blueprint;
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
    const resolved: ResolvedStage = {
      inputs: {
        target: {
          twoStage,
          mainUtxo: targetMain,
          stagingUtxo,
          scriptRef: Option.none(),
        },
        authority,
        userUtxo,
      },
      params: { field: "Logic", newHash: newLogicHash, networkId },
      changeAddress,
      record,
    };
    return resolved;
  });

/** Resolve, plan, compile and write the stage transaction; then, where the environment keeps a record, copy a logic that only the build has into it and track it as staged. */
export const stageUpgradeProgram = (input: StageUpgradeInput) =>
  Effect.gen(function* () {
    const signer = yield* signerFor(input.sign, "both");
    const { inputs, params, changeAddress, record } =
      yield* resolveStage(input);
    const plan = yield* planStage(inputs, params);
    const tx = yield* compile(plan, {
      commandName: COMMAND,
      slotConfig: slotConfigOf(input.network),
      wallet: yield* deployerWallet,
      changeAddress,
      feePadding: input.feePadding,
      metadata: Option.some(COMMAND),
      expectedWitnesses: witnessCount(signer, plan.requiredSignatures),
      contracts: yield* Effect.flatMap(Blueprint, (b) => b.contracts),
    });
    yield* signAndWrite(
      tx,
      txFilePath(input),
      signer,
      "Stage Upgrade Transaction",
    );

    yield* applyRecord(input.network, record);
    return tx;
  });
