/**
 * Round trip of the TypeScript reference through the compiled bridge in the
 * Blaze emulator (UPLC evaluator): the forever UTxO is spent under the
 * two-stage `main` reference, `committee_bridge_logic` withdraws with a
 * `BridgeUpdate` redeemer built by `tests/bridge/reference/`.
 */
import { describe, expect, test } from "bun:test";
import {
  addressFromValidator,
  AssetId,
  Credential,
  CredentialType,
  Datum,
  NetworkId,
  PaymentAddress,
  PlutusData,
  RewardAccount,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
  Value,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import * as C from "../../contract_blueprint";
import { scenarioByName, type Scenario } from "./reference/fixtures";
import { bridgeUpdate, nextState } from "./reference/update";
import { handoverState } from "./reference/vectors";

const forever = new C.CommitteeBridgeCommitteeBridgeForeverElse();
const logic = new C.CommitteeBridgeCommitteeBridgeLogicElse();
const twoStage = new C.CommitteeBridgeCommitteeBridgeTwoStageUpgradeElse();
const threshold = new C.ThresholdsBeefySignerThresholdElse();

const foreverAddress = addressFromValidator(NetworkId.Testnet, forever.Script);
const logicRewardAccount = RewardAccount.fromCredential(
  Credential.fromCore({
    hash: logic.Script.hash(),
    type: CredentialType.ScriptHash,
  }).toCore(),
  NetworkId.Testnet,
);

const nft = (policy: string, name = ""): Map<AssetId, bigint> =>
  new Map([[AssetId(policy + name), 1n]]);

const utxo = (
  txId: string,
  index: number,
  address: string,
  coins: bigint,
  assets: Map<AssetId, bigint>,
  datum: PlutusData,
) =>
  TransactionUnspentOutput.fromCore([
    { index, txId: TransactionId(txId.repeat(32)) },
    {
      address: PaymentAddress(address),
      value: { coins, assets },
      datum: datum.toCore(),
    },
  ]);

const threshold_ = { numerator: 2n, denominator: 3n, base: 0n, per_signer: 0n };

function setup(stateIn: C.BeefyConsensusState) {
  const emulator = new Emulator([]);
  emulator.accounts.set(logicRewardAccount, { balance: 0n });
  const foreverUtxo = utxo(
    "aa",
    0,
    foreverAddress.toBech32(),
    5_000_000n,
    nft(forever.Script.hash()),
    serialize(C.BeefyConsensusState, stateIn),
  );
  const mainRef = utxo(
    "bb",
    0,
    addressFromValidator(NetworkId.Testnet, twoStage.Script).toBech32(),
    2_000_000n,
    nft(twoStage.Script.hash(), Buffer.from("main").toString("hex")),
    serialize(C.UpgradeState, [logic.Script.hash(), "", "", "", 0n, 0n]),
  );
  const thresholdRef = utxo(
    "cc",
    0,
    addressFromValidator(NetworkId.Testnet, threshold.Script).toBech32(),
    2_000_000n,
    nft(threshold.Script.hash()),
    serialize(C.BeefyThreshold, threshold_),
  );
  for (const u of [foreverUtxo, mainRef, thresholdRef]) emulator.addUtxo(u);
  return { emulator, foreverUtxo, mainRef, thresholdRef };
}

/** The logic script (the withdrawal) rejected; not the forever spend, not balancing. */
const logicRejected = /failed script execution Withdraw\[0\]/;

/** Run the update tx for `s`: `"accepted"`, or the emulator's rejection text. */
async function submit(
  s: Scenario,
  opts: {
    signers?: number[];
    stateOut?: C.BeefyConsensusState;
    mutate?: (u: C.BridgeUpdate) => void;
  } = {},
): Promise<string> {
  const stateIn = handoverState();
  const { emulator, foreverUtxo, mainRef, thresholdRef } = setup(stateIn);
  const update = bridgeUpdate(s, [0, 1, 2], opts.signers ?? [0, 1]);
  opts.mutate?.(update);
  const stateOut = opts.stateOut ?? nextState(stateIn, s) ?? stateIn;
  return emulator.as("relayer", async (blaze, addr) => {
    const funding = TransactionUnspentOutput.fromCore([
      { index: 0, txId: TransactionId("ff".repeat(32)) },
      {
        address: PaymentAddress(addr.toBech32()),
        value: { coins: 100_000_000n },
      },
    ]);
    emulator.addUtxo(funding);
    const out = new TransactionOutput(
      foreverAddress,
      new Value(5_000_000n, nft(forever.Script.hash())),
    );
    out.setDatum(
      Datum.newInlineData(serialize(C.BeefyConsensusState, stateOut)),
    );
    const tx: TxBuilder = blaze
      .newTransaction()
      .addInput(funding)
      .addInput(foreverUtxo, PlutusData.newInteger(0n))
      .provideScript(forever.Script)
      .addReferenceInput(mainRef)
      .addReferenceInput(thresholdRef)
      .addOutput(out)
      .addWithdrawal(logicRewardAccount, 0n, serialize(C.BridgeUpdate, update))
      .provideScript(logic.Script);
    // The emulator dumps script bytes on a rejected tx; the rejections here are expected.
    const error = console.error;
    console.error = () => {};
    try {
      await emulator.expectValidTransaction(blaze, tx);
      return "accepted";
    } catch (e) {
      return String(e).replace(/\s+/g, " ");
    } finally {
      console.error = error;
    }
  });
}

describe("committee_bridge_logic in the Blaze VM", () => {
  test("a_no_handover: committee 4 signs a leaf naming 5", async () => {
    expect(await submit(scenarioByName("a_no_handover"))).toBe("accepted");
  });
  test("b_handover: committee 5 signs a leaf naming 6, state rotates", async () => {
    const s = scenarioByName("b_handover");
    expect(
      nextState(handoverState(), s)?.current_committee.validator_set_id,
    ).toBe(5n);
    expect(await submit(s)).toBe("accepted");
  });
  test("c_next_signs_same: committee 5 signs a leaf naming 5 (rule 10)", async () => {
    expect(await submit(scenarioByName("c_next_signs_same"))).toMatch(
      logicRejected,
    );
  });
  test("d_skip_two: leaf naming 7 (rule 9)", async () => {
    expect(await submit(scenarioByName("d_skip_two"))).toMatch(logicRejected);
  });
  test("one flipped signature byte", async () => {
    expect(
      await submit(scenarioByName("a_no_handover"), {
        mutate: (u) => {
          const sig = Buffer.from(u.signatures[0], "hex");
          sig[5] ^= 1;
          u.signatures[0] = sig.toString("hex");
        },
      }),
    ).toMatch(logicRejected);
  });
  test("one signer of seat 1 is below the quorum of 3", async () => {
    expect(
      await submit(scenarioByName("a_no_handover"), { signers: [0] }),
    ).toMatch(logicRejected);
  });
  test("stale state_out", async () => {
    expect(
      await submit(scenarioByName("a_no_handover"), {
        stateOut: handoverState(),
      }),
    ).toMatch(logicRejected);
  });
});
