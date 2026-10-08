/**
 * run-cnight-mint-mainnet's builder on the emulator, through the deployed
 * cNIGHT mint forever: it reads the logic and mitigation logic from the
 * two-stage main UTxO and needs a withdrawal from each.
 */
import { describe, test } from "bun:test";
import { NetworkId, type Script } from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import { Option } from "effect";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import { TestCnightNoAuditTcnightMintInfiniteElse } from "../contract_blueprint_mainnet";
import { buildRunCnightMintTx } from "../cli/governance/run-cnight-mint";
import { MAIN_TOKEN_HEX } from "../cli/chain/governance-provider";
import { feeUtxo, registerRewardAccount, scriptUtxo } from "./helpers/fixtures";

const twoStage = new Contracts.CnightMintingCnightMintTwoStageUpgradeElse()
  .Script;
const forever = new Contracts.CnightMintingCnightMintForeverElse().Script;
const govAuth = new Contracts.GovAuthMainGovAuthElse().Script;
const alwaysTrue = new TestCnightNoAuditTcnightMintInfiniteElse().Script;
const cnightLogic = new Contracts.CnightMintingCnightMintLogicElse().Script;
const alwaysFalse = new Contracts.CnightMintingV2CnightMintLogicV2Else().Script;

/** Build the run over a main UTxO whose UpgradeState names `logic` and `mitigation` ("" for none), withdrawing through `withdrawn`. */
const run = (
  state: { readonly logic: Script; readonly mitigation: Option.Option<Script> },
  withdrawn: { readonly mitigation: Option.Option<Script> },
  check: (
    emulator: Emulator,
    blaze: Parameters<Parameters<Emulator["as"]>[1]>[0],
    tx: ReturnType<typeof buildRunCnightMintTx>,
  ) => Promise<unknown>,
) => {
  const emulator = new Emulator([]);
  const mainUtxo = scriptUtxo(
    "aa".repeat(32),
    twoStage,
    MAIN_TOKEN_HEX,
    serialize(Contracts.UpgradeState, [
      state.logic.hash(),
      Option.match(state.mitigation, {
        onNone: () => "",
        onSome: (script) => script.hash(),
      }),
      govAuth.hash(),
      "",
      0n,
      0n,
    ]),
  );
  emulator.addUtxo(mainUtxo);
  for (const script of [
    forever,
    state.logic,
    ...Option.toArray(state.mitigation),
  ]) {
    registerRewardAccount(emulator, script.hash());
  }
  return emulator.as("deployer", async (blaze, addr) => {
    const fee = feeUtxo(addr, "f0".repeat(32));
    emulator.addUtxo(fee);
    await check(
      emulator,
      blaze,
      buildRunCnightMintTx(
        blaze,
        {
          forever,
          twoStageMainUtxo: mainUtxo,
          userUtxo: fee,
          logicScript: state.logic,
          mitigationLogicScript: withdrawn.mitigation,
        },
        { networkId: NetworkId.Testnet, changeAddress: addr, feePadding: 0n },
      ),
    );
  });
};

const accepted: Parameters<typeof run>[2] = (emulator, blaze, tx) =>
  emulator.expectValidTransaction(blaze, tx);

const rejected: Parameters<typeof run>[2] = (emulator, _blaze, tx) =>
  emulator.expectScriptFailure(tx, /failed script execution\s+Withdraw\[\d\]/);

describe("run-cnight-mint-mainnet", () => {
  test("the ledger takes the run when the main state names a logic that passes", () =>
    run(
      { logic: alwaysTrue, mitigation: Option.none() },
      { mitigation: Option.none() },
      accepted,
    ));

  test("the run executes the logic: one that fails rejects it", () =>
    run(
      { logic: alwaysFalse, mitigation: Option.none() },
      { mitigation: Option.none() },
      rejected,
    ));

  test("with a mitigation logic in the main state, the run withdraws through it too", () =>
    run(
      { logic: alwaysTrue, mitigation: Option.some(cnightLogic) },
      { mitigation: Option.some(cnightLogic) },
      accepted,
    ));

  test("the forever rejects a run that leaves the named mitigation logic out", () =>
    run(
      { logic: alwaysTrue, mitigation: Option.some(cnightLogic) },
      { mitigation: Option.none() },
      rejected,
    ));
});
