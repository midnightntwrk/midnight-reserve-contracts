/**
 * change-federated-ops: replace the permissioned candidates in the
 * federated-ops forever datum. The program resolves the forever, threshold,
 * council and tech-auth UTxOs and the two-stage UpgradeState; the datum's
 * own shape (v1 or v2) is kept, since migrate-federated-ops can change it
 * without bumping the two-stage logicRound.
 * planFederatedOpsChange is pure over the resolved inputs and compile
 * completes it.
 */
import {
  type Address,
  addressFromValidator,
  type NetworkId,
} from "@blaze-cardano/core";
import { Effect, Either, Option, Record } from "effect";
import { environmentOf, slotConfigOf } from "../config/network-mapping";
import { contractUtxos, deployerUtxo, deployerWallet } from "../chain/utxo";
import { signersAt, thresholdAt } from "./authority";
import {
  decodeFederatedOps,
  encodeFederatedOps,
  type FederatedOpsData,
  type PermissionedCandidate,
} from "../datum/federated-ops";
import { inlineDatum } from "../datum/inline";
import { signAndWrite, signerFor, witnessCount } from "../signing/signer";
import { compile } from "../tx/compile";
import type { TxPlan } from "../tx/plan";
import { logicRound as datumLogicRound } from "../datum/datum-versions";
import { witnessRequirements } from "./threshold";
import {
  type GovernedForeverInputs,
  planGovernedForeverUpdate,
} from "./governed-forever";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { twoStageLogic } from "./two-stage";
import { Blueprint } from "../contracts/contracts";
import { permissionedCandidates } from "../config/intent-env";
import { Output } from "../output";
import { PreconditionFailed } from "../errors";

const COMMAND = "change-federated-ops";

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
}

/** The change: the governed forever update with the new candidate list. */
export const planFederatedOpsChange = (
  inputs: FederatedOpsChangeInputs,
  params: FederatedOpsChangeParams,
): TxPlan =>
  planGovernedForeverUpdate(
    inputs,
    encodeFederatedOps({
      ...inputs.currentData,
      candidates: params.newCandidates,
    }),
    params,
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

/** What the federated ops change plan is built from and where its change goes. */
export interface ResolvedFederatedOpsChange {
  readonly inputs: FederatedOpsChangeInputs;
  readonly params: FederatedOpsChangeParams;
  readonly changeAddress: Address;
}

/** Read and report everything the change needs: the forever, threshold, authority and two-stage UTxOs, the current datum, both authorities' signers, the new candidates, the threshold's requirements and the fee UTxO. */
export const resolveFederatedOpsChange = (input: FederatedOpsChangeInput) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex } = input;
    const out = yield* Output;
    const blueprint = yield* Blueprint;

    yield* out.log(`\nChanging Federated Ops members on ${network} network`);
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const contracts = yield* blueprint.instances;
    const forever = contracts.federatedOpsForever.Script;
    const foreverAddress = addressFromValidator(networkId, forever);
    yield* out.log(
      `\nFederated Ops Forever Address: ${foreverAddress.toBech32()}`,
    );

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

    const newCandidates = yield* permissionedCandidates;
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
    const { techAuth, council } = requirements;
    yield* out.log(
      `\nRequired tech auth signers: ${techAuth.required}/${techAuth.total}`,
    );
    yield* out.log(
      `Required council signers: ${council.required}/${council.total}`,
    );
    const resolved: ResolvedFederatedOpsChange = {
      inputs: {
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
      },
      params: { newCandidates, networkId },
      changeAddress,
    };
    return resolved;
  });

/** Resolve, plan, compile and write the change transaction. */
export const federatedOpsChangeProgram = (input: FederatedOpsChangeInput) =>
  Effect.gen(function* () {
    const signer = yield* signerFor(input.sign, "both");
    const { inputs, params, changeAddress } =
      yield* resolveFederatedOpsChange(input);
    const plan = planFederatedOpsChange(inputs, params);
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
      "Change Federated Ops Transaction",
    );
    return tx;
  });
