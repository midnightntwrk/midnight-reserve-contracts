/** bridge-topup: a payment from the deployer to the committee bridge pool, built (never submitted) and written to a file. */
import { addressFromValidator } from "@blaze-cardano/core";
import { Effect } from "effect";
import { buildTx } from "../chain/complete-tx";
import { Provider } from "../chain/provider";
import { DEPLOYER_ONLY } from "../chain/transaction";
import { writeTransaction } from "../chain/tx-file";
import { environmentOf } from "../config/network-mapping";
import { type TxFileInput, txFilePath } from "../input";
import { formatLovelaceToAda, Output } from "../output";
import { buildBridgeTopupTx } from "./bridge-tx";
import { bridgeScripts } from "./bridge-chain";

/** The lovelace to pay the pool, and where the file goes. */
export interface BridgeTopupInput extends TxFileInput {
  readonly lovelace: bigint;
}

/** Build the top-up and write it unsigned; sign-and-submit adds the deployer's witness. */
export const bridgeTopupProgram = (input: BridgeTopupInput) =>
  Effect.gen(function* () {
    const { network, lovelace } = input;
    const out = yield* Output;
    const { networkId } = environmentOf(network);
    const { pool } = yield* bridgeScripts;
    yield* out.log(`\nTopping up the committee bridge pool on ${network}`);
    yield* out.log(`Pool: ${addressFromValidator(networkId, pool).toBech32()}`);
    yield* out.log(`Amount: ${formatLovelaceToAda(lovelace)} ADA`);
    const blaze = yield* Effect.flatMap(Provider, (p) => p.blaze);
    const tx = yield* buildTx(
      buildBridgeTopupTx(blaze, pool, lovelace, networkId),
      {
        commandName: "bridge-topup",
        environment: network,
        witnesses: DEPLOYER_ONLY,
      },
    );
    yield* writeTransaction(
      txFilePath(input),
      tx.toCbor(),
      tx.getId(),
      false,
      "Bridge Pool Top-up",
    );
    return tx;
  });
