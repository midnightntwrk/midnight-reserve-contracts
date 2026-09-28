/**
 * pump: the data pump as a service, beside the node. Each round reads the
 * light client on Cardano; the first Midnight block of its next committee
 * is the next handover. Once BEEFY has finalized that block, the pump
 * builds the funded update from its justification, signs it with the
 * deployer key, submits it and awaits it, then starts the next round at
 * once, so a backlog lands oldest first. With nothing to hand over, or
 * after a failed round (logged), it waits `poll`.
 */
import { Duration, Effect, Option } from "effect";
import { awaitConfirmation, submitTx } from "../chain/submit";
import { attachWitnesses, signTransaction } from "../chain/transaction";
import { type Environment, environmentOf } from "../config/network-mapping";
import { Settings } from "../config/settings";
import { renderError } from "../errors";
import { Output } from "../output";
import {
  beefyThresholdAt,
  bridgeScripts,
  bridgeStateAt,
  bridgeUtxos,
} from "./bridge-chain";
import { justifiedUpdateAt } from "./fetch-justification";
import { sessionStart } from "./midnight";
import { bridgeUpdateTx } from "./update";

/** Where the pump runs, the deployer key variable, and the wait between idle rounds. */
export interface PumpInput {
  readonly network: Environment;
  readonly rpc: string;
  readonly signingKey: string;
  readonly poll: Duration.Duration;
}

/** Land the handover of the light client's next committee; false when BEEFY has not finalized its first block yet. */
const handover = (input: PumpInput) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const { networkId } = environmentOf(input.network);
    const scripts = yield* bridgeScripts;
    const utxos = yield* bridgeUtxos(scripts, networkId);
    const state = yield* bridgeStateAt(utxos.lightClient);
    const set = state.next_committee.validator_set_id;
    const start = yield* sessionStart(input.rpc, set);
    if (Option.isNone(start)) return false;
    const block = start.value;
    yield* out.log(`\nSet ${set} starts at Midnight block ${block}`);
    const threshold = yield* beefyThresholdAt(utxos.threshold);
    const { justified } = yield* justifiedUpdateAt(input.rpc, block, threshold);
    const tx = yield* bridgeUpdateTx(input.network, justified.update, true);
    const key = yield* Effect.flatMap(Settings, (s) =>
      s.signingKey(input.signingKey),
    );
    const name = `handover to set ${set} (block ${block})`;
    const txId = yield* submitTx(
      attachWitnesses(tx.toCbor(), signTransaction(tx.getId(), [key])),
      name,
    );
    yield* awaitConfirmation(txId, name);
    yield* out.success(`Landed ${name}: ${txId}`);
    return true;
  });

/** Run handover rounds forever. */
export const pumpProgram = (input: PumpInput) =>
  Effect.gen(function* () {
    const out = yield* Output;
    yield* out.log(
      `Data pump on ${input.network}, Midnight ${input.rpc}, idle wait ${Duration.format(input.poll)}`,
    );
    const round = Effect.catchAll(handover(input), (error) =>
      Effect.as(out.error(`Round failed: ${renderError(error)}`), false),
    );
    return yield* Effect.forever(
      Effect.flatMap(round, (landed) =>
        landed ? Effect.void : Effect.sleep(input.poll),
      ),
    );
  });
