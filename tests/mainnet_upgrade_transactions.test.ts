import {
  NetworkId,
  PaymentAddress,
  type Script,
  TransactionId,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type { TxBuilder } from "@blaze-cardano/tx";
import { parse, serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import type { Blaze, Provider, Wallet } from "@blaze-cardano/sdk";
import { describe, expect, test } from "bun:test";
import { Either, Option } from "effect";
import { decodeSigners } from "../cli/datum/signers";
import {
  buildPromoteUpgradeTx,
  buildStageUpgradeTx,
  type GovernanceAuthority,
  nextStagingState,
  promotedMainState,
  type TwoStageTarget,
  type UpgradeField,
} from "../cli/governance/two-stage-upgrade";
import {
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
} from "../cli/chain/governance-provider";

import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import {
  liveThresholds,
  liveUpgradeStates,
  mainnetSnapshotUtxos as snap,
} from "./helpers/mainnet-snapshot";
import {
  registerRewardAccount,
  findUtxoByToken,
  asFunded,
  requirementsOf,
} from "./helpers/fixtures";

const mainGovAuth = new Contracts.GovAuthMainGovAuthElse();
const stagingGovAuth = new Contracts.GovAuthStagingGovAuthElse();
const reserveTwoStage = new Contracts.ReserveReserveTwoStageUpgradeElse();
const councilTwoStage = new Contracts.PermissionedCouncilTwoStageUpgradeElse();
const techAuthTwoStage =
  new Contracts.PermissionedTechAuthTwoStageUpgradeElse();

const signersOf = (utxo: TransactionUnspentOutput) =>
  Either.getOrThrow(decodeSigners(utxo.output().datum()!.asInlineData()!));
const techAuthSigners = signersOf(snap.techAuthForever);
const councilSigners = signersOf(snap.councilForever);

const authority = (
  govAuth: Script,
  thresholdUtxo: TransactionUnspentOutput,
  threshold: Contracts.MultisigThreshold,
  councilMainUtxo: Option.Option<TransactionUnspentOutput>,
): GovernanceAuthority => ({
  govAuth,
  thresholdUtxo,
  techAuthForeverUtxo: snap.techAuthForever,
  councilForeverUtxo: snap.councilForever,
  techAuthSigners,
  councilSigners,
  requirements: requirementsOf({ techAuthSigners, councilSigners }, threshold),
  councilMainUtxo,
});
const mainAuthority = authority(
  mainGovAuth.Script,
  snap.mainGovThreshold,
  liveThresholds.main,
  Option.none(),
);
const stagingAuthority = authority(
  stagingGovAuth.Script,
  snap.stagingGovThreshold,
  liveThresholds.staging,
  Option.some(snap.councilMain),
);

const target = (
  twoStage: Script,
  mainUtxo: TransactionUnspentOutput,
  stagingUtxo: TransactionUnspentOutput,
): TwoStageTarget => ({
  twoStage,
  mainUtxo,
  stagingUtxo,
  scriptRef: Option.none(),
});
const reserveTarget = target(
  reserveTwoStage.Script,
  snap.reserveMain,
  snap.reserveStaging,
);

const [reserveLogic, , mainAuth] = liveUpgradeStates.reserve.main;
const stagingAuth = liveUpgradeStates.reserve.staging[2];

/** A funded emulator seeded with the target and the authority; `tx` builds stage and promote against them. */
const onSnapshot = (
  auth: GovernanceAuthority,
  tgt: TwoStageTarget,
  body: (
    emulator: Emulator,
    blaze: Blaze<Provider, Wallet>,
    tx: {
      stage: (field: UpgradeField, newHash: string) => TxBuilder;
      promote: (
        field: UpgradeField,
        authority?: GovernanceAuthority,
      ) => TxBuilder;
    },
  ) => Promise<void>,
) =>
  asFunded((emulator, blaze, addr, userUtxo) => {
    for (const utxo of [
      tgt.mainUtxo,
      tgt.stagingUtxo,
      auth.thresholdUtxo,
      auth.techAuthForeverUtxo,
      auth.councilForeverUtxo,
      ...Option.toArray(auth.councilMainUtxo),
    ])
      emulator.addUtxo(utxo);
    registerRewardAccount(emulator, auth.govAuth.hash(), NetworkId.Mainnet);
    const params = {
      networkId: NetworkId.Mainnet,
      changeAddress: addr,
      feePadding: 0n,
    };
    return body(emulator, blaze, {
      stage: (field, newHash) =>
        Either.getOrThrow(
          buildStageUpgradeTx(
            blaze,
            { target: tgt, authority: auth, userUtxo },
            { ...params, field, newHash },
          ),
        ),
      promote: (field, authority = auth) =>
        Either.getOrThrow(
          buildPromoteUpgradeTx(
            blaze,
            { target: tgt, authority, userUtxo },
            { ...params, field, registerLogic: Option.none() },
          ),
        ),
    });
  });

/** The UpgradeState on the ledger UTxO holding the reserve token. */
const reserveState = (emulator: Emulator, tokenHex: string) =>
  parse(
    Contracts.UpgradeState,
    findUtxoByToken(emulator.utxos(), reserveTwoStage.Script.hash(), tokenHex)
      .output()
      .datum()!
      .asInlineData()!,
  );

/** The snapshot UTxO with another datum under a fresh tx id. */
const cloneUpgradeUtxo = (
  utxo: TransactionUnspentOutput,
  datum: Contracts.UpgradeState,
  txByte = "b6",
) => {
  const output = utxo.output();
  return TransactionUnspentOutput.fromCore([
    { txId: TransactionId(txByte.repeat(32)), index: 0 },
    {
      address: PaymentAddress(output.address().toBech32()),
      value: {
        coins: output.amount().coin(),
        assets: new Map(output.amount().multiasset()),
      },
      datum: serialize(Contracts.UpgradeState, datum).toCore(),
    },
  ]);
};

// The CLI builders against mainnet snapshot UTxOs, validated by the deployed scripts in the emulator.
describe("Mainnet snapshot upgrade transactions", () => {
  test("reserve promote-auth via main authority moves the staged auth and preserves the other fields", () =>
    onSnapshot(mainAuthority, reserveTarget, async (emulator, blaze, tx) => {
      const { techAuth, council } = mainAuthority.requirements;
      expect(techAuth).toEqual({ required: 6, total: 9 });
      expect(council).toEqual({ required: 4, total: 6 });
      await emulator.expectValidTransaction(blaze, tx.promote("Auth"));
      expect(reserveState(emulator, MAIN_TOKEN_HEX)).toEqual([
        reserveLogic,
        "",
        stagingAuth,
        "",
        0n,
        0n,
      ]);
    }));

  test("council stage-auth via main authority validates", () =>
    onSnapshot(
      mainAuthority,
      target(councilTwoStage.Script, snap.councilMain, snap.councilStaging),
      async (emulator, blaze, tx) => {
        await emulator.expectValidTransaction(
          blaze,
          tx.stage("Auth", "cd".repeat(28)),
        );
      },
    ));

  test("tech-auth stage-auth via staging authority references council main and uses staging threshold", () =>
    onSnapshot(
      stagingAuthority,
      target(techAuthTwoStage.Script, snap.techAuthMain, snap.techAuthStaging),
      async (emulator, blaze, tx) => {
        const { techAuth, council } = stagingAuthority.requirements;
        expect(techAuth.required).toBe(5);
        expect(council.required).toBe(0);
        await emulator.expectValidTransaction(
          blaze,
          tx.stage("Auth", "cd".repeat(28)),
        );
      },
    ));

  test("reserve stage-logic via staging authority references council main and uses staging threshold", () =>
    onSnapshot(stagingAuthority, reserveTarget, async (emulator, blaze, tx) => {
      await emulator.expectValidTransaction(
        blaze,
        tx.stage("Logic", "ce".repeat(28)),
      );
    }));

  test.each([
    {
      field: "MitigationLogic",
      hash: "d1".repeat(28),
      staged: [reserveLogic, "d1".repeat(28), stagingAuth, "", 1n, 0n],
    },
    {
      field: "MitigationAuth",
      hash: "d2".repeat(28),
      staged: [reserveLogic, "", stagingAuth, "d2".repeat(28), 1n, 0n],
    },
  ] satisfies {
    field: UpgradeField;
    hash: string;
    staged: Contracts.UpgradeState;
  }[])(
    "reserve stage-$field via main authority updates only that field and the round",
    ({ field, hash, staged }) =>
      onSnapshot(mainAuthority, reserveTarget, async (emulator, blaze, tx) => {
        await emulator.expectValidTransaction(blaze, tx.stage(field, hash));
        expect(reserveState(emulator, STAGING_TOKEN_HEX)).toEqual(staged);
      }),
  );

  test.each([
    {
      field: "Logic",
      hash: "ce".repeat(28),
      promoted: ["ce".repeat(28), "", mainAuth, "", 0n, 1n],
    },
    {
      field: "MitigationLogic",
      hash: "d1".repeat(28),
      promoted: [reserveLogic, "d1".repeat(28), mainAuth, "", 1n, 0n],
    },
    {
      field: "MitigationAuth",
      hash: "d2".repeat(28),
      promoted: [reserveLogic, "", mainAuth, "d2".repeat(28), 1n, 0n],
    },
  ] satisfies {
    field: UpgradeField;
    hash: string;
    promoted: Contracts.UpgradeState;
  }[])(
    "reserve promote-$field via main authority copies the staged field and its round",
    ({ field, hash, promoted }) =>
      onSnapshot(
        mainAuthority,
        target(
          reserveTwoStage.Script,
          snap.reserveMain,
          cloneUpgradeUtxo(
            snap.reserveStaging,
            nextStagingState(field, liveUpgradeStates.reserve.staging, hash),
          ),
        ),
        async (emulator, blaze, tx) => {
          await emulator.expectValidTransaction(blaze, tx.promote(field));
          expect(reserveState(emulator, MAIN_TOKEN_HEX)).toEqual(promoted);
        },
      ),
  );

  test("a council witness over the wrong signers is rejected by the gov auth", () =>
    onSnapshot(mainAuthority, reserveTarget, async (emulator, blaze, tx) => {
      await emulator.expectScriptFailure(
        tx.promote("Auth", {
          ...mainAuthority,
          councilSigners: [councilSigners[0], councilSigners[1]!],
        }),
        /Withdraw\[0\][\s\S]*Validator returned false/,
      );
    }));

  test("a MitigationLogic promote over a main that already has one is rejected", () => {
    const [logic, , auth, mitigationAuth, round, logicRound] =
      liveUpgradeStates.reserve.main;
    return onSnapshot(
      mainAuthority,
      target(
        reserveTwoStage.Script,
        cloneUpgradeUtxo(
          snap.reserveMain,
          [logic, "d0".repeat(28), auth, mitigationAuth, round, logicRound],
          "b7",
        ),
        cloneUpgradeUtxo(
          snap.reserveStaging,
          nextStagingState(
            "MitigationLogic",
            liveUpgradeStates.reserve.staging,
            "d1".repeat(28),
          ),
        ),
      ),
      async (emulator, _blaze, tx) => {
        await emulator.expectScriptFailure(
          tx.promote("MitigationLogic"),
          /Spend\[\d+\]/,
        );
      },
    );
  });

  test("a 27-byte logic hash is rejected by the two-stage validator", () =>
    onSnapshot(mainAuthority, reserveTarget, async (emulator, blaze, tx) => {
      await emulator.expectScriptFailure(
        tx.stage("Logic", "ce".repeat(27)),
        /Spend\[\d+\]/,
      );
    }));
});

describe("UpgradeState transitions", () => {
  const state: Contracts.UpgradeState = ["l0", "m0", "a0", "n0", 3n, 7n];
  const staging: Contracts.UpgradeState = ["l1", "m1", "a1", "n1", 9n, 8n];

  test.each([
    [
      "Logic",
      "l1",
      ["l1", "m0", "a0", "n0", 3n, 8n],
      ["l1", "m0", "a0", "n0", 3n, 8n],
    ],
    [
      "Auth",
      "a1",
      ["l0", "m0", "a1", "n0", 4n, 7n],
      ["l0", "m0", "a1", "n0", 9n, 7n],
    ],
    [
      "MitigationLogic",
      "m1",
      ["l0", "m1", "a0", "n0", 4n, 7n],
      ["l0", "m1", "a0", "n0", 9n, 7n],
    ],
    [
      "MitigationAuth",
      "n1",
      ["l0", "m0", "a0", "n1", 4n, 7n],
      ["l0", "m0", "a0", "n1", 9n, 7n],
    ],
  ] satisfies [
    UpgradeField,
    string,
    Contracts.UpgradeState,
    Contracts.UpgradeState,
  ][])(
    "%s: staging bumps its round; promotion copies the field and its round",
    (field, hash, staged, promoted) => {
      expect(nextStagingState(field, state, hash)).toEqual(staged);
      expect(promotedMainState(field, state, staging)).toEqual(promoted);
    },
  );
});
