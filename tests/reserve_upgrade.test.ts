import {
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  NetworkId,
  PaymentAddress,
  PolicyId,
  RewardAccount,
  Script,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import * as Contracts from "../contract_blueprint";
import { describe, test } from "bun:test";
import {
  buildNativeScriptFromState,
  COUNCIL_WITNESS_ASSET,
  expectDatum,
  findUtxoByToken,
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
  TECH_WITNESS_ASSET,
} from "./helpers/upgrade";

describe("Reserve upgrade path", () => {
  test("deploy reserve, stage new logic, then promote to main", async () => {
    const emulator = new Emulator([]);
    const govAuth = new Contracts.GovAuthMainGovAuthElse();
    const mainGovThreshold = new Contracts.ThresholdsMainGovThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();

    const reserveTwoStage = new Contracts.ReserveReserveTwoStageUpgradeElse();
    const reserveLogic = new Contracts.ReserveReserveLogicElse();

    const govAuthRewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: govAuth.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(govAuthRewardAccount, { balance: 0n });

    const reserveTwoStageAddress = addressFromValidator(
      NetworkId.Testnet,
      reserveTwoStage.Script,
    );

    const initialReserveUpgradeState: Contracts.UpgradeState = [
      reserveLogic.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
      0n,
    ];

    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxos = Array.from({ length: 4 }).map((_, idx) => {
        const txSuffix = idx.toString(16).padStart(4, "0");
        return TransactionUnspentOutput.fromCore([
          {
            index: idx,
            txId: TransactionId("ff".repeat(30) + txSuffix),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 900_000_000n,
            },
          },
        ]);
      });
      fundingUtxos.forEach((utxo) => emulator.addUtxo(utxo));

      const paymentHash = addr.asBase()?.getPaymentCredential().hash!;
      const stakeHash = addr.asBase()?.getStakeCredential().hash!;

      // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
      const techAuthForeverState: Contracts.VersionedMultisig = [
        [
          1n,
          {
            ["8200581c" + paymentHash]:
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
          },
        ],
        0n,
      ];

      // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
      const councilForeverState: Contracts.VersionedMultisig = [
        [
          1n,
          {
            ["8200581c" + stakeHash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ],
        0n,
      ];

      // MultisigThreshold is now a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
      const thresholdDatum: Contracts.MultisigThreshold = [1n, 2n, 1n, 2n];

      const govAuthRedeemerData = serialize(Contracts.PermissionedRedeemer, {
        [paymentHash]:
          "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
      });

      // MultisigThreshold tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
      const techNativeScript = buildNativeScriptFromState(
        techAuthForeverState,
        thresholdDatum[0], // technical_auth_numerator
        thresholdDatum[1], // technical_auth_denominator
      );

      const councilNativeScript = buildNativeScriptFromState(
        councilForeverState,
        thresholdDatum[2], // council_numerator
        thresholdDatum[3], // council_denominator
      );

      const techWitnessPolicy = techNativeScript.hash();
      const councilWitnessPolicy = councilNativeScript.hash();

      const techForeverUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("11".repeat(32)),
        },
        {
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
          datum: serialize(
            Contracts.VersionedMultisig,
            techAuthForeverState,
          ).toCore(),
        },
      ]);

      const councilForeverUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("22".repeat(32)),
        },
        {
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
          datum: serialize(
            Contracts.VersionedMultisig,
            councilForeverState,
          ).toCore(),
        },
      ]);

      const mainGovThresholdUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("33".repeat(32)),
        },
        {
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
          datum: serialize(
            Contracts.MultisigThreshold,
            thresholdDatum,
          ).toCore(),
        },
      ]);

      emulator.addUtxo(techForeverUtxo);
      emulator.addUtxo(councilForeverUtxo);
      emulator.addUtxo(mainGovThresholdUtxo);

      // Add reserve two-stage UTxOs (main and staging)
      const reserveMainUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("aa".repeat(32)),
        },
        {
          address: PaymentAddress(reserveTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            initialReserveUpgradeState,
          ).toCore(),
        },
      ]);

      const reserveStagingUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("bb".repeat(32)),
        },
        {
          address: PaymentAddress(reserveTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX), 1n],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            initialReserveUpgradeState,
          ).toCore(),
        },
      ]);

      emulator.addUtxo(reserveMainUtxo);
      emulator.addUtxo(reserveStagingUtxo);

      const applyGovernanceWitnesses = (txBuilder: TxBuilder) =>
        txBuilder
          .addMint(
            PolicyId(techWitnessPolicy),
            new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
          )
          .addMint(
            PolicyId(councilWitnessPolicy),
            new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
          )
          .provideScript(Script.newNativeScript(techNativeScript))
          .provideScript(Script.newNativeScript(councilNativeScript));

      const stageReserveUpdate = async (
        newLogicHash: string,
        fundingUtxo: TransactionUnspentOutput,
      ) => {
        const scriptUtxos = await blaze.provider.getUnspentOutputs(
          reserveTwoStageAddress,
        );

        const mainRef = findUtxoByToken(
          scriptUtxos,
          reserveTwoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        );
        const stagingInput = findUtxoByToken(
          scriptUtxos,
          reserveTwoStage.Script.hash(),
          STAGING_TOKEN_HEX,
        );

        const [mainInput] = mainRef.toCore();
        // TwoStageRedeemer is now a tuple: [UpdateField, WhichStage]
        const redeemer = serialize(Contracts.TwoStageRedeemer, [
          "Logic",
          {
            Staging: [
              {
                transaction_id: mainInput.txId.toString(),
                output_index: BigInt(mainInput.index),
              },
              newLogicHash,
            ],
          },
        ]);

        const tx = applyGovernanceWitnesses(
          blaze
            .newTransaction()
            .addInput(stagingInput, redeemer)
            .addInput(fundingUtxo)
            .addReferenceInput(mainRef)
            .addReferenceInput(mainGovThresholdUtxo)
            .addReferenceInput(techForeverUtxo)
            .addReferenceInput(councilForeverUtxo)
            .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
            .provideScript(reserveTwoStage.Script)
            .provideScript(govAuth.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX,
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, [
                  newLogicHash,
                  "",
                  govAuth.Script.hash(),
                  "",
                  0n,
                  1n,
                ]).toCore(),
              }),
            ),
        );

        await emulator.expectValidTransaction(blaze, tx);
      };

      const promoteReserveMain = async (
        stagedHash: string,
        fundingUtxo: TransactionUnspentOutput,
      ) => {
        const scriptUtxos = await blaze.provider.getUnspentOutputs(
          reserveTwoStageAddress,
        );

        const mainInput = findUtxoByToken(
          scriptUtxos,
          reserveTwoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        );
        const stagingRef = findUtxoByToken(
          scriptUtxos,
          reserveTwoStage.Script.hash(),
          STAGING_TOKEN_HEX,
        );
        const [stagingInput] = stagingRef.toCore();

        // TwoStageRedeemer is now a tuple: [UpdateField, WhichStage]
        const redeemer = serialize(Contracts.TwoStageRedeemer, [
          "Logic",
          {
            Main: [
              {
                transaction_id: stagingInput.txId.toString(),
                output_index: BigInt(stagingInput.index),
              },
            ],
          },
        ]);

        const tx = applyGovernanceWitnesses(
          blaze
            .newTransaction()
            .addInput(mainInput, redeemer)
            .addInput(fundingUtxo)
            .addReferenceInput(stagingRef)
            .addReferenceInput(mainGovThresholdUtxo)
            .addReferenceInput(techForeverUtxo)
            .addReferenceInput(councilForeverUtxo)
            .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
            .provideScript(reserveTwoStage.Script)
            .provideScript(govAuth.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(reserveTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, [
                  stagedHash,
                  "",
                  govAuth.Script.hash(),
                  "",
                  0n,
                  1n,
                ]).toCore(),
              }),
            ),
        );

        await emulator.expectValidTransaction(blaze, tx);
      };

      const newReserveLogicHash = "55".repeat(28);

      // Stage the new logic
      await stageReserveUpdate(newReserveLogicHash, fundingUtxos[0]);

      // Promote to main
      await promoteReserveMain(newReserveLogicHash, fundingUtxos[1]);

      // Verify final state
      const reserveUtxos = await blaze.provider.getUnspentOutputs(
        reserveTwoStageAddress,
      );

      expectDatum(
        findUtxoByToken(
          reserveUtxos,
          reserveTwoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        ),
        [newReserveLogicHash, "", govAuth.Script.hash(), "", 0n, 1n],
      );
    });
  });
});
