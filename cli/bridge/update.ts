/**
 * bridge-update: a light-client update from a BridgeUpdate JSON file (the
 * --update schema in `cli/datum/bridge.ts`), built (never submitted) and
 * written unsigned for the deployer, who submits it and pays the fee. With
 * --funded, a handover spends every pool UTxO and the pool pays the fee up
 * to the cap: a first build with no debit measures the fee, the second
 * debits min(fee, cap) and keeps the fee at least that (rule 16).
 */
import {
  addressFromValidator,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect, Option } from "effect";
import { buildTx } from "../chain/complete-tx";
import { upgradeScripts, upgradeStateAt } from "../chain/governance-provider";
import { Provider } from "../chain/provider";
import { DEPLOYER_ONLY } from "../chain/transaction";
import { writeTransaction } from "../chain/tx-file";
import { environmentOf } from "../config/network-mapping";
import { BridgeUpdateJson, nextBridgeState } from "../datum/bridge";
import { InputParseError, PreconditionFailed } from "../errors";
import { readJsonFile, type TxFileInput, txFilePath } from "../input";
import { Output } from "../output";
import {
  beefyThresholdAt,
  bridgeScripts,
  bridgeStateAt,
  bridgeUtxos,
  referenceScripts,
} from "./bridge-chain";
import {
  type BridgeUpdateInputs,
  buildBridgeUpdateTx,
  type PoolFunding,
} from "./bridge-tx";

/** The update file, whether the pool pays, and where the transaction goes. */
export interface BridgeUpdateInput extends TxFileInput {
  readonly update: string;
  readonly funded: boolean;
}

/** Resolve the light client and its scripts, build the update (funded: twice, to set the debit) and write it unsigned. */
export const bridgeUpdateProgram = (input: BridgeUpdateInput) =>
  Effect.gen(function* () {
    const { network, funded } = input;
    const out = yield* Output;
    const { networkId } = environmentOf(network);
    const update = yield* readJsonFile(
      input.update,
      BridgeUpdateJson,
      (reason) => new InputParseError({ source: "--update", issues: [reason] }),
    );
    const scripts = yield* bridgeScripts;
    const utxos = yield* bridgeUtxos(scripts, networkId);
    const stateIn = yield* bridgeStateAt(utxos.lightClient);
    const upgrade = yield* upgradeStateAt(utxos.main);
    const { logic, mitigationLogic } = yield* upgradeScripts(
      upgrade,
      scripts.logic.hash(),
    );
    const stateOut = nextBridgeState(stateIn, update);
    const handover =
      stateOut.next_committee.validator_set_id !==
      stateIn.next_committee.validator_set_id;
    const signers = update.signatures.filter((sig) => sig !== "").length;

    yield* out.log(`\nCommittee bridge update on ${network}`);
    yield* out.log(
      `Update: block ${update.block_number}, signed by set ${update.validator_set_id} (${signers} of ${update.signatures.length} leaves)`,
    );
    yield* out.log(
      `Light client height: ${stateIn.latest_height} -> ${stateOut.latest_height}`,
    );
    yield* out.log(
      handover
        ? `Handover: set ${stateOut.current_committee.validator_set_id} becomes current, set ${stateOut.next_committee.validator_set_id} next`
        : "No handover",
    );

    if (funded && !handover) {
      return yield* new PreconditionFailed({
        command: "bridge-update",
        refusal: {
          _tag: "FundedNotHandover",
          leafNext: update.leaf.next_authority_set.validator_set_id,
          next: stateIn.next_committee.validator_set_id,
        },
      });
    }
    if (funded && utxos.pool.length === 0) {
      return yield* new PreconditionFailed({
        command: "bridge-update",
        refusal: {
          _tag: "PoolEmpty",
          address: addressFromValidator(networkId, scripts.pool).toBech32(),
        },
      });
    }

    const scriptRefs = yield* referenceScripts([
      scripts.forever.hash(),
      upgrade.logicHash,
      ...(funded ? [scripts.pool.hash()] : []),
    ]);
    const inputs: BridgeUpdateInputs = {
      forever: scripts.forever,
      logic,
      mitigationLogic,
      pool: scripts.pool,
      foreverUtxo: utxos.lightClient,
      mainUtxo: utxos.main,
      thresholdUtxo: utxos.threshold,
      scriptRefs,
    };
    const blaze = yield* Effect.flatMap(Provider, (p) => p.blaze);
    const build = (
      funding: Option.Option<PoolFunding>,
      knownUtxos?: readonly TransactionUnspentOutput[],
    ) =>
      buildTx(
        buildBridgeUpdateTx(
          blaze,
          inputs,
          update,
          stateOut,
          funding,
          networkId,
        ),
        {
          commandName: "bridge-update",
          environment: network,
          witnesses: DEPLOYER_ONLY,
          knownUtxos,
        },
      );
    const known = [
      utxos.lightClient,
      utxos.main,
      utxos.threshold,
      ...scriptRefs,
      ...(funded ? utxos.pool : []),
    ];

    const tx = funded
      ? yield* Effect.gen(function* () {
          const measured = yield* build(
            Option.some({ poolUtxos: utxos.pool, debit: 0n }),
            known,
          );
          const threshold = yield* beefyThresholdAt(utxos.threshold);
          const fee = measured.body().fee();
          const cap = threshold.base + threshold.per_signer * BigInt(signers);
          const debit = fee < cap ? fee : cap;
          yield* out.log(
            `Pool: pays ${debit} lovelace (measured fee ${fee}, cap ${cap}) from ${utxos.pool.length} UTxO(s)`,
          );
          // The local UPLC phase evaluates a draft at fee 0, below the debit: rule 16 fails it.
          return yield* build(Option.some({ poolUtxos: utxos.pool, debit }));
        })
      : yield* Effect.zipLeft(
          build(Option.none(), known),
          out.log("Unfunded: the deployer pays the fee"),
        );

    yield* writeTransaction(
      txFilePath(input),
      tx.toCbor(),
      tx.getId(),
      false,
      "Bridge Update",
    );
    return tx;
  });
