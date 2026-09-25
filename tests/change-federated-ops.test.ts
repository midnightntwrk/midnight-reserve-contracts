/**
 * change-federated-ops through buildFederatedOpsChangeTx on the emulator:
 * the federated-ops forever (v1 datum), threshold, council and tech-auth
 * forever and federated-ops two-stage UTxOs are seeded, the builder gets them
 * as inputs, the emulator runs the validators.
 */
import {
  AssetId,
  NetworkId,
  PlutusData,
  Transaction,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Either, Option } from "effect";
import { describe, expect, test } from "bun:test";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import {
  buildFederatedOpsChangeTx,
  requireMigratedDatum,
} from "../cli/governance/change-federated-ops";
import {
  candidateToPermissionedDatum,
  decodeFederatedOps,
  type PermissionedCandidate,
} from "../cli/datum/federated-ops";
import { logicRound } from "../cli/datum/datum-versions";
import { MAIN_TOKEN_HEX } from "../cli/chain/governance-provider";
import type { Signers } from "../cli/datum/signers";
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
} from "./helpers/fixtures";
import { leftOf } from "./helpers/effect";

const candidate = (seed: string): PermissionedCandidate => ({
  sidechain_pub_key: `02${seed.repeat(32)}`,
  aura_pub_key: seed.repeat(32),
  grandpa_pub_key: seed.repeat(32),
  beefy_pub_key: `03${seed.repeat(32)}`,
});
const federatedOpsV1 = (candidates: PermissionedCandidate[]) =>
  serialize(Contracts.FederatedOps, [
    PlutusData.fromCore({ constructor: 0n, fields: { items: [] } }),
    candidates.map(candidateToPermissionedDatum),
    1n,
  ]);

const forever = new Contracts.PermissionedFederatedOpsForeverElse();

/** Seed a v1 federated-ops deployment and build the change with the given witnesses. */
const federatedOpsChange = (
  newCandidates: PermissionedCandidate[],
  witnesses: { council: Signers; techAuth: Signers },
) =>
  asFunded(async (emulator, blaze, addr, userUtxo) => {
    const logic = new Contracts.PermissionedFederatedOpsLogicElse();
    const threshold =
      new Contracts.ThresholdsMainFederatedOpsUpdateThresholdElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const twoStage =
      new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse();
    const currentDatum = federatedOpsV1([candidate("aa")]);
    const seeded = {
      foreverUtxo: scriptUtxo(
        "f0".repeat(32),
        forever.Script,
        "",
        currentDatum,
      ),
      thresholdUtxo: thresholdUtxo("c0".repeat(32), threshold.Script),
      ...authorityForevers(councilForever.Script, techAuthForever.Script),
      twoStageUtxo: scriptUtxo(
        "25".repeat(32),
        twoStage.Script,
        MAIN_TOKEN_HEX,
        upgradeState(
          logic.Script.hash(),
          new Contracts.GovAuthMainGovAuthElse().Script.hash(),
        ),
      ),
    };
    for (const u of Object.values(seeded)) emulator.addUtxo(u);
    registerRewardAccount(emulator, logic.Script.hash());
    const builder = buildFederatedOpsChangeTx(
      blaze,
      {
        forever: forever.Script,
        ...seeded,
        userUtxo,
        logicScript: logic.Script,
        mitigationLogicScript: Option.none(),
        logicRound: 0,
        currentData: Either.getOrThrow(decodeFederatedOps(currentDatum)),
        councilSigners: witnesses.council,
        techAuthSigners: witnesses.techAuth,
        requirements: requirementsOf({
          councilSigners: witnesses.council,
          techAuthSigners: witnesses.techAuth,
        }),
      },
      {
        newCandidates,
        networkId: NetworkId.Testnet,
        changeAddress: addr,
        feePadding: 0n,
      },
    );
    return { emulator, blaze, builder };
  });

describe("change-federated-ops", () => {
  test("replaces the candidate list at datum round 1 under both authority witnesses", async () => {
    const newCandidates = [candidate("bb"), candidate("cc")];
    const { emulator, blaze, builder } = await federatedOpsChange(
      newCandidates,
      { council: councilSigners, techAuth: techAuthSigners },
    );
    const datum = Transaction.fromCbor(builder.toCbor())
      .body()
      .outputs()
      .find((o) =>
        o.amount().multiasset()?.has(AssetId(forever.Script.hash())),
      )!
      .datum()!
      .asInlineData()!;
    expect(Either.getOrThrow(decodeFederatedOps(datum)).candidates).toEqual(
      newCandidates,
    );
    expect(Either.getOrThrow(logicRound(datum))).toBe(1);
    await emulator.expectValidTransaction(blaze, builder);
  });

  test("a council witness over the wrong signers is rejected by the logic", async () => {
    const { emulator, builder } = await federatedOpsChange([candidate("bb")], {
      council: [councilSigners[0], councilSigners[1]],
      techAuth: techAuthSigners,
    });
    await emulator.expectScriptFailure(
      builder,
      /Withdraw\[0\][\s\S]*Validator returned false/,
    );
  });
});

test("a v1 datum under the active v2 logic is DatumNotMigrated; a migrated one passes", () => {
  expect(leftOf(requireMigratedDatum(1, 2))).toMatchObject({
    _tag: "PreconditionFailed",
    command: "change-federated-ops",
    refusal: { _tag: "DatumNotMigrated", datumRound: 1, logicRound: 2 },
  });
  expect(Either.isRight(requireMigratedDatum(2, 2))).toBe(true);
});
