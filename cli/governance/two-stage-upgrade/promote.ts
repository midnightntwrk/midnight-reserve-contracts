/**
 * promote-upgrade: copy a staged UpgradeState field of a two-stage validator
 * into its main UTxO. The transaction is the target step (spend the main
 * UTxO, reference staging, write the promoted state), the fee UTxO and the
 * governance authority, and registers the promoted logic's stake credential
 * when the chain lacks it. The program keeps the deployed-scripts snapshot in
 * step with the chain.
 */
import { serialize } from "@blaze-cardano/data";
import {
  type Address,
  addressFromValidator,
  type NetworkId,
  type Script,
} from "@blaze-cardano/core";
import { Effect, Either, Option } from "effect";
import { environmentOf, slotConfigOf } from "../../config/network-mapping";
import { Blueprint, type UpgradableValidator } from "../../contracts/contracts";
import { contractUtxos, deployerUtxo, deployerWallet } from "../../chain/utxo";
import { rewardAccountRegistered } from "../../chain/registration";
import {
  MAIN_TOKEN_HEX,
  rawUpgradeStateAt,
  twoStageUtxos,
  upgradeStateAt,
} from "../two-stage";
import { createRewardAccount } from "../../tx/scripts";
import { signAndWrite, signerFor, witnessCount } from "../../signing/signer";
import { Output } from "../../output";
import { compile } from "../../tx/compile";
import type { TxPlan } from "../../tx/plan";
import { type FeeInput, type TxFileInput, txFilePath } from "../../input";
import type { DatumParseError } from "../../errors";
import * as Contracts from "../../../contract_blueprint";
import { governanceAuthorityPlan, resolveAuthority } from "../authority";
import { applyRecord, type LogicRecord, promoteRecord } from "./logic-record";
import {
  outputRef,
  promotedMainState,
  twoStageOutput,
  type TwoStageStep,
  twoStageStep,
  type TwoStageTarget,
  type UpgradeField,
  type UpgradeInputs,
} from "./state";

const COMMAND = "promote-upgrade";

/** What the promotion is for: the field, the network and the promoted logic to register as a stake credential in the same transaction. */
export interface PromoteUpgradeParams {
  readonly field: UpgradeField;
  readonly networkId: NetworkId;
  readonly registerLogic: Option.Option<Script>;
}

/** Spend the target's main UTxO into the promoted state, referencing staging. */
const promoteStep = (
  target: TwoStageTarget,
  field: UpgradeField,
  networkId: NetworkId,
): Either.Either<TwoStageStep, DatumParseError> =>
  Either.map(
    Either.all([
      rawUpgradeStateAt(target.mainUtxo),
      rawUpgradeStateAt(target.stagingUtxo),
    ]),
    ([main, staging]) =>
      twoStageStep(
        target,
        target.mainUtxo,
        serialize(Contracts.TwoStageRedeemer, [
          field,
          { Main: [outputRef(target.stagingUtxo.input())] },
        ]),
        target.stagingUtxo,
        twoStageOutput(
          target,
          target.mainUtxo,
          MAIN_TOKEN_HEX,
          promotedMainState(field, main, staging),
          networkId,
        ),
      ),
  );

/** The promote transaction: one target step, the fee UTxO, the authority, optionally the logic registration. */
export const planPromote = (
  inputs: UpgradeInputs,
  params: PromoteUpgradeParams,
): Either.Either<TxPlan, DatumParseError> =>
  Either.map(
    promoteStep(inputs.target, params.field, params.networkId),
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
        registrations: Option.toArray(params.registerLogic),
        collateral: [],
        requiredSignatures: authority.requiredSignatures,
      };
    },
  );

/** A promotion: the validator, its fee UTxO, whether to sign, and where the file goes. */
export interface PromoteUpgradeInput extends TxFileInput, FeeInput {
  readonly validator: UpgradableValidator;
  readonly sign: boolean;
}

/** What the promote plan is built from, where its change goes and the record update that follows it. */
export interface ResolvedPromote {
  readonly inputs: UpgradeInputs;
  readonly params: PromoteUpgradeParams;
  readonly changeAddress: Address;
  readonly record: LogicRecord;
}

/** Read and report everything the promotion needs: the target's UTxOs, the authority, the staged logic (registered in this transaction when the chain lacks it) and the fee UTxO. */
export const resolvePromote = (input: PromoteUpgradeInput) =>
  Effect.gen(function* () {
    const { network, validator, txHash, txIndex } = input;
    const out = yield* Output;
    const blueprint = yield* Blueprint;

    yield* out.log(
      `\nPromoting staged upgrade to main for ${validator} on ${network} network`,
    );
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

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
      threshold: contracts.mainGovThreshold.Script,
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
    yield* out.log(`  Main gov threshold: ${found.at("threshold").length}`);

    const authority = yield* resolveAuthority(
      found,
      "Main",
      contracts.govAuth.Script,
      Option.none(),
      networkId,
      network,
    );
    yield* out.log("Reading staging state...");
    const stagedLogicHash = (yield* upgradeStateAt(stagingUtxo)).logicHash;
    yield* out.log(`\nStaged logic hash to promote: ${stagedLogicHash}`);
    const record = yield* promoteRecord(network, stagedLogicHash);

    // Governance withdraws through the promoted logic next; register it here when the chain lacks it.
    const registered = yield* rewardAccountRegistered(
      createRewardAccount(stagedLogicHash, networkId),
      network,
    );
    const registerLogic = registered
      ? Option.none<Script>()
      : Option.some(
          yield* blueprint.scriptByHash(
            stagedLogicHash,
            `Staged logic script ${stagedLogicHash} not found in the ${blueprint.source} blueprint` +
              (blueprint.source === "build"
                ? ""
                : `; stage it again with stage-upgrade, which copies it from the build into deployed-scripts/${network}`),
          ),
        );
    if (Option.isSome(registerLogic)) {
      yield* out.log(
        "\n  Promoted logic hash not yet registered as stake credential.",
      );
      yield* out.log(`  Will register ${stagedLogicHash} in this transaction.`);
    }

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const resolved: ResolvedPromote = {
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
      params: { field: "Logic", networkId, registerLogic },
      changeAddress,
      record,
    };
    return resolved;
  });

/** Resolve, plan, compile and write the promote transaction; then track the promoted validator. */
export const promoteUpgradeProgram = (input: PromoteUpgradeInput) =>
  Effect.gen(function* () {
    const signer = yield* signerFor(input.sign, "both");
    const { inputs, params, changeAddress, record } =
      yield* resolvePromote(input);
    const plan = yield* planPromote(inputs, params);
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
      "Promote Upgrade Transaction",
    );

    yield* applyRecord(input.network, record);
    return tx;
  });
