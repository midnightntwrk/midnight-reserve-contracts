/**
 * bridge-info: the committee bridge as the chain holds it: the light
 * client's state, the running logic, the BEEFY threshold with its fee cap,
 * the pool's balance and UTxO count, and the reference-script UTxOs at the
 * deployer address. Reads only.
 */
import {
  addressFromValidator,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect, Option } from "effect";
import type { AuthoritySetCommitment } from "../../contract_blueprint";
import { upgradeStateAt } from "../chain/governance-provider";
import { requireOnChainNetwork } from "../chain/provider";
import { environmentOf } from "../config/network-mapping";
import type { NetworkInput } from "../input";
import { formatLovelaceToAda, Output } from "../output";
import {
  beefyThresholdAt,
  bridgeScripts,
  bridgeStateAt,
  bridgeUtxos,
  findReferenceScripts,
} from "./bridge-chain";

const refText = (utxo: TransactionUnspentOutput) =>
  `${utxo.input().transactionId()}#${utxo.input().index()}`;

const committeeText = (committee: AuthoritySetCommitment) =>
  `set ${committee.validator_set_id}, ${committee.seat_count} seats, keyset ${committee.keyset_commitment}`;

/** Print the bridge's on-chain state. */
export const bridgeInfoProgram = (input: NetworkInput) =>
  Effect.gen(function* () {
    const { network } = input;
    yield* requireOnChainNetwork(network);
    const out = yield* Output;
    const { networkId } = environmentOf(network);
    const scripts = yield* bridgeScripts;
    const utxos = yield* bridgeUtxos(scripts, networkId);
    const state = yield* bridgeStateAt(utxos.lightClient);
    const upgrade = yield* upgradeStateAt(utxos.main);
    const threshold = yield* beefyThresholdAt(utxos.threshold);
    const references = [
      ["forever", scripts.forever.hash()],
      ["logic", upgrade.logicHash],
      ["pool", scripts.pool.hash()],
    ] as const;
    const { address: deployer, found } = yield* findReferenceScripts(
      references.map(([, hash]) => hash),
    );
    const poolLovelace = utxos.pool.reduce(
      (sum, u) => sum + u.output().amount().coin(),
      0n,
    );
    const address = (script: typeof scripts.forever) =>
      addressFromValidator(networkId, script).toBech32();

    yield* Effect.forEach(
      [
        `\nCommittee bridge on ${network}`,
        `\nLight client: ${address(scripts.forever)}`,
        `  UTxO: ${refText(utxos.lightClient)} (${formatLovelaceToAda(utxos.lightClient.output().amount().coin())} ADA)`,
        `  Latest MMR root: ${state.latest_mmr_root}`,
        `  Latest height: ${state.latest_height}`,
        `  BEEFY activation block: ${state.beefy_activation_block}`,
        `  Current committee: ${committeeText(state.current_committee)}`,
        `  Next committee: ${committeeText(state.next_committee)}`,
        `\nLogic: ${upgrade.logicHash}`,
        `Mitigation logic: ${upgrade.mitigationLogicHash || "(none)"}`,
        `\nBEEFY threshold: ${threshold.numerator}/${threshold.denominator}`,
        `  Fee cap: ${threshold.base} + ${threshold.per_signer} per signer (lovelace)`,
        `\nPool: ${address(scripts.pool)}`,
        `  UTxOs: ${utxos.pool.length}, ${formatLovelaceToAda(poolLovelace)} ADA`,
        `\nReference scripts at ${deployer}:`,
        ...references.map(
          ([name, hash], i) =>
            `  ${name} ${hash}: ${Option.match(found[i], {
              onNone: () => "not found",
              onSome: refText,
            })}`,
        ),
      ],
      (line) => out.log(line),
      { discard: true },
    );
  });
