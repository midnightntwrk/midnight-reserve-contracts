/**
 * LogicRedeemer::Normal wrapping on the v2 logic scripts, through the
 * builders: each change command with logicRound 1 (or 2 for federated ops)
 * wraps the inner redeemer and passes.
 *
 * The v2 scripts are not deployed, so every script comes from the build
 * blueprint: cross-script hash references must share one compilation.
 */
import {
  type Address,
  NetworkId,
  PlutusData,
  type Script,
  toHex,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type { TxBuilder } from "@blaze-cardano/tx";
import { describe, test } from "bun:test";
import { Either, Option } from "effect";
import * as Contracts from "../contract_blueprint";
import {
  buildMultisigChangeTx,
  signerRequirements,
} from "../cli/governance/change-multisig";
import { authorityThreshold } from "../cli/governance/threshold";
import { buildFederatedOpsChangeTx } from "../cli/governance/change-federated-ops";
import { decodeFederatedOps } from "../cli/datum/federated-ops";
import { buildTermsChangeTx } from "../cli/governance/change-terms";
import { MAIN_TOKEN_HEX } from "../cli/chain/governance-provider";
import {
  type BlazeOf,
  asFunded,
  councilSigners,
  multisigState,
  registerRewardAccount,
  scriptUtxo,
  techAuthSigners,
  upgradeState,
  thresholdUtxo,
  THRESHOLD,
  requirementsOf,
  authorityForevers,
} from "./helpers/fixtures";

type Builder = Either.Either<TxBuilder, unknown>;

/** FederatedOpsV2 [data (Unit), message "", appendix [], logic_round 2]. */
const federatedOpsV2Datum = () =>
  serialize(Contracts.FederatedOpsV2, [
    PlutusData.fromCore({ constructor: 0n, fields: { items: [] } }),
    "",
    [],
    2n,
  ]);

/** Seed the script UTxOs and the v2 logic reward account, then build with the funded wallet. */
const seeded = (
  logic: Script,
  utxos: readonly TransactionUnspentOutput[],
  build: (
    blaze: BlazeOf,
    changeAddress: Address,
    userUtxo: TransactionUnspentOutput,
  ) => Builder,
) =>
  asFunded(async (emulator, blaze, addr, userUtxo) => {
    for (const utxo of utxos) emulator.addUtxo(utxo);
    registerRewardAccount(emulator, logic.hash());
    return { emulator, blaze, builder: build(blaze, addr, userUtxo) };
  });

const multisigChange =
  (family: "council" | "tech-auth") => async (logicRound: number) => {
    const primary =
      family === "council"
        ? {
            forever: new Contracts.PermissionedCouncilForeverElse(),
            logicV2: new Contracts.PermissionedV2CouncilLogicV2Else(),
            twoStage: new Contracts.PermissionedCouncilTwoStageUpgradeElse(),
            threshold: new Contracts.ThresholdsMainCouncilUpdateThresholdElse(),
            secondaryForever: new Contracts.PermissionedTechAuthForeverElse(),
          }
        : {
            forever: new Contracts.PermissionedTechAuthForeverElse(),
            logicV2: new Contracts.PermissionedV2TechAuthLogicV2Else(),
            twoStage: new Contracts.PermissionedTechAuthTwoStageUpgradeElse(),
            threshold:
              new Contracts.ThresholdsMainTechAuthUpdateThresholdElse(),
            secondaryForever: new Contracts.PermissionedCouncilForeverElse(),
          };
    const primaryForeverUtxo = scriptUtxo(
      "ee".repeat(32),
      primary.forever.Script,
      "",
      multisigState(councilSigners, 1n),
    );
    const primaryThresholdUtxo = thresholdUtxo(
      "c0".repeat(32),
      primary.threshold.Script,
    );
    const secondaryForeverUtxo = scriptUtxo(
      "dd".repeat(32),
      primary.secondaryForever.Script,
      "",
      multisigState(techAuthSigners),
    );
    const primaryTwoStageUtxo = scriptUtxo(
      "c1".repeat(32),
      primary.twoStage.Script,
      MAIN_TOKEN_HEX,
      upgradeState(
        primary.logicV2.Script.hash(),
        primary.forever.Script.hash(),
        1n,
      ),
    );
    return seeded(
      primary.logicV2.Script,
      [
        primaryForeverUtxo,
        primaryThresholdUtxo,
        secondaryForeverUtxo,
        primaryTwoStageUtxo,
      ],
      (blaze, changeAddress, userUtxo) =>
        buildMultisigChangeTx(
          blaze,
          {
            primaryForever: primary.forever.Script,
            primaryForeverUtxo,
            primaryThresholdUtxo,
            secondaryForeverUtxo,
            primaryTwoStageUtxo,
            userUtxo,
            logicScript: primary.logicV2.Script,
            mitigationLogicScript: Option.none(),
            logicRound,
            currentPrimarySigners: councilSigners,
            secondarySigners: techAuthSigners,
            requirements: signerRequirements(
              Either.getOrThrow(authorityThreshold(THRESHOLD)),
              councilSigners,
              techAuthSigners,
              family,
            ),
          },
          {
            newSigners: councilSigners,
            networkId: NetworkId.Testnet,
            changeAddress,
            commandName: `change-${family}`,
            feePadding: 0n,
          },
        ),
    );
  };

const federatedOpsChange = async (logicRound: number) => {
  const forever = new Contracts.PermissionedFederatedOpsForeverElse();
  const logicV2 = new Contracts.PermissionedV2FederatedOpsLogicV2Else();
  const twoStage = new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse();
  const threshold =
    new Contracts.ThresholdsMainFederatedOpsUpdateThresholdElse();
  const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
  const councilForever = new Contracts.PermissionedCouncilForeverElse();
  const foreverDatum = federatedOpsV2Datum();
  const utxos = {
    foreverUtxo: scriptUtxo("ee".repeat(32), forever.Script, "", foreverDatum),
    thresholdUtxo: thresholdUtxo("c0".repeat(32), threshold.Script),
    ...authorityForevers(councilForever.Script, techAuthForever.Script),
    twoStageUtxo: scriptUtxo(
      "c1".repeat(32),
      twoStage.Script,
      MAIN_TOKEN_HEX,
      upgradeState(logicV2.Script.hash(), forever.Script.hash(), 2n),
    ),
  };
  return seeded(
    logicV2.Script,
    Object.values(utxos),
    (blaze, changeAddress, userUtxo) =>
      Either.right(
        buildFederatedOpsChangeTx(
          blaze,
          {
            forever: forever.Script,
            ...utxos,
            userUtxo,
            logicScript: logicV2.Script,
            mitigationLogicScript: Option.none(),
            logicRound,
            currentData: Either.getOrThrow(decodeFederatedOps(foreverDatum)),
            councilSigners,
            techAuthSigners,
            requirements: requirementsOf({ councilSigners, techAuthSigners }),
          },
          {
            newCandidates: [],
            networkId: NetworkId.Testnet,
            changeAddress,
            feePadding: 0n,
          },
        ),
      ),
  );
};

const termsChange = async (logicRound: number) => {
  const forever =
    new Contracts.TermsAndConditionsTermsAndConditionsForeverElse();
  const logicV2 =
    new Contracts.TermsAndConditionsV2TermsAndConditionsLogicV2Else();
  const twoStage =
    new Contracts.TermsAndConditionsTermsAndConditionsTwoStageUpgradeElse();
  const threshold = new Contracts.ThresholdsTermsAndConditionsThresholdElse();
  const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
  const councilForever = new Contracts.PermissionedCouncilForeverElse();
  const utxos = {
    foreverUtxo: scriptUtxo(
      "ee".repeat(32),
      forever.Script,
      "",
      serialize(Contracts.VersionedTermsAndConditions, [
        [
          "aa".repeat(32),
          toHex(new TextEncoder().encode("https://example.com")),
        ],
        1n,
      ]),
    ),
    thresholdUtxo: thresholdUtxo("c0".repeat(32), threshold.Script),
    ...authorityForevers(councilForever.Script, techAuthForever.Script),
    twoStageUtxo: scriptUtxo(
      "c1".repeat(32),
      twoStage.Script,
      MAIN_TOKEN_HEX,
      upgradeState(logicV2.Script.hash(), forever.Script.hash(), 1n),
    ),
  };
  return seeded(
    logicV2.Script,
    Object.values(utxos),
    (blaze, changeAddress, userUtxo) =>
      Either.right(
        buildTermsChangeTx(
          blaze,
          {
            forever: forever.Script,
            ...utxos,
            userUtxo,
            logicScript: logicV2.Script,
            mitigationLogicScript: Option.none(),
            logicRound,
            councilSigners,
            techAuthSigners,
            requirements: requirementsOf({ councilSigners, techAuthSigners }),
          },
          {
            terms: {
              hash: "bb".repeat(32),
              link: toHex(new TextEncoder().encode("https://new.com")),
            },
            networkId: NetworkId.Testnet,
            changeAddress,
            feePadding: 0n,
          },
        ),
      ),
  );
};

describe("LogicRedeemer::Normal v2 wrapping through the builders", () => {
  test.each([
    ["change-council", multisigChange("council"), 1],
    ["change-tech-auth", multisigChange("tech-auth"), 1],
    ["change-federated-ops", federatedOpsChange, 2],
    ["change-terms", termsChange, 1],
  ] as const)(
    "%s: wrapped redeemer succeeds with v2 logic",
    async (_name, build, v2Round) => {
      const { emulator, blaze, builder } = await build(v2Round);
      await emulator.expectValidTransaction(blaze, Either.getOrThrow(builder));
    },
  );
});
