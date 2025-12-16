import {
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  RewardAccount,
  Script,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize, parse } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../contract_blueprint";
import { describe, expect, test } from "bun:test";
import {
  buildNativeScriptFromState,
  COUNCIL_WITNESS_ASSET,
  findUtxoByToken,
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
  TECH_WITNESS_ASSET,
} from "./helpers/upgrade";

describe("Stage upgrade for tech-auth (CLI reproduction)", () => {
  /**
   * This test validates the correct configuration for stage-upgrade operations.
   *
   * KEY INSIGHT: The two-stage datum stores stagingGovAuth as the 'auth' field.
   * stagingGovAuth selects the threshold based on whether logic is on main:
   * - If logic IS on main → uses stagingGovThreshold
   * - If logic is NOT on main → uses stagingGovThreshold
   *
   * For staging operations (where logic is not yet on main), stagingGovAuth
   * will use stagingGovThreshold.
   */
  test("stage new logic for tech-auth using STAGING gov auth and threshold", async () => {
    const emulator = new Emulator([]);

    // Contract instances
    // The datum stores staging_gov_auth as the auth reference
    const stagingGovAuth = new Contracts.GovAuthStagingGovAuthElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();
    const techAuthTwoStage =
      new Contracts.PermissionedTechAuthTwoStageUpgradeElse();
    const techAuthLogic = new Contracts.PermissionedTechAuthLogicElse();

    // Council two-stage is needed for staging_gov_auth's logic_is_on_main check
    const councilTwoStage =
      new Contracts.PermissionedCouncilTwoStageUpgradeElse();
    const councilLogic = new Contracts.PermissionedCouncilLogicElse();

    // stagingGovAuth uses stagingGovThreshold when logic is not on main
    const stagingGovThreshold =
      new Contracts.ThresholdsStagingGovThresholdElse();

    // The withdrawal must match the auth in the datum (staging_gov_auth)
    const govAuthRewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: stagingGovAuth.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(govAuthRewardAccount, 0n);

    const twoStageAddress = addressFromValidator(
      NetworkId.Testnet,
      techAuthTwoStage.Script,
    );

    // Initial upgrade state - matching what would be deployed
    // Note: auth field stores main_gov_auth hash, but withdrawal uses staging_gov_auth
    const initialUpgradeState: Contracts.UpgradeState = [
      techAuthLogic.Script.hash(), // logic
      "", // mitigation_logic
      stagingGovAuth.Script.hash(), // gov_auth - stored for reference
      "", // mitigation_auth
      0n, // round
      0n, // logic_round
    ];

    await emulator.as("deployer", async (blaze, addr) => {
      // Create funding UTxOs
      const fundingUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 1,
          txId: TransactionId(
            "8ad13e4415d9cc9216e21c9878835b4238269f2e98dc242dbff37be5a73a2a0b",
          ),
        },
        {
          address: PaymentAddress(addr.toBech32()),
          value: {
            coins: 900_000_000n,
          },
        },
      ]);
      emulator.addUtxo(fundingUtxo);

      const paymentHash = addr.asBase()?.getPaymentCredential().hash!;
      const stakeHash = addr.asBase()?.getStakeCredential().hash!;

      // Using same pattern as working tech_council_upgrade.test.ts - 1 signer per group
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

      // Staging threshold - tech auth required, council NOT required (0/1)
      // MultisigThreshold is now a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
      const thresholdDatum: Contracts.MultisigThreshold = [1n, 2n, 0n, 1n];

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

      // Create tech auth forever UTxO
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

      // Create council forever UTxO
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

      // Create staging gov threshold UTxO - THIS IS WHAT THE CLI USES
      const stagingGovThresholdUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("33".repeat(32)),
        },
        {
          address: PaymentAddress(
            addressFromValidator(
              NetworkId.Testnet,
              stagingGovThreshold.Script,
            ).toBech32(),
          ),
          value: {
            coins: 3_000_000n,
            assets: new Map([[AssetId(stagingGovThreshold.Script.hash()), 1n]]),
          },
          datum: serialize(
            Contracts.MultisigThreshold,
            thresholdDatum,
          ).toCore(),
        },
      ]);

      emulator.addUtxo(techForeverUtxo);
      emulator.addUtxo(councilForeverUtxo);
      emulator.addUtxo(stagingGovThresholdUtxo);

      // Create two-stage UTxOs (main and staging)
      const mainUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("aa".repeat(32)),
        },
        {
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(techAuthTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            initialUpgradeState,
          ).toCore(),
        },
      ]);

      const stagingUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("bb".repeat(32)),
        },
        {
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(techAuthTwoStage.Script.hash() + STAGING_TOKEN_HEX), 1n],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            initialUpgradeState,
          ).toCore(),
        },
      ]);

      emulator.addUtxo(mainUtxo);
      emulator.addUtxo(stagingUtxo);

      // Council two-stage main UTxO - needed for staging_gov_auth's logic_is_on_main check
      const councilTwoStageAddress = addressFromValidator(
        NetworkId.Testnet,
        councilTwoStage.Script,
      );
      const councilTwoStageState: Contracts.UpgradeState = [
        councilLogic.Script.hash(), // logic - different from stagingGovAuth.Script.hash()
        "",
        stagingGovAuth.Script.hash(), // auth
        "",
        0n,
        0n,
      ];
      const councilTwoStageMainUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("ee".repeat(32)),
        },
        {
          address: PaymentAddress(councilTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(councilTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            councilTwoStageState,
          ).toCore(),
        },
      ]);
      emulator.addUtxo(councilTwoStageMainUtxo);

      // New logic hash to stage (same as CLI command)
      const newLogicHash =
        "2e605d8d1feb01b91c9c9259908fea28f3d2b96b2e14c6334a10ca73";

      // Fetch UTxOs like the CLI does
      const twoStageUtxos =
        await blaze.provider.getUnspentOutputs(twoStageAddress);

      const mainRef = findUtxoByToken(
        twoStageUtxos,
        techAuthTwoStage.Script.hash(),
        MAIN_TOKEN_HEX,
      );
      const stagingInput = findUtxoByToken(
        twoStageUtxos,
        techAuthTwoStage.Script.hash(),
        STAGING_TOKEN_HEX,
      );

      // Parse current staging state to get round
      const stagingDatum = stagingInput.output().datum();
      const currentStagingState = parse(
        Contracts.UpgradeState,
        stagingDatum!.asInlineData()!,
      );

      // Build redeemer - matching CLI's stage-upgrade.ts
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

      // New staging state with updated logic and incremented round
      const newStagingState: Contracts.UpgradeState = [
        newLogicHash,
        currentStagingState[1], // keep mitigation_logic
        currentStagingState[2], // keep gov_auth
        currentStagingState[3], // keep mitigation_auth
        currentStagingState[4], // keep round
        currentStagingState[5] + 1n, // increment logic round
      ];

      // Build transaction - matching CLI's stage-upgrade.ts
      const tx = blaze
        .newTransaction()
        .addInput(stagingInput, redeemer)
        .addInput(fundingUtxo)
        .addReferenceInput(mainRef)
        .addReferenceInput(stagingGovThresholdUtxo)
        .addReferenceInput(techForeverUtxo)
        .addReferenceInput(councilForeverUtxo)
        .addReferenceInput(councilTwoStageMainUtxo) // For staging_gov_auth's logic_is_on_main check
        .provideScript(techAuthTwoStage.Script)
        .provideScript(stagingGovAuth.Script)
        .addMint(
          PolicyId(techWitnessPolicy),
          new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
        )
        .provideScript(Script.newNativeScript(techNativeScript))
        .addMint(
          PolicyId(councilWitnessPolicy),
          new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
        )
        .provideScript(Script.newNativeScript(councilNativeScript))
        .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(twoStageAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [
                  AssetId(techAuthTwoStage.Script.hash() + STAGING_TOKEN_HEX),
                  1n,
                ],
              ]),
            },
            datum: serialize(Contracts.UpgradeState, newStagingState).toCore(),
          }),
        );

      await emulator.expectValidTransaction(blaze, tx);

      // Verify the output has the expected datum
      const finalUtxos =
        await blaze.provider.getUnspentOutputs(twoStageAddress);
      const finalStaging = findUtxoByToken(
        finalUtxos,
        techAuthTwoStage.Script.hash(),
        STAGING_TOKEN_HEX,
      );

      const [, finalOutput] = finalStaging.toCore();
      const finalDatum = PlutusData.fromCore(finalOutput.datum!);
      const expectedDatum = serialize(
        Contracts.UpgradeState,
        newStagingState,
      ) as PlutusData;
      expect(finalDatum.toCbor()).toBe(expectedDatum.toCbor());
    });
  });
});
