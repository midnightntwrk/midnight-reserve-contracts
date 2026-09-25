/**
 * Round trip of the TypeScript reference through the compiled bridge in the
 * Blaze emulator (UPLC evaluator): the forever UTxO is spent under the
 * two-stage `main` reference, `committee_bridge_logic` withdraws with a
 * `BridgeUpdate` redeemer built by `tests/bridge/reference/`.
 */
import { describe, expect, test } from "bun:test";
import { PlutusData } from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as C from "../../contract_blueprint";
import {
  asFunded,
  registerRewardAccount,
  scriptOutput,
  scriptUtxo,
  upgradeState,
} from "../helpers/fixtures";
import { MAIN_TOKEN_HEX } from "../../cli/chain/governance-provider";
import { scenarioByName, type Scenario } from "./reference/fixtures";
import { bridgeUpdate, nextState } from "./reference/update";
import { handoverState } from "./reference/vectors";

const forever = new C.CommitteeBridgeCommitteeBridgeForeverElse();
const logic = new C.CommitteeBridgeCommitteeBridgeLogicElse();
const twoStage = new C.CommitteeBridgeCommitteeBridgeTwoStageUpgradeElse();
const threshold = new C.ThresholdsBeefySignerThresholdElse();

const threshold_ = { numerator: 2n, denominator: 3n, base: 0n, per_signer: 0n };

function setup(emulator: Emulator, stateIn: C.BeefyConsensusState) {
  const logicRewardAccount = registerRewardAccount(
    emulator,
    logic.Script.hash(),
  );
  const foreverUtxo = scriptUtxo(
    "aa".repeat(32),
    forever.Script,
    "",
    serialize(C.BeefyConsensusState, stateIn),
    5_000_000n,
  );
  const mainRef = scriptUtxo(
    "bb".repeat(32),
    twoStage.Script,
    MAIN_TOKEN_HEX,
    upgradeState(logic.Script.hash(), ""),
  );
  const thresholdRef = scriptUtxo(
    "cc".repeat(32),
    threshold.Script,
    "",
    serialize(C.BeefyThreshold, threshold_),
  );
  for (const u of [foreverUtxo, mainRef, thresholdRef]) emulator.addUtxo(u);
  return { foreverUtxo, mainRef, thresholdRef, logicRewardAccount };
}

/** The logic script (the withdrawal) rejected; not the forever spend, not balancing. */
const logicRejected = /failed script execution\s+Withdraw\[0\]/;

interface UpdateOptions {
  signers?: number[];
  stateOut?: C.BeefyConsensusState;
  mutate?: (u: C.BridgeUpdate) => void;
}

/** Build the update tx for `s` on a fresh emulator. */
const updateTx = (s: Scenario, opts: UpdateOptions) =>
  asFunded(async (emulator, blaze, _addr, funding) => {
    const stateIn = handoverState();
    const { foreverUtxo, mainRef, thresholdRef, logicRewardAccount } = setup(
      emulator,
      stateIn,
    );
    const update = bridgeUpdate(s, [0, 1, 2], opts.signers ?? [0, 1]);
    opts.mutate?.(update);
    const stateOut = opts.stateOut ?? nextState(stateIn, s) ?? stateIn;
    const tx = blaze
      .newTransaction()
      .addInput(funding)
      .addInput(foreverUtxo, PlutusData.newInteger(0n))
      .provideScript(forever.Script)
      .addReferenceInput(mainRef)
      .addReferenceInput(thresholdRef)
      .addOutput(
        scriptOutput(
          forever.Script,
          "",
          serialize(C.BeefyConsensusState, stateOut),
          5_000_000n,
        ),
      )
      .addWithdrawal(logicRewardAccount, 0n, serialize(C.BridgeUpdate, update))
      .provideScript(logic.Script);
    return { emulator, blaze, tx };
  });

const accepted = async (s: Scenario) => {
  const { emulator, blaze, tx } = await updateTx(s, {});
  await emulator.expectValidTransaction(blaze, tx);
};

describe("committee_bridge_logic in the Blaze VM", () => {
  test("a_no_handover: committee 4 signs a leaf naming 5", async () => {
    await accepted(scenarioByName("a_no_handover"));
  });
  test("b_handover: committee 5 signs a leaf naming 6, state rotates", async () => {
    const s = scenarioByName("b_handover");
    expect(
      nextState(handoverState(), s)?.current_committee.validator_set_id,
    ).toBe(5n);
    await accepted(s);
  });
  test.each<[string, string, UpdateOptions]>([
    [
      "one flipped signature byte",
      "a_no_handover",
      {
        mutate: (u) => {
          const sig = Buffer.from(u.signatures[0], "hex");
          sig[5] ^= 1;
          u.signatures[0] = sig.toString("hex");
        },
      },
    ],
    [
      "one signer of seat 1 is below the quorum of 3",
      "a_no_handover",
      { signers: [0] },
    ],
    ["stale state_out", "a_no_handover", { stateOut: handoverState() }],
  ])("%s is rejected by the logic", async (_name, scenario, opts) => {
    const { emulator, tx } = await updateTx(scenarioByName(scenario), opts);
    await emulator.expectScriptFailure(tx, logicRejected);
  });
});
