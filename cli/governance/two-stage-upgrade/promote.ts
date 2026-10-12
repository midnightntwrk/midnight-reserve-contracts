/**
 * promote-upgrade: copy a staged UpgradeState field of a two-stage validator
 * into its main UTxO. The transaction is the target step (spend the main
 * UTxO, reference staging, write the promoted state) plus the governance
 * authority, and registers the promoted logic's stake credential when the
 * chain lacks it. The program keeps the deployed-scripts snapshot in step
 * with the chain.
 */
import { serialize } from "@blaze-cardano/data";
import {
  type Address,
  addressFromValidator,
  type NetworkId,
  type Script,
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
import { rewardAccountRegistered } from "../../chain/registration";
import {
  MAIN_TOKEN_HEX,
  rawUpgradeStateAt,
  twoStageUtxos,
  upgradeStateAt,
} from "../two-stage";
import {
  createRewardAccount,
  createTxMetadata,
  registerScriptStake,
} from "../../tx/scripts";
import { signAndWrite, signerFor, witnessCount } from "../../signing/signer";
import { Output } from "../../output";
import { buildTx } from "../../tx/complete-tx";
import { type FeeInput, type TxFileInput, txFilePath } from "../../input";
import { Provider } from "../../chain/provider";
import type { DatumParseError } from "../../errors";
import * as Contracts from "../../../contract_blueprint";
import {
  requiredSignatures,
  resolveAuthority,
  withGovernanceAuthority,
} from "../authority";
import { applyRecord, promoteRecord } from "./logic-record";
import {
  outputRef,
  promotedMainState,
  twoStageOutput,
  type TwoStageTarget,
  type UpgradeField,
  type UpgradeInputs,
  withTwoStageScript,
} from "./state";

export interface PromoteUpgradeParams {
  readonly field: UpgradeField;
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
  /** The promoted logic script to register as a stake credential in the same transaction. */
  readonly registerLogic: Option.Option<Script>;
}

/** Spend the target's main UTxO into the promoted state, referencing staging. */
const promoteUpgradeStep = (
  txBuilder: TxBuilder,
  target: TwoStageTarget,
  field: UpgradeField,
  networkId: NetworkId,
): Either.Either<TxBuilder, DatumParseError> =>
  Either.map(
    Either.all([
      rawUpgradeStateAt(target.mainUtxo),
      rawUpgradeStateAt(target.stagingUtxo),
    ]),
    ([main, staging]) => {
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        field,
        { Main: [outputRef(target.stagingUtxo.input())] },
      ]);
      return withTwoStageScript(
        txBuilder
          .addInput(target.mainUtxo, redeemer)
          .addReferenceInput(target.stagingUtxo)
          .addOutput(
            twoStageOutput(
              target,
              target.mainUtxo,
              MAIN_TOKEN_HEX,
              promotedMainState(field, main, staging),
              networkId,
            ),
          ),
        target,
      );
    },
  );

/** The promote transaction: one target step, the fee UTxO, the authority, optionally the logic registration. */
export const buildPromoteUpgradeTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: UpgradeInputs,
  params: PromoteUpgradeParams,
): Either.Either<TxBuilder, DatumParseError> =>
  Either.gen(function* () {
    const stepped = yield* promoteUpgradeStep(
      blaze.newTransaction(),
      inputs.target,
      params.field,
      params.networkId,
    );
    const authorized = withGovernanceAuthority(
      stepped.addInput(inputs.userUtxo),
      inputs.authority,
      params.networkId,
    );
    const txBuilder = authorized
      .setChangeAddress(params.changeAddress)
      .setMetadata(createTxMetadata("promote-upgrade"))
      .setFeePadding(params.feePadding);
    return Option.match(params.registerLogic, {
      onNone: () => txBuilder,
      onSome: (logic) => registerScriptStake(txBuilder, logic),
    });
  });

/** A promotion: the validator, its fee UTxO, whether to sign, and where the file goes. */
export interface PromoteUpgradeInput extends TxFileInput, FeeInput {
  readonly validator: UpgradableValidator;
  readonly sign: boolean;
}

/** Resolve the inputs, build, complete and write the promote transaction; then track the promoted validator. */
export const promoteUpgradeProgram = (input: PromoteUpgradeInput) =>
  Effect.gen(function* () {
    const { network, validator, sign, txHash, txIndex } = input;
    const signer = yield* signerFor(sign, "both");
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);

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

    const blaze = yield* provider.blazeFor(yield* deployerWallet);
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
    const txBuilder = yield* buildPromoteUpgradeTx(
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
        networkId,
        changeAddress,
        feePadding: input.feePadding,
        registerLogic,
      },
    );
    const required = requiredSignatures(authority);
    const tx = yield* buildTx(txBuilder, {
      commandName: "promote-upgrade",
      environment: network,
      witnesses: witnessCount(signer, required),
      knownUtxos: [
        targetMain,
        stagingUtxo,
        authority.thresholdUtxo,
        authority.techAuthForeverUtxo,
        authority.councilForeverUtxo,
        userUtxo,
      ],
    });

    yield* signAndWrite(tx, outputPath, signer, "Promote Upgrade Transaction");

    yield* applyRecord(network, record);
    return tx;
  });
