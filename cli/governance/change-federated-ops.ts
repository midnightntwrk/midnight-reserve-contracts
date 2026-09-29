/**
 * change-federated-ops: replace the permissioned candidates in the
 * federated-ops forever datum. The program resolves the forever, threshold,
 * council and tech-auth UTxOs and the two-stage UpgradeState; the datum's
 * own shape (v1 or v2) is kept, since migrate-federated-ops can change it
 * without bumping the two-stage logicRound.
 * buildFederatedOpsChangeTx is pure over the resolved inputs.
 */
import {
  type Address,
  addressFromValidator,
  type NetworkId,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Either, Record } from "effect";
import { environmentOf } from "../config/network-mapping";
import {
  contractUtxos,
  deployerUtxo,
  signersAt,
  thresholdAt,
} from "../chain/governance-provider";
import {
  decodeFederatedOps,
  encodeFederatedOps,
  type FederatedOpsData,
  type PermissionedCandidate,
} from "../datum/federated-ops";
import {
  inlineDatum,
  signAndWrite,
  signerFor,
  witnessCount,
} from "../chain/transaction";
import { buildTx } from "../chain/complete-tx";
import { logicRound as datumLogicRound } from "../datum/datum-versions";
import { witnessRequirements } from "./threshold";
import {
  buildGovernedForeverUpdateTx,
  type GovernedForeverInputs,
} from "./governed-forever";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { twoStageLogic } from "./change-multisig";
import { Blueprint } from "../contracts/contracts";
import { Settings } from "../config/settings";
import { Output } from "../output";
import { Provider } from "../chain/provider";
import { PreconditionFailed } from "../errors";

/** A federated ops change: its fee UTxO, whether to sign, and where the file goes. */
export interface FederatedOpsChangeInput extends TxFileInput, FeeInput {
  readonly sign: boolean;
}

/** What the transaction is built from: the governed forever update's inputs and the decoded forever datum. */
export interface FederatedOpsChangeInputs extends GovernedForeverInputs {
  readonly currentData: FederatedOpsData;
}

export interface FederatedOpsChangeParams {
  readonly newCandidates: readonly PermissionedCandidate[];
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
}

/** The change transaction: the governed forever update with the new candidate list. */
export const buildFederatedOpsChangeTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: FederatedOpsChangeInputs,
  params: FederatedOpsChangeParams,
): TxBuilder =>
  buildGovernedForeverUpdateTx(
    blaze,
    inputs,
    encodeFederatedOps({
      ...inputs.currentData,
      candidates: params.newCandidates,
    }),
    { ...params, txType: "change-federated-ops" },
  );

const QUERY = {
  federatedOpsForever: "Federated ops forever",
  federatedOpsThreshold: "Federated ops threshold",
  councilForever: "Council forever",
  techAuthForever: "Tech auth forever",
  federatedOpsTwoStage: "Federated ops two stage",
} as const;

/** A datum older than the active v2 logic (round 2 or above) must be migrated first. */
export const requireMigratedDatum = (
  datumRound: number,
  logicRound: number,
): Either.Either<void, PreconditionFailed> =>
  logicRound >= 2 && datumRound < logicRound
    ? Either.left(
        new PreconditionFailed({
          command: "change-federated-ops",
          refusal: { _tag: "DatumNotMigrated", datumRound, logicRound },
        }),
      )
    : Either.void;

/** Resolve the inputs, build, complete and write the change transaction. */
export const federatedOpsChangeProgram = (input: FederatedOpsChangeInput) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex, sign } = input;
    const signer = yield* signerFor(sign, "both");
    const out = yield* Output;
    const cfg = yield* Settings;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);

    yield* out.log(`\nChanging Federated Ops members on ${network} network`);
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const contracts = yield* blueprint.instances;
    const forever = contracts.federatedOpsForever.Script;
    const foreverAddress = addressFromValidator(networkId, forever);
    yield* out.log(
      `\nFederated Ops Forever Address: ${foreverAddress.toBech32()}`,
    );

    const blaze = yield* provider.blaze;
    const scripts = {
      federatedOpsForever: forever,
      federatedOpsThreshold: contracts.mainFederatedOpsUpdateThreshold.Script,
      councilForever: contracts.councilForever.Script,
      techAuthForever: contracts.techAuthForever.Script,
      federatedOpsTwoStage: contracts.federatedOpsTwoStage.Script,
    };
    const found = yield* contractUtxos(scripts, networkId);
    yield* out.log("\nFound contract UTxOs:");
    for (const [key, label] of Record.toEntries(QUERY)) {
      yield* out.log(`  ${label}: ${found.at(key).length}`);
    }

    const foreverUtxo = yield* found.first("federatedOpsForever");
    const thresholdUtxo = yield* found.first("federatedOpsThreshold");
    const councilForeverUtxo = yield* found.first("councilForever");
    const techAuthForeverUtxo = yield* found.first("techAuthForever");
    const twoStageUtxo = yield* found.main("federatedOpsTwoStage");

    const { logicRound, logicScript, mitigationLogicScript } =
      yield* twoStageLogic(
        "federated ops",
        twoStageUtxo,
        contracts.federatedOpsLogic.Script.hash(),
        networkId,
      );

    yield* out.log("\nDecoding federated ops forever datum (version-aware)...");
    const foreverDatum = yield* inlineDatum(foreverUtxo, "FederatedOps");
    const datumRound = yield* datumLogicRound(foreverDatum);
    yield* requireMigratedDatum(datumRound, logicRound);
    const currentData = yield* decodeFederatedOps(foreverDatum);
    yield* out.log(
      `  Current candidates count: ${currentData.candidates.length}`,
    );

    yield* out.log("\nReading current council state for ML-3 validation...");
    const councilSigners = yield* signersAt(councilForeverUtxo);
    yield* out.log("\nReading current tech auth state for ML-3 validation...");
    const techAuthSigners = yield* signersAt(techAuthForeverUtxo);

    const newCandidates = yield* cfg.permissionedCandidates;
    yield* out.log(
      `\nNew federated ops candidates count: ${newCandidates.length}`,
    );

    yield* out.log("\nReading federated ops update threshold...");
    const threshold = yield* thresholdAt(thresholdUtxo);
    const requirements = witnessRequirements(threshold, {
      techAuthSigners,
      councilSigners,
    });

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const inputs: FederatedOpsChangeInputs = {
      forever,
      foreverUtxo,
      thresholdUtxo,
      councilForeverUtxo,
      techAuthForeverUtxo,
      twoStageUtxo,
      userUtxo,
      logicScript,
      mitigationLogicScript,
      logicRound,
      currentData,
      councilSigners,
      techAuthSigners,
      requirements,
    };
    const { techAuth, council } = requirements;
    yield* out.log(
      `\nRequired tech auth signers: ${techAuth.required}/${techAuth.total}`,
    );
    yield* out.log(
      `Required council signers: ${council.required}/${council.total}`,
    );

    const txBuilder = buildFederatedOpsChangeTx(blaze, inputs, {
      newCandidates,
      networkId,
      changeAddress,
      feePadding: input.feePadding,
    });
    const tx = yield* buildTx(txBuilder, {
      commandName: "change-federated-ops",
      witnesses: witnessCount(signer, techAuth.required + council.required),
      knownUtxos: [
        foreverUtxo,
        thresholdUtxo,
        councilForeverUtxo,
        techAuthForeverUtxo,
        twoStageUtxo,
        userUtxo,
      ],
    });
    yield* signAndWrite(
      tx,
      outputPath,
      signer,
      "Change Federated Ops Transaction",
    );
    return tx;
  });
