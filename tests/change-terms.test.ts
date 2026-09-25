/**
 * change-terms through buildTermsChangeTx on the emulator: the terms forever,
 * threshold, council and tech-auth forever and terms two-stage UTxOs are
 * seeded, the builder gets them as inputs, the emulator runs the validators.
 */
import { NetworkId } from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  buildTermsChangeTx,
  type TermsChangeInputs,
} from "../cli/governance/change-terms";
import { type TermsData } from "../cli/datum/terms-and-conditions";
import { MAIN_TOKEN_HEX } from "../cli/chain/governance-provider";
import {
  asFunded,
  councilSigners,
  registerRewardAccount,
  scriptUtxo,
  techAuthSigners,
  upgradeState,
  thresholdUtxo,
  authorityForevers,
  requirementsOf,
  findUtxoByToken,
} from "./helpers/fixtures";

const termsForever =
  new Contracts.TermsAndConditionsTermsAndConditionsForeverElse();
const termsLogic =
  new Contracts.TermsAndConditionsTermsAndConditionsLogicElse();
const termsTwoStage =
  new Contracts.TermsAndConditionsTermsAndConditionsTwoStageUpgradeElse();
const termsThreshold =
  new Contracts.ThresholdsTermsAndConditionsThresholdElse();

/** Seed a terms deployment and run the change to the given terms. */
const termsChange = (terms: TermsData) =>
  asFunded(async (emulator, blaze, addr, userUtxo) => {
    const councilForever = new Contracts.PermissionedCouncilForeverElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const inputs: TermsChangeInputs = {
      forever: termsForever.Script,
      foreverUtxo: scriptUtxo(
        "a1".repeat(32),
        termsForever.Script,
        "",
        serialize(Contracts.VersionedTermsAndConditions, [
          ["aa".repeat(32), "68747470733a2f2f6578616d706c652e636f6d"],
          0n,
        ]),
      ),
      thresholdUtxo: thresholdUtxo("a2".repeat(32), termsThreshold.Script),
      ...authorityForevers(councilForever.Script, techAuthForever.Script),
      twoStageUtxo: scriptUtxo(
        "a5".repeat(32),
        termsTwoStage.Script,
        MAIN_TOKEN_HEX,
        upgradeState(termsLogic.Script.hash(), termsThreshold.Script.hash()),
      ),
      userUtxo,
      logicScript: termsLogic.Script,
      mitigationLogicScript: Option.none(),
      logicRound: 0,
      councilSigners,
      techAuthSigners,
      requirements: requirementsOf({ councilSigners, techAuthSigners }),
    };
    for (const u of [
      inputs.foreverUtxo,
      inputs.thresholdUtxo,
      inputs.councilForeverUtxo,
      inputs.techAuthForeverUtxo,
      inputs.twoStageUtxo,
    ]) {
      emulator.addUtxo(u);
    }
    registerRewardAccount(emulator, termsLogic.Script.hash());
    const builder = buildTermsChangeTx(blaze, inputs, {
      terms,
      networkId: NetworkId.Testnet,
      changeAddress: addr,
      feePadding: 0n,
    });
    return { emulator, blaze, builder };
  });

const newUrl = "68747470733a2f2f6e65772e636f6d";

describe("change-terms", () => {
  test("replaces the hash and the link under both authority witnesses", async () => {
    const terms = { hash: "bb".repeat(32), link: newUrl };
    const { emulator, blaze, builder } = await termsChange(terms);
    await emulator.expectValidTransaction(blaze, builder);
    const forever = findUtxoByToken(
      emulator.utxos(),
      termsForever.Script.hash(),
      "",
    );
    expect(
      parse(
        Contracts.VersionedTermsAndConditions,
        forever.output().datum()!.asInlineData()!,
      ),
    ).toEqual([[terms.hash, terms.link], 0n]);
  });

  test("a 31-byte hash is rejected by the logic", async () => {
    const { emulator, builder } = await termsChange({
      hash: "bb".repeat(31),
      link: newUrl,
    });
    await emulator.expectScriptFailure(
      builder,
      /Withdraw\[0\][\s\S]*Validator returned false/,
    );
  });
});
