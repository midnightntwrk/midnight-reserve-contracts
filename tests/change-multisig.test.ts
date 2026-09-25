/**
 * change-council and change-tech-auth through buildMultisigChangeTx on the
 * emulator: the primary forever, threshold, secondary forever and primary
 * two-stage UTxOs are seeded, the builder gets them as inputs, the emulator
 * runs the validators. Duplicate payment hashes in the new signers must
 * survive the CBOR round trip.
 */
import { NetworkId } from "@blaze-cardano/core";
import { Either, Option } from "effect";
import { describe, expect, test } from "bun:test";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import {
  buildMultisigChangeTx,
  type MultisigFamily,
  signerRequirements,
} from "../cli/governance/change-multisig";
import { authorityThreshold } from "../cli/governance/threshold";
import { MAIN_TOKEN_HEX } from "../cli/chain/governance-provider";
import type { Signer, Signers } from "../cli/datum/signers";
import {
  asFunded,
  councilSigners,
  multisigState,
  registerRewardAccount,
  scriptUtxo,
  signer,
  techAuthSigners,
  upgradeState,
  thresholdUtxo,
  THRESHOLD,
} from "./helpers/fixtures";
import { leftOf } from "./helpers/effect";

const councilForever = new Contracts.PermissionedCouncilForeverElse();
const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
const families = {
  council: {
    forever: councilForever,
    logic: new Contracts.PermissionedCouncilLogicElse(),
    threshold: new Contracts.ThresholdsMainCouncilUpdateThresholdElse(),
    twoStage: new Contracts.PermissionedCouncilTwoStageUpgradeElse(),
    signers: councilSigners,
    secondaryForever: techAuthForever,
    secondarySigners: techAuthSigners,
  },
  "tech-auth": {
    forever: techAuthForever,
    logic: new Contracts.PermissionedTechAuthLogicElse(),
    threshold: new Contracts.ThresholdsMainTechAuthUpdateThresholdElse(),
    twoStage: new Contracts.PermissionedTechAuthTwoStageUpgradeElse(),
    signers: techAuthSigners,
    secondaryForever: councilForever,
    secondarySigners: councilSigners,
  },
} as const;

/** Seed a deployment of the family and build the change with the given secondary witness signers. */
const multisigChange = (
  family: MultisigFamily,
  newSigners: Signers,
  secondarySigners: Signers,
) =>
  asFunded(async (emulator, blaze, addr, userUtxo) => {
    const f = families[family];
    const seeded = {
      primaryForeverUtxo: scriptUtxo(
        "ee".repeat(32),
        f.forever.Script,
        "",
        multisigState(f.signers),
      ),
      primaryThresholdUtxo: thresholdUtxo("c0".repeat(32), f.threshold.Script),
      secondaryForeverUtxo: scriptUtxo(
        "dd".repeat(32),
        f.secondaryForever.Script,
        "",
        multisigState(f.secondarySigners),
      ),
      primaryTwoStageUtxo: scriptUtxo(
        "c1".repeat(32),
        f.twoStage.Script,
        MAIN_TOKEN_HEX,
        upgradeState(
          f.logic.Script.hash(),
          new Contracts.GovAuthMainGovAuthElse().Script.hash(),
        ),
      ),
      userUtxo,
    };
    for (const u of Object.values(seeded)) emulator.addUtxo(u);
    registerRewardAccount(emulator, f.logic.Script.hash());
    const builder = buildMultisigChangeTx(
      blaze,
      {
        ...seeded,
        primaryForever: f.forever.Script,
        logicScript: f.logic.Script,
        mitigationLogicScript: Option.none(),
        logicRound: 0,
        currentPrimarySigners: f.signers,
        secondarySigners,
        requirements: signerRequirements(
          Either.getOrThrow(authorityThreshold(THRESHOLD)),
          f.signers,
          secondarySigners,
          family,
        ),
      },
      {
        newSigners,
        networkId: NetworkId.Testnet,
        changeAddress: addr,
        commandName: `change-${family}`,
        feePadding: 0n,
      },
    );
    return { emulator, blaze, builder };
  });

const newMember = signer("77");
const samePaymentHash = (seed: string): Signer => ({
  paymentHash: newMember.paymentHash,
  sr25519Key: seed.repeat(32),
});

describe("change-council / change-tech-auth", () => {
  test("council accepts the same payment hash three times under both authority witnesses", async () => {
    const { emulator, blaze, builder } = await multisigChange(
      "council",
      [samePaymentHash("de"), samePaymentHash("8c"), samePaymentHash("f6")],
      families.council.secondarySigners,
    );
    await emulator.expectValidTransaction(blaze, Either.getOrThrow(builder));
  });

  test("tech-auth accepts an added member under both authority witnesses", async () => {
    const { emulator, blaze, builder } = await multisigChange(
      "tech-auth",
      [...techAuthSigners, newMember],
      families["tech-auth"].secondarySigners,
    );
    await emulator.expectValidTransaction(blaze, Either.getOrThrow(builder));
  });

  test.each(["council", "tech-auth"] as const)(
    "%s: a secondary witness over the wrong signers is rejected by the logic",
    async (family) => {
      const { emulator, builder } = await multisigChange(
        family,
        families[family].signers,
        [
          families[family].secondarySigners[0],
          families[family].secondarySigners[1],
        ],
      );
      await emulator.expectScriptFailure(
        Either.getOrThrow(builder),
        /Withdraw\[0\][\s\S]*Validator returned false/,
      );
    },
  );

  test("more than 255 new signers cannot be encoded", async () => {
    const { builder } = await multisigChange(
      "council",
      [
        councilSigners[0],
        ...Array.from({ length: 255 }, () => councilSigners[0]),
      ],
      techAuthSigners,
    );
    expect(leftOf(builder)).toMatchObject({
      _tag: "InputParseError",
      source: "signers",
      issues: ["too many signers for simple CBOR encoding"],
    });
  });
});
