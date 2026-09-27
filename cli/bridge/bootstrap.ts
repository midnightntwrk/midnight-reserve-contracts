/**
 * The committee bridge's bootstrap from a Midnight node (MIP §Bootstrap):
 * the MMR root in the digest of block `activation − 1`, and the committee
 * commitments `pallet-beefy-mmr` holds at block `activation` (the set active
 * there and the one queued). bridge-bootstrap prints them as the deploy's
 * .env values. bridge-verify-bootstrap recomputes them for the deployed
 * light client, diffs every field, and confirms against `mmr_generateProof`
 * that the leaf of block `b = activation` is at index `b − 1` of `b`.
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import { Brand, Effect, Either } from "effect";
import { requireOnChainNetwork } from "../chain/provider";
import { environmentOf } from "../config/network-mapping";
import {
  type BootstrapValues,
  bootstrapState,
  committeeEnv,
} from "../datum/bridge";
import { PreconditionFailed, VerificationFailed } from "../errors";
import type { Hash32, NetworkInput } from "../input";
import { formatTable, Output } from "../output";
import { bridgeScripts, bridgeStateAt, bridgeUtxos } from "./bridge-chain";
import { committeeText } from "./info";
import {
  authoritySetAt,
  blockHash,
  digestMmrRoot,
  finalizedNumber,
  leafProofAt,
} from "./midnight";

const notMip = (detail: string) =>
  new PreconditionFailed({
    command: "Midnight node",
    refusal: { _tag: "MidnightNotMip", detail },
  });

/** The bootstrap BeefyConsensusState of activation block `activation`, read from final state. */
export const midnightBootstrap = (rpc: string, activation: number) =>
  Effect.gen(function* () {
    const finalized = yield* finalizedNumber(rpc);
    if (activation > finalized)
      return yield* new PreconditionFailed({
        command: "Midnight node",
        refusal: { _tag: "ActivationNotFinal", activation, finalized },
      });
    const before = yield* blockHash(rpc, activation - 1);
    const at = yield* blockHash(rpc, activation);
    const root = yield* digestMmrRoot(rpc, before);
    const values: BootstrapValues = {
      activationBlock: BigInt(activation),
      mmrRoot: Brand.nominal<Hash32>()(bytesToHex(root)),
      current: yield* authoritySetAt(rpc, at, false),
      next: yield* authoritySetAt(rpc, at, true),
    };
    return yield* Either.mapLeft(bootstrapState(values), notMip);
  });

/** The node to read and the activation block. */
export interface BridgeBootstrapInput {
  readonly rpc: string;
  readonly activation: bigint;
}

/** Print the bootstrap state and its .env lines. */
export const bridgeBootstrapProgram = (input: BridgeBootstrapInput) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const state = yield* midnightBootstrap(input.rpc, Number(input.activation));
    yield* Effect.forEach(
      [
        `\nCommittee bridge bootstrap from ${input.rpc}`,
        `  Activation block: ${state.beefy_activation_block}`,
        `  MMR root in the digest of block ${state.latest_height}: ${state.latest_mmr_root}`,
        `  Current committee: ${committeeText(state.current_committee)}`,
        `  Next committee: ${committeeText(state.next_committee)}`,
        `\nFor the deploy's .env:`,
        `BRIDGE_ACTIVATION_BLOCK=${state.beefy_activation_block}`,
        `BRIDGE_MMR_ROOT=${state.latest_mmr_root}`,
        `BRIDGE_CURRENT_COMMITTEE=${committeeEnv(state.current_committee)}`,
        `BRIDGE_NEXT_COMMITTEE=${committeeEnv(state.next_committee)}`,
      ],
      (line) => out.log(line),
      { discard: true },
    );
  });

/** The environment of the deployed light client and the node to read. */
export interface BridgeVerifyBootstrapInput extends NetworkInput {
  readonly rpc: string;
}

/** Diff the deployed light client against its bootstrap recomputed from the node; VerificationFailed on any mismatch. */
export const bridgeVerifyBootstrapProgram = (
  input: BridgeVerifyBootstrapInput,
) =>
  Effect.gen(function* () {
    const { network, rpc } = input;
    yield* requireOnChainNetwork(network);
    const out = yield* Output;
    const { networkId } = environmentOf(network);
    const scripts = yield* bridgeScripts;
    const utxos = yield* bridgeUtxos(scripts, networkId);
    const deployed = yield* bridgeStateAt(utxos.lightClient);
    const b = Number(deployed.beefy_activation_block);
    const recomputed = yield* midnightBootstrap(rpc, b);
    const { leaf, proof } = yield* leafProofAt(
      rpc,
      b,
      yield* blockHash(rpc, b),
    );
    const rows = [
      ["latest_mmr_root", deployed.latest_mmr_root, recomputed.latest_mmr_root],
      [
        "latest_height",
        `${deployed.latest_height}`,
        `${recomputed.latest_height}`,
      ],
      [
        "beefy_activation_block",
        `${deployed.beefy_activation_block}`,
        `${recomputed.beefy_activation_block}`,
      ],
      [
        "current_committee",
        committeeEnv(deployed.current_committee),
        committeeEnv(recomputed.current_committee),
      ],
      [
        "next_committee",
        committeeEnv(deployed.next_committee),
        committeeEnv(recomputed.next_committee),
      ],
      [
        `leaf of block ${b}: index of count`,
        `${b - 1} of ${b}`,
        `${proof.leafIndices.join(",")} of ${proof.leafCount}`,
      ],
      [`leaf of block ${b}: parent`, `${b - 1}`, `${leaf.parentNumber}`],
    ].map(([check, cardano, midnight]) => [
      check,
      cardano,
      midnight,
      cardano === midnight ? "ok" : "MISMATCH",
    ]);
    yield* out.log(`\nCommittee bridge on ${network} against ${rpc}`);
    yield* Effect.forEach(
      formatTable(["check", "Cardano", "Midnight", ""], rows),
      (line) => out.log(line),
      { discard: true },
    );
    const failed = rows.filter((row) => row[3] !== "ok").length;
    if (failed > 0) return yield* new VerificationFailed({ failed });
    yield* out.success("The deployed light client is its recomputed bootstrap");
  });
