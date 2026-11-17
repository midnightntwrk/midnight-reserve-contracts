import {
  addressFromValidator,
  AssetId,
  AssetName,
  ConstrPlutusData,
  Credential,
  CredentialType,
  type Evaluator,
  ExUnits,
  Hash28ByteBase16,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PlutusList,
  PolicyId,
  RewardAccount,
  Script,
  Slot,
  fromHex,
  toHex,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import type { Blaze, Provider, Wallet } from "@blaze-cardano/sdk";
import { describe, expect, test } from "vite-plus/test";
import * as Contracts from "../contract_blueprint_default";
import {
  buildNativeScriptFromState,
  COUNCIL_WITNESS_ASSET,
  findUtxoByToken,
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
  TECH_WITNESS_ASSET,
} from "./helpers/upgrade";

// aiken.toml [config.default]: the seed UTxOs and the release constants.
const INIT_SEED_TX = "00".repeat(30) + "0102";
const PARAMS_SEED_TX = "00".repeat(30) + "0103";
const INITIAL_RESERVE = 6_000_000_000_873_988n;
const RELEASE_INTERVAL_MS = 21_600_000;
const FACTOR_N = 57_534_246_576n;
const FACTOR_D = 1_000_000_000_000_000n;
/** release_delta of the first interval. */
const delta = (INITIAL_RESERVE * FACTOR_N + FACTOR_D - 1n) / FACTOR_D;

const logicV2 = new Contracts.ReserveV2ReserveLogicV2Else();
const reserveForever = new Contracts.ReserveReserveForeverElse();
const reserveTwoStage = new Contracts.ReserveReserveTwoStageUpgradeElse();
const icsForever = new Contracts.IlliquidCirculationSupplyIcsForeverElse();
const mainGovAuth = new Contracts.GovAuthMainGovAuthElse();
const mainGovThreshold = new Contracts.ThresholdsMainGovThresholdElse();
const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
const councilForever = new Contracts.PermissionedCouncilForeverElse();
const nightPolicy =
  new Contracts.TestCnightNoAuditTcnightMintInfiniteElse().Script.hash();
const NIGHT_NAME = toHex(new TextEncoder().encode("NIGHT"));
const NIGHT = AssetId(nightPolicy + NIGHT_NAME);

const reserveAddress = addressFromValidator(
  NetworkId.Testnet,
  reserveForever.Script,
);
const icsAddress = addressFromValidator(NetworkId.Testnet, icsForever.Script);

/** Data with no binding: the deploy datum, the ICS datum, the publish redeemer. */
const constr = (index: bigint, fields: PlutusData[]) => {
  const list = new PlutusList();
  for (const field of fields) list.add(field);
  return PlutusData.newConstrPlutusData(new ConstrPlutusData(index, list));
};

const [INIT, RELEASE, PAUSE, UNPAUSE] = (
  ["Init", "Release", "Pause", "Unpause"] as const
).map((action) => serialize(Contracts.ReserveAction, action));

const [MINT_INIT_TOKENS, BURN_INIT_TOKEN] = (
  ["MintInitTokens", "BurnInitToken"] as const
).map((action) => serialize(Contracts.InitTokenAction, action));

const reserveState = (
  curve_remaining_star: bigint,
  cumulative_released_star: bigint,
  next_interval_start_ms: bigint,
  paused: boolean,
) =>
  serialize(Contracts.ReserveRewardState, {
    curve_remaining_star,
    cumulative_released_star,
    next_interval_start_ms,
    paused,
  });

const rewardAccount = (hash: string) =>
  RewardAccount.fromCredential(
    Credential.fromCore({
      hash: Hash28ByteBase16(hash),
      type: CredentialType.ScriptHash,
    }).toCore(),
    NetworkId.Testnet,
  );

const utxo = (
  txId: string,
  output: Parameters<typeof TransactionOutput.fromCore>[0],
) =>
  TransactionUnspentOutput.fromCore([
    { index: 0, txId: TransactionId(txId) },
    output,
  ]);

const stateOutput = (forever: Script, datum: PlutusData) =>
  TransactionOutput.fromCore({
    address: PaymentAddress(
      addressFromValidator(NetworkId.Testnet, forever).toBech32(),
    ),
    value: {
      coins: 2_000_000n,
      assets: new Map([[AssetId(forever.hash()), 1n]]),
    },
    datum: datum.toCore(),
  });

/** A reserve two-stage UTxO holding `token`, naming `logic` as its logic. */
const twoStageUtxo = (txId: string, token: string, logic: string) =>
  utxo(txId, {
    address: PaymentAddress(
      addressFromValidator(
        NetworkId.Testnet,
        reserveTwoStage.Script,
      ).toBech32(),
    ),
    value: {
      coins: 2_000_000n,
      assets: new Map([[AssetId(reserveTwoStage.Script.hash() + token), 1n]]),
    },
    datum: serialize(Contracts.UpgradeState, [
      logic,
      "",
      mainGovAuth.Script.hash(),
      "",
      0n,
      1n,
    ]).toCore(),
  });

/** Diagram 10: register reserve_logic_v2's credential and mint the init tokens against the seed UTxO. */
const deployLogicV2 = async (
  emulator: Emulator,
  blaze: Blaze<Provider, Wallet>,
  wallet: PaymentAddress,
) => {
  const seed = TransactionUnspentOutput.fromCore([
    { index: 0, txId: TransactionId(INIT_SEED_TX) },
    { address: wallet, value: { coins: 10_000_000n } },
  ]);
  emulator.addUtxo(seed);
  await emulator.expectValidTransaction(
    blaze,
    blaze
      .newTransaction()
      .addInput(seed)
      .addMint(
        PolicyId(logicV2.Script.hash()),
        new Map([
          [AssetName(MAIN_TOKEN_HEX), 1n],
          [AssetName(STAGING_TOKEN_HEX), 1n],
        ]),
        MINT_INIT_TOKENS,
      )
      .addRegisterStake(
        Credential.fromCore({
          hash: Hash28ByteBase16(logicV2.Script.hash()),
          type: CredentialType.ScriptHash,
        }),
        constr(0n, []),
      )
      .provideScript(logicV2.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: wallet,
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(logicV2.Script.hash() + MAIN_TOKEN_HEX), 1n],
              [AssetId(logicV2.Script.hash() + STAGING_TOKEN_HEX), 1n],
            ]),
          },
        }),
      ),
  );
  expect(emulator.accounts.has(rewardAccount(logicV2.Script.hash()))).toBe(
    true,
  );
};

describe("reserve_logic_v2 on the main track", () => {
  test("deploy (10), Init (12a), Release (13), Pause (14), Unpause (15), then the freeze (18, 19): Release runs, Pause and Unpause are refused", async () => {
    const emulator = new Emulator([]);

    await emulator.as("deployer", async (blaze, addr) => {
      const wallet = PaymentAddress(addr.toBech32());
      const paymentHash = addr.asBase()!.getPaymentCredential().hash;
      const stakeHash = addr.asBase()!.getStakeCredential().hash;
      emulator.addUtxo(
        utxo("ff".repeat(32), {
          address: wallet,
          value: { coins: 900_000_000n },
        }),
      );

      // Before reserve_logic_v2: the reserve two-stage main UTxO after the
      // promote of diagram 17, the forever NFT with the deploy datum, and the
      // reserve's NIGHT gathered into one UTxO.
      const twoStageMain = twoStageUtxo(
        "a0".repeat(32),
        MAIN_TOKEN_HEX,
        logicV2.Script.hash(),
      );
      const deployState = utxo("a1".repeat(32), {
        address: PaymentAddress(reserveAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([[AssetId(reserveForever.Script.hash()), 1n]]),
        },
        datum: constr(0n, [
          PlutusData.newInteger(0n),
          PlutusData.newInteger(0n),
        ]).toCore(),
      });
      const reserveNight = utxo("a2".repeat(32), {
        address: PaymentAddress(reserveAddress.toBech32()),
        value: {
          coins: 5_000_000n,
          assets: new Map([[NIGHT, INITIAL_RESERVE]]),
        },
      });
      emulator.addUtxo(twoStageMain);
      emulator.addUtxo(deployState);
      emulator.addUtxo(reserveNight);

      await deployLogicV2(emulator, blaze, wallet);

      // Diagram 12a: Init burns "main", reads the reserve NIGHT, and writes
      // initial_state().
      const tokens = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(addr),
        logicV2.Script.hash(),
        MAIN_TOKEN_HEX,
      );
      const initialState = reserveState(INITIAL_RESERVE, 0n, 0n, false);
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(deployState, PlutusData.newInteger(0n))
          .addInput(tokens)
          .addReferenceInput(twoStageMain)
          .addReferenceInput(reserveNight)
          .addMint(
            PolicyId(logicV2.Script.hash()),
            new Map([[AssetName(MAIN_TOKEN_HEX), -1n]]),
            BURN_INIT_TOKEN,
          )
          .addWithdrawal(rewardAccount(logicV2.Script.hash()), 0n, INIT)
          .provideScript(reserveForever.Script)
          .provideScript(logicV2.Script)
          .addOutput(stateOutput(reserveForever.Script, initialState))
          .addOutput(
            TransactionOutput.fromCore({
              address: wallet,
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [AssetId(logicV2.Script.hash() + STAGING_TOKEN_HEX), 1n],
                ]),
              },
            }),
          ),
      );
      const afterInit = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(reserveAddress),
        reserveForever.Script.hash(),
        "",
      );
      expect(PlutusData.fromCore(afterInit.toCore()[1].datum!).toCbor()).toBe(
        initialState.toCbor(),
      );

      // Diagram 13: once the first interval has ended, release one interval
      // to the ICS.
      emulator.stepForwardToUnix(
        emulator.slotToUnix(emulator.clock.slot) + RELEASE_INTERVAL_MS,
      );
      const released = reserveState(
        INITIAL_RESERVE - delta,
        delta,
        BigInt(RELEASE_INTERVAL_MS),
        false,
      );
      const from = emulator.clock.slot;
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(afterInit, PlutusData.newInteger(0n))
          .addInput(reserveNight, PlutusData.newInteger(0n))
          .addReferenceInput(twoStageMain)
          .addWithdrawal(rewardAccount(logicV2.Script.hash()), 0n, RELEASE)
          .provideScript(reserveForever.Script)
          .provideScript(logicV2.Script)
          .setValidFrom(Slot(from))
          .setValidUntil(
            Slot(from + Math.floor(1_800_000 / emulator.clock.slotLength)),
          )
          // Diagram 13: ICS, reserve NIGHT, state, in this order.
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(icsAddress.toBech32()),
              value: { coins: 2_000_000n, assets: new Map([[NIGHT, delta]]) },
              datum: constr(0n, []).toCore(),
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(reserveAddress.toBech32()),
              value: {
                coins: 5_000_000n,
                assets: new Map([[NIGHT, INITIAL_RESERVE - delta]]),
              },
            }),
          )
          .addOutput(stateOutput(reserveForever.Script, released)),
      );
      const ics = await blaze.provider.getUnspentOutputs(icsAddress);
      expect(
        ics.map((u) => u.output().amount().multiasset()?.get(NIGHT)),
      ).toEqual([delta]);

      // Diagrams 14 and 15: main_gov_auth pauses, then unpauses.
      const techState: Contracts.VersionedMultisig = [
        [1n, { ["8200581c" + paymentHash]: "11".repeat(32) }],
        0n,
      ];
      const councilState: Contracts.VersionedMultisig = [
        [1n, { ["8200581c" + stakeHash]: "22".repeat(32) }],
        0n,
      ];
      // Technical Authority 1/2 (the wallet's payment key signs); Council 0/1.
      const threshold: Contracts.MultisigThreshold = [1n, 2n, 0n, 1n];
      const techScript = buildNativeScriptFromState(techState, 1n, 2n);
      const councilScript = buildNativeScriptFromState(councilState, 0n, 1n);
      const govRefs = [
        utxo("b0".repeat(32), {
          address: PaymentAddress(
            addressFromValidator(
              NetworkId.Testnet,
              mainGovThreshold.Script,
            ).toBech32(),
          ),
          value: {
            coins: 3_000_000n,
            assets: new Map([[AssetId(mainGovThreshold.Script.hash()), 1n]]),
          },
          datum: serialize(Contracts.MultisigThreshold, threshold).toCore(),
        }),
        utxo("b1".repeat(32), {
          address: PaymentAddress(
            addressFromValidator(
              NetworkId.Testnet,
              techAuthForever.Script,
            ).toBech32(),
          ),
          value: {
            coins: 3_000_000n,
            assets: new Map([[AssetId(techAuthForever.Script.hash()), 1n]]),
          },
          datum: serialize(Contracts.VersionedMultisig, techState).toCore(),
        }),
        utxo("b2".repeat(32), {
          address: PaymentAddress(
            addressFromValidator(
              NetworkId.Testnet,
              councilForever.Script,
            ).toBech32(),
          ),
          value: {
            coins: 3_000_000n,
            assets: new Map([[AssetId(councilForever.Script.hash()), 1n]]),
          },
          datum: serialize(Contracts.VersionedMultisig, councilState).toCore(),
        }),
      ];
      for (const ref of govRefs) emulator.addUtxo(ref);
      emulator.accounts.set(rewardAccount(mainGovAuth.Script.hash()), {
        balance: 0n,
      });

      // main_gov_auth runs: its withdrawal, the two witness mints, and the
      // threshold, Technical Authority and Council reference inputs.
      const withGovAuth = (tx: TxBuilder) => {
        let authorised = tx
          .addWithdrawal(
            rewardAccount(mainGovAuth.Script.hash()),
            0n,
            PlutusData.newInteger(0n),
          )
          .addMint(
            PolicyId(techScript.hash()),
            new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
          )
          .addMint(
            PolicyId(councilScript.hash()),
            new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
          )
          .provideScript(mainGovAuth.Script)
          .provideScript(Script.newNativeScript(techScript))
          .provideScript(Script.newNativeScript(councilScript));
        for (const ref of govRefs)
          authorised = authorised.addReferenceInput(ref);
        return authorised;
      };

      const stateUtxo = async () =>
        findUtxoByToken(
          await blaze.provider.getUnspentOutputs(reserveAddress),
          reserveForever.Script.hash(),
          "",
        );

      /** Diagrams 14 and 15: the state takes `next` under the two-stage `main`. */
      const pauseTx = async (
        main: TransactionUnspentOutput,
        action: PlutusData,
        next: PlutusData,
      ) =>
        withGovAuth(
          blaze
            .newTransaction()
            .addInput(await stateUtxo(), PlutusData.newInteger(0n))
            .addReferenceInput(main)
            .addWithdrawal(rewardAccount(logicV2.Script.hash()), 0n, action)
            .provideScript(reserveForever.Script)
            .provideScript(logicV2.Script)
            .addOutput(stateOutput(reserveForever.Script, next)),
        );

      for (const [action, paused] of [
        [PAUSE, true],
        [UNPAUSE, false],
      ] as const) {
        const next = reserveState(
          INITIAL_RESERVE - delta,
          delta,
          BigInt(RELEASE_INTERVAL_MS),
          paused,
        );
        await emulator.expectValidTransaction(
          blaze,
          await pauseTx(twoStageMain, action, next),
        );
        expect(
          PlutusData.fromCore((await stateUtxo()).toCore()[1].datum!).toCbor(),
        ).toBe(next.toCbor());
      }

      // Diagram 18: main_gov_auth stages always_fails as the reserve
      // two-stage mitigation_auth.
      const alwaysFails = new Contracts.AlwaysFailsAlwaysFailsElse();
      const twoStageAddress = addressFromValidator(
        NetworkId.Testnet,
        reserveTwoStage.Script,
      );
      const frozenOutput = (token: string) =>
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(reserveTwoStage.Script.hash() + token), 1n],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, [
            logicV2.Script.hash(),
            "",
            mainGovAuth.Script.hash(),
            alwaysFails.Script.hash(),
            1n,
            1n,
          ]).toCore(),
        });
      const twoStageStaging = twoStageUtxo(
        "a3".repeat(32),
        STAGING_TOKEN_HEX,
        logicV2.Script.hash(),
      );
      emulator.addUtxo(twoStageStaging);
      await emulator.expectValidTransaction(
        blaze,
        withGovAuth(
          blaze
            .newTransaction()
            .addInput(
              twoStageStaging,
              serialize(Contracts.TwoStageRedeemer, [
                "MitigationAuth",
                {
                  Staging: [
                    { transaction_id: "a0".repeat(32), output_index: 0n },
                    alwaysFails.Script.hash(),
                  ],
                },
              ]),
            )
            .addReferenceInput(twoStageMain)
            .provideScript(reserveTwoStage.Script)
            .addOutput(frozenOutput(STAGING_TOKEN_HEX)),
        ),
      );

      // Diagram 19: main_gov_auth promotes it to main: the freeze.
      const staged = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(twoStageAddress),
        reserveTwoStage.Script.hash(),
        STAGING_TOKEN_HEX,
      );
      await emulator.expectValidTransaction(
        blaze,
        withGovAuth(
          blaze
            .newTransaction()
            .addInput(
              twoStageMain,
              serialize(Contracts.TwoStageRedeemer, [
                "MitigationAuth",
                {
                  Main: [
                    {
                      transaction_id: staged.input().transactionId(),
                      output_index: staged.input().index(),
                    },
                  ],
                },
              ]),
            )
            .addReferenceInput(staged)
            .provideScript(reserveTwoStage.Script)
            .addOutput(frozenOutput(MAIN_TOKEN_HEX)),
        ),
      );
      const frozenMain = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(twoStageAddress),
        reserveTwoStage.Script.hash(),
        MAIN_TOKEN_HEX,
      );
      expect(frozenMain.output().datum()?.asInlineData()?.toCbor()).toBe(
        frozenOutput(MAIN_TOKEN_HEX).datum()?.asInlineData()?.toCbor(),
      );

      // After the freeze, Release still runs: it reads no auth. The second
      // interval.
      emulator.stepForwardToUnix(
        emulator.slotToUnix(emulator.clock.slot) + RELEASE_INTERVAL_MS,
      );
      const delta2 =
        ((INITIAL_RESERVE - delta) * FACTOR_N + FACTOR_D - 1n) / FACTOR_D;
      const releasedTwice = reserveState(
        INITIAL_RESERVE - delta - delta2,
        delta + delta2,
        BigInt(2 * RELEASE_INTERVAL_MS),
        false,
      );
      const nightLeft = (
        await blaze.provider.getUnspentOutputs(reserveAddress)
      ).find((u) => u.output().amount().multiasset()?.has(NIGHT))!;
      const second = emulator.clock.slot;
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(await stateUtxo(), PlutusData.newInteger(0n))
          .addInput(nightLeft, PlutusData.newInteger(0n))
          .addReferenceInput(frozenMain)
          .addWithdrawal(rewardAccount(logicV2.Script.hash()), 0n, RELEASE)
          .provideScript(reserveForever.Script)
          .provideScript(logicV2.Script)
          .setValidFrom(Slot(second))
          .setValidUntil(
            Slot(second + Math.floor(1_800_000 / emulator.clock.slotLength)),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(icsAddress.toBech32()),
              value: { coins: 2_000_000n, assets: new Map([[NIGHT, delta2]]) },
              datum: constr(0n, []).toCore(),
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(reserveAddress.toBech32()),
              value: {
                coins: 5_000_000n,
                assets: new Map([[NIGHT, INITIAL_RESERVE - delta - delta2]]),
              },
            }),
          )
          .addOutput(stateOutput(reserveForever.Script, releasedTwice)),
      );
      expect(
        PlutusData.fromCore((await stateUtxo()).toCore()[1].datum!).toCbor(),
      ).toBe(releasedTwice.toCbor());

      // Pause and Unpause now need always_fails to run, and the ledger refuses
      // both. With main_gov_auth alone, the builder cannot evaluate the
      // transaction, so it goes to the ledger with a fixed budget, and the
      // ledger names the reserve logic. With always_fails's withdrawal added,
      // the builder evaluates it with main_gov_auth's code standing in for
      // always_fails, so every other script passes, and the ledger, running
      // the real always_fails, names always_fails. The ledger names one
      // failing script and indexes withdrawals by credential.
      emulator.accounts.set(rewardAccount(alwaysFails.Script.hash()), {
        balance: 0n,
      });
      const fixedBudget: Evaluator = async (tx) => {
        const redeemers = tx.witnessSet().redeemers()!;
        redeemers.setValues(
          redeemers.values().map((redeemer) => {
            redeemer.setExUnits(
              ExUnits.fromCore({ memory: 3_000_000, steps: 2_000_000_000 }),
            );
            return redeemer;
          }),
        );
        return redeemers;
      };
      const ledgerError = async (tx: TxBuilder) =>
        emulator
          .submitTransaction(await blaze.signTransaction(await tx.complete()))
          .then(
            () => "accepted",
            (error) => String(error),
          );
      for (const [action, paused] of [
        [PAUSE, true],
        [UNPAUSE, false],
      ] as const) {
        const next = reserveState(
          INITIAL_RESERVE - delta - delta2,
          delta + delta2,
          BigInt(2 * RELEASE_INTERVAL_MS),
          paused,
        );
        const authOnly = [mainGovAuth.Script.hash(), logicV2.Script.hash()];
        expect(
          (
            await ledgerError(
              (await pauseTx(frozenMain, action, next)).useEvaluator(
                fixedBudget,
              ),
            )
          ).match(/(Spend|Mint|Withdraw)\[\d+\]/g),
        ).toEqual([
          `Withdraw[${authOnly.sort().indexOf(logicV2.Script.hash())}]`,
        ]);

        const withAlwaysFails = [...authOnly, alwaysFails.Script.hash()];
        expect(
          (
            await ledgerError(
              (await pauseTx(frozenMain, action, next))
                .addWithdrawal(
                  rewardAccount(alwaysFails.Script.hash()),
                  0n,
                  PlutusData.newInteger(0n),
                )
                .provideScript(alwaysFails.Script)
                // The provider's evaluator drops substitutions; the
                // emulator's own UPLC evaluator keeps them.
                .useEvaluator(emulator.evaluator)
                .useScriptSubstitutions(
                  new Map([[alwaysFails.Script.hash(), mainGovAuth.Script]]),
                ),
            )
          ).match(/(Spend|Mint|Withdraw)\[\d+\]/g),
        ).toEqual([
          `Withdraw[${withAlwaysFails.sort().indexOf(alwaysFails.Script.hash())}]`,
        ]);
      }
      expect(
        PlutusData.fromCore((await stateUtxo()).toCore()[1].datum!).toCbor(),
      ).toBe(releasedTwice.toCbor());
    });
  });
});

describe("reserve_logic_v2 on the staging track", () => {
  test("staging params (11), Init (12b) and Release (13) with test NIGHT", async () => {
    const emulator = new Emulator([]);
    const stagingForever =
      new Contracts.StagingReserveIcsReserveStagingForeverElse();
    const stagingAddress = addressFromValidator(
      NetworkId.Testnet,
      stagingForever.Script,
    );
    const stagingParams = new Contracts.ReserveV2ReserveStagingParamsElse();
    const paramsAddress = addressFromValidator(
      NetworkId.Testnet,
      stagingParams.Script,
    );
    // The test destination: the staging ICS forever.
    const destination = new Contracts.StagingReserveIcsIcsStagingForeverElse();
    const destinationAddress = addressFromValidator(
      NetworkId.Testnet,
      destination.Script,
    );
    const testPolicy = "a1".repeat(28);
    const TEST_NIGHT = AssetId(testPolicy + NIGHT_NAME);

    await emulator.as("deployer", async (blaze, addr) => {
      const wallet = PaymentAddress(addr.toBech32());
      emulator.addUtxo(
        utxo("ff".repeat(32), {
          address: wallet,
          value: { coins: 900_000_000n },
        }),
      );

      // reserve_logic_v2 is staged (diagram 16): the two-stage staging UTxO
      // names it, the main UTxO still names reserve_logic. The staging track
      // runs the main track's reserve_logic_v2: the same script, the same hash.
      const oldLogic = new Contracts.ReserveReserveLogicElse().Script.hash();
      expect(oldLogic).not.toBe(logicV2.Script.hash());
      const twoStageMain = twoStageUtxo(
        "a0".repeat(32),
        MAIN_TOKEN_HEX,
        oldLogic,
      );
      const twoStageStaging = twoStageUtxo(
        "a3".repeat(32),
        STAGING_TOKEN_HEX,
        logicV2.Script.hash(),
      );
      // reserve_staging_forever's NFT with the deploy datum, and test NIGHT.
      const deployState = utxo("a1".repeat(32), {
        address: PaymentAddress(stagingAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([[AssetId(stagingForever.Script.hash()), 1n]]),
        },
        datum: constr(0n, [
          PlutusData.newInteger(0n),
          PlutusData.newInteger(0n),
        ]).toCore(),
      });
      const stagingNight = utxo("a2".repeat(32), {
        address: PaymentAddress(stagingAddress.toBech32()),
        value: {
          coins: 5_000_000n,
          assets: new Map([[TEST_NIGHT, INITIAL_RESERVE]]),
        },
      });
      emulator.addUtxo(twoStageMain);
      emulator.addUtxo(twoStageStaging);
      emulator.addUtxo(deployState);
      emulator.addUtxo(stagingNight);

      await deployLogicV2(emulator, blaze, wallet);

      // Diagram 11: reserve_staging_params mints its own NFT against its
      // seed UTxO.
      const seed = TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId(PARAMS_SEED_TX) },
        { address: wallet, value: { coins: 10_000_000n } },
      ]);
      emulator.addUtxo(seed);
      const fields = new PlutusList();
      for (const hash of [
        testPolicy,
        stagingForever.Script.hash(),
        destination.Script.hash(),
      ]) {
        fields.add(PlutusData.newBytes(fromHex(hash)));
      }
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(seed)
          .addMint(
            PolicyId(stagingParams.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            constr(0n, []),
          )
          .provideScript(stagingParams.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(paramsAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([[AssetId(stagingParams.Script.hash()), 1n]]),
              },
              datum: PlutusData.newList(fields).toCore(),
            }),
          ),
      );
      const params = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(paramsAddress),
        stagingParams.Script.hash(),
        "",
      );

      // Diagram 12b: Init burns "staging" against reserve_staging_forever.
      const tokens = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(addr),
        logicV2.Script.hash(),
        STAGING_TOKEN_HEX,
      );
      const initialState = reserveState(INITIAL_RESERVE, 0n, 0n, false);
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(deployState, PlutusData.newInteger(0n))
          .addInput(tokens)
          .addReferenceInput(twoStageMain)
          .addReferenceInput(twoStageStaging)
          .addReferenceInput(params)
          .addReferenceInput(stagingNight)
          .addMint(
            PolicyId(logicV2.Script.hash()),
            new Map([[AssetName(STAGING_TOKEN_HEX), -1n]]),
            BURN_INIT_TOKEN,
          )
          .addWithdrawal(rewardAccount(logicV2.Script.hash()), 0n, INIT)
          .provideScript(stagingForever.Script)
          .provideScript(logicV2.Script)
          .addOutput(stateOutput(stagingForever.Script, initialState))
          .addOutput(
            TransactionOutput.fromCore({
              address: wallet,
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [AssetId(logicV2.Script.hash() + MAIN_TOKEN_HEX), 1n],
                ]),
              },
            }),
          ),
      );
      const afterInit = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(stagingAddress),
        stagingForever.Script.hash(),
        "",
      );
      expect(PlutusData.fromCore(afterInit.toCore()[1].datum!).toCbor()).toBe(
        initialState.toCbor(),
      );

      // Diagram 13 on the staging track: test NIGHT from
      // reserve_staging_forever to the test destination.
      emulator.stepForwardToUnix(
        emulator.slotToUnix(emulator.clock.slot) + RELEASE_INTERVAL_MS,
      );
      const released = reserveState(
        INITIAL_RESERVE - delta,
        delta,
        BigInt(RELEASE_INTERVAL_MS),
        false,
      );
      const from = emulator.clock.slot;
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(afterInit, PlutusData.newInteger(0n))
          .addInput(stagingNight, PlutusData.newInteger(0n))
          .addReferenceInput(twoStageMain)
          .addReferenceInput(twoStageStaging)
          .addReferenceInput(params)
          .addWithdrawal(rewardAccount(logicV2.Script.hash()), 0n, RELEASE)
          .provideScript(stagingForever.Script)
          .provideScript(logicV2.Script)
          .setValidFrom(Slot(from))
          .setValidUntil(
            Slot(from + Math.floor(1_800_000 / emulator.clock.slotLength)),
          )
          // Diagram 13: ICS, reserve NIGHT, state, in this order.
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(destinationAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([[TEST_NIGHT, delta]]),
              },
              datum: constr(0n, []).toCore(),
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(stagingAddress.toBech32()),
              value: {
                coins: 5_000_000n,
                assets: new Map([[TEST_NIGHT, INITIAL_RESERVE - delta]]),
              },
            }),
          )
          .addOutput(stateOutput(stagingForever.Script, released)),
      );
      const received =
        await blaze.provider.getUnspentOutputs(destinationAddress);
      expect(
        received.map((u) => u.output().amount().multiasset()?.get(TEST_NIGHT)),
      ).toEqual([delta]);
    });
  });
});
