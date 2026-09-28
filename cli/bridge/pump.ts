/**
 * pump: the data pump as a service, beside the node. Each round runs its
 * jobs in order: the committee bridge handover of the light client's next
 * committee, once BEEFY has finalized that set's first block (built as
 * bridge-update --funded builds it from the block's justification), then
 * the reserve release once a whole interval has passed (rewards-release),
 * then the rewards batcher's next load or pay once there is one
 * (rewards-batch).
 * A job that lands signs with the deployer key, submits and awaits its
 * transaction, and the next round starts at once, so a backlog lands
 * oldest first. When no job lands, or a job fails (logged), the pump waits
 * `poll`.
 */
import type { Transaction } from "@blaze-cardano/core";
import { Duration, Effect, Option } from "effect";
import { awaitConfirmation, submitTx } from "../chain/submit";
import { attachWitnesses, signTransaction } from "../chain/transaction";
import { type Environment, environmentOf } from "../config/network-mapping";
import { Settings } from "../config/settings";
import { type CliError, renderError } from "../errors";
import { Output } from "../output";
import {
  beefyThresholdAt,
  bridgeScripts,
  bridgeStateAt,
  bridgeUtxos,
} from "./bridge-chain";
import { batchTx, nothingToBatch } from "../rewards/load";
import { releaseNotDue, releaseTx } from "../rewards/release";
import { justifiedUpdateAt } from "./fetch-justification";
import { sessionStart } from "./midnight";
import { bridgeUpdateTx } from "./update";

/** Where the pump runs, the deployer key variable, and the wait between idle rounds. */
export interface PumpInput {
  readonly network: Environment;
  readonly rpc: string;
  readonly signingKey: string;
  readonly poll: Duration.Duration;
  readonly limit: number;
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
    yield* land(input, tx, `handover to set ${set} (block ${block})`);
    return true;
  });

/** Land the reserve release due now; false before a whole interval has passed. */
const release = (input: PumpInput) =>
  Effect.catchIf(
    Effect.flatMap(releaseTx(input.network), (tx) =>
      Effect.as(land(input, tx, "reserve release"), true),
    ),
    releaseNotDue,
    () => Effect.succeed(false),
  );

/** Land the batcher's next load or pay; false when there is none yet. */
const batch = (input: PumpInput) =>
  Effect.catchIf(
    Effect.flatMap(
      batchTx(input.network, input.rpc, input.limit),
      ({ tx, name }) => Effect.as(land(input, tx, name), true),
    ),
    nothingToBatch,
    () => Effect.succeed(false),
  );

/** Sign with the deployer key, submit, and await the confirmation. */
const land = (input: PumpInput, tx: Transaction, name: string) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const key = yield* Effect.flatMap(Settings, (s) =>
      s.signingKey(input.signingKey),
    );
    const txId = yield* submitTx(
      attachWitnesses(tx.toCbor(), signTransaction(tx.getId(), [key])),
      name,
    );
    yield* awaitConfirmation(txId, name);
    yield* out.success(`Landed ${name}: ${txId}`);
  });

/** Run rounds forever: each job in order, logging a failed one. */
export const pumpProgram = (input: PumpInput) =>
  Effect.gen(function* () {
    const out = yield* Output;
    yield* out.log(
      `Data pump on ${input.network}, Midnight ${input.rpc}, idle wait ${Duration.format(input.poll)}`,
    );
    const job = <E extends CliError, R>(
      name: string,
      effect: Effect.Effect<boolean, E, R>,
    ) =>
      Effect.catchAll(effect, (error) =>
        Effect.as(out.error(`${name} failed: ${renderError(error)}`), false),
      );
    const round = Effect.map(
      Effect.all([
        job("handover", handover(input)),
        job("release", release(input)),
        job("batch", batch(input)),
      ]),
      (landed) => landed.some((l) => l),
    );
    return yield* Effect.forever(
      Effect.flatMap(round, (landed) =>
        landed ? Effect.void : Effect.sleep(input.poll),
      ),
    );
  });
