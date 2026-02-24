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
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import * as Contracts from "../contract_blueprint";
import { describe, test, expect } from "bun:test";
import {
  buildNativeScriptFromState,
  COUNCIL_WITNESS_ASSET,
  findUtxoByToken,
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
  TECH_WITNESS_ASSET,
} from "./helpers/upgrade";
import {
  createFederatedOpsDatumFromString,
  createFederatedOpsDatumV2,
} from "../cli/lib/candidates";

describe("Migrate Federated Ops from v1 to v2 datum", () => {
  test("deploy federated ops, upgrade to v2 logic, then migrate datum", async () => {
    const emulator = new Emulator([]);

    // Contract instances
    const govAuth = new Contracts.GovAuthMainGovAuthElse();
    const mainGovThreshold = new Contracts.ThresholdsMainGovThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();
    const federatedOpsForever =
      new Contracts.PermissionedFederatedOpsForeverElse();
    const federatedOpsTwoStage =
      new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse();
    const federatedOpsLogic = new Contracts.PermissionedFederatedOpsLogicElse();
    const federatedOpsLogicV2 =
      new Contracts.PermissionedV2FederatedOpsLogicV2Else();
    const mainFederatedOpsUpdateThreshold =
      new Contracts.ThresholdsMainFederatedOpsUpdateThresholdElse();

    // Set up reward accounts for gov auth and logic validators
    const govAuthRewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: govAuth.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(govAuthRewardAccount, { balance: 0n });

    const federatedOpsLogicV2RewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: federatedOpsLogicV2.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(federatedOpsLogicV2RewardAccount, { balance: 0n });

    // Addresses
    const federatedOpsForeverAddress = addressFromValidator(
      NetworkId.Testnet,
      federatedOpsForever.Script,
    );
    const federatedOpsTwoStageAddress = addressFromValidator(
      NetworkId.Testnet,
      federatedOpsTwoStage.Script,
    );

    // Initial upgrade state: v1 logic on main
    const initialUpgradeState: Contracts.UpgradeState = [
      federatedOpsLogic.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
      0n,
    ];

    // Test candidates
    const testCandidatesInput = `[
      {
        sidechain_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8,
        aura_pub_key:1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03,
        grandpa_pub_key:5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5,
        beefy_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8
      }
    ]`;

    // Create v1 FederatedOps datum
    const federatedOpsDatumV1 = createFederatedOpsDatumFromString(
      testCandidatesInput,
      1n,
    );

    await emulator.as("deployer", async (blaze, addr) => {
      // Create multiple funding UTxOs
      const fundingUtxos = Array.from({ length: 6 }).map((_, idx) => {
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

      // Signer states: 1 tech auth, 1 council (simplified for test)
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

      // Threshold: 1/2 for both groups
      const thresholdDatum: Contracts.MultisigThreshold = [1n, 2n, 1n, 2n];

      const govAuthRedeemerData = serialize(Contracts.PermissionedRedeemer, {
        [paymentHash]:
          "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
      });

      const techNativeScript = buildNativeScriptFromState(
        techAuthForeverState,
        thresholdDatum[0],
        thresholdDatum[1],
      );

      const councilNativeScript = buildNativeScriptFromState(
        councilForeverState,
        thresholdDatum[2],
        thresholdDatum[3],
      );

      const techWitnessPolicy = techNativeScript.hash();
      const councilWitnessPolicy = councilNativeScript.hash();

      // Create reference UTxOs
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

      // Federated ops update threshold UTxO
      const fedOpsThresholdUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("44".repeat(32)),
        },
        {
          address: PaymentAddress(
            addressFromValidator(
              NetworkId.Testnet,
              mainFederatedOpsUpdateThreshold.Script,
            ).toBech32(),
          ),
          value: {
            coins: 3_000_000n,
            assets: new Map([
              [AssetId(mainFederatedOpsUpdateThreshold.Script.hash()), 1n],
            ]),
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
      emulator.addUtxo(fedOpsThresholdUtxo);

      // Create federated ops two-stage UTxOs (main and staging)
      const fedOpsTwoStageMainUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("aa".repeat(32)),
        },
        {
          address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(federatedOpsTwoStage.Script.hash() + MAIN_TOKEN_HEX),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            initialUpgradeState,
          ).toCore(),
        },
      ]);

      const fedOpsTwoStageStagingUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("bb".repeat(32)),
        },
        {
          address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(federatedOpsTwoStage.Script.hash() + STAGING_TOKEN_HEX),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            initialUpgradeState,
          ).toCore(),
        },
      ]);

      emulator.addUtxo(fedOpsTwoStageMainUtxo);
      emulator.addUtxo(fedOpsTwoStageStagingUtxo);

      // Create federated ops forever UTxO with v1 datum
      const fedOpsForeverUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("cc".repeat(32)),
        },
        {
          address: PaymentAddress(federatedOpsForeverAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(federatedOpsForever.Script.hash()), 1n]]),
          },
          datum: serialize(
            Contracts.FederatedOps,
            federatedOpsDatumV1,
          ).toCore(),
        },
      ]);

      emulator.addUtxo(fedOpsForeverUtxo);

      // Helper to apply governance witnesses
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

      // ============================================================
      // Step 1: Stage federated_ops_logic_v2 hash
      // ============================================================
      const v2LogicHash = federatedOpsLogicV2.Script.hash();

      {
        const twoStageUtxos = await blaze.provider.getUnspentOutputs(
          federatedOpsTwoStageAddress,
        );
        const mainRef = findUtxoByToken(
          twoStageUtxos,
          federatedOpsTwoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        );
        const stagingInput = findUtxoByToken(
          twoStageUtxos,
          federatedOpsTwoStage.Script.hash(),
          STAGING_TOKEN_HEX,
        );

        const [mainInput] = mainRef.toCore();
        const redeemer = serialize(Contracts.TwoStageRedeemer, [
          "Logic",
          {
            Staging: [
              {
                transaction_id: mainInput.txId.toString(),
                output_index: BigInt(mainInput.index),
              },
              v2LogicHash,
            ],
          },
        ]);

        const stagedState: Contracts.UpgradeState = [
          v2LogicHash,
          "",
          govAuth.Script.hash(),
          "",
          0n,
          1n,
        ];

        const tx = applyGovernanceWitnesses(
          blaze
            .newTransaction()
            .addInput(stagingInput, redeemer)
            .addInput(fundingUtxos[0])
            .addReferenceInput(mainRef)
            .addReferenceInput(mainGovThresholdUtxo)
            .addReferenceInput(techForeverUtxo)
            .addReferenceInput(councilForeverUtxo)
            .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
            .provideScript(federatedOpsTwoStage.Script)
            .provideScript(govAuth.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        federatedOpsTwoStage.Script.hash() + STAGING_TOKEN_HEX,
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, stagedState).toCore(),
              }),
            ),
        );

        await emulator.expectValidTransaction(blaze, tx);
      }

      // ============================================================
      // Step 2: Promote v2 logic to main
      // ============================================================
      {
        const twoStageUtxos = await blaze.provider.getUnspentOutputs(
          federatedOpsTwoStageAddress,
        );
        const mainInput = findUtxoByToken(
          twoStageUtxos,
          federatedOpsTwoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        );
        const stagingRef = findUtxoByToken(
          twoStageUtxos,
          federatedOpsTwoStage.Script.hash(),
          STAGING_TOKEN_HEX,
        );
        const [stagingInputCore] = stagingRef.toCore();

        const redeemer = serialize(Contracts.TwoStageRedeemer, [
          "Logic",
          {
            Main: [
              {
                transaction_id: stagingInputCore.txId.toString(),
                output_index: BigInt(stagingInputCore.index),
              },
            ],
          },
        ]);

        const promotedState: Contracts.UpgradeState = [
          v2LogicHash,
          "",
          govAuth.Script.hash(),
          "",
          0n,
          1n,
        ];

        const tx = applyGovernanceWitnesses(
          blaze
            .newTransaction()
            .addInput(mainInput, redeemer)
            .addInput(fundingUtxos[1])
            .addReferenceInput(stagingRef)
            .addReferenceInput(mainGovThresholdUtxo)
            .addReferenceInput(techForeverUtxo)
            .addReferenceInput(councilForeverUtxo)
            .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
            .provideScript(federatedOpsTwoStage.Script)
            .provideScript(govAuth.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        federatedOpsTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(
                  Contracts.UpgradeState,
                  promotedState,
                ).toCore(),
              }),
            ),
        );

        await emulator.expectValidTransaction(blaze, tx);
      }

      // ============================================================
      // Step 3: Migrate federated ops datum from v1 to v2
      // ============================================================
      {
        // Get current forever UTxO
        const foreverUtxos = await blaze.provider.getUnspentOutputs(
          federatedOpsForeverAddress,
        );
        const foreverUtxo = foreverUtxos.find((utxo) => {
          const [, output] = utxo.toCore();
          const assets = output.value.assets;
          return assets
            ? (assets.get(AssetId(federatedOpsForever.Script.hash())) ?? 0n) ===
                1n
            : false;
        });
        expect(foreverUtxo).toBeDefined();

        // Get the two-stage main UTxO (now has v2 logic promoted)
        const twoStageUtxos = await blaze.provider.getUnspentOutputs(
          federatedOpsTwoStageAddress,
        );
        const twoStageMainUtxo = findUtxoByToken(
          twoStageUtxos,
          federatedOpsTwoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        );

        // Build the FederatedOpsV2 datum from the existing v1 datum
        const currentDatum = foreverUtxo!.output().datum()!.asInlineData()!;
        const newDatumV2 = createFederatedOpsDatumV2(currentDatum);

        // The migration transaction:
        // - Spends the forever UTxO (authorized by forever contract which delegates to logic)
        // - References the two-stage main UTxO (so forever contract can find logic hash)
        // - References the threshold UTxO (for v2 logic multisig check)
        // - References tech auth and council forever UTxOs (for multisig witnesses)
        // - Withdraws with v2 logic (validates the output datum)
        // - Mints governance witness tokens (native scripts)
        // - Outputs the forever UTxO with v2 datum
        const tx = applyGovernanceWitnesses(
          blaze
            .newTransaction()
            .addInput(fundingUtxos[2])
            .addInput(foreverUtxo!, PlutusData.newInteger(0n))
            .addReferenceInput(twoStageMainUtxo)
            .addReferenceInput(fedOpsThresholdUtxo)
            .addReferenceInput(techForeverUtxo)
            .addReferenceInput(councilForeverUtxo)
            .provideScript(federatedOpsForever.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(federatedOpsForeverAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(federatedOpsForever.Script.hash()), 1n],
                  ]),
                },
                datum: newDatumV2.toCore(),
              }),
            )
            .addWithdrawal(
              federatedOpsLogicV2RewardAccount,
              0n,
              PlutusData.fromCore({
                constructor: 1n,
                fields: { items: [] },
              }),
            )
            .provideScript(federatedOpsLogicV2.Script),
        );

        await emulator.expectValidTransaction(blaze, tx);

        // ============================================================
        // Step 4: Verify the output has correct v2 datum structure
        // ============================================================
        const finalForeverUtxos = await blaze.provider.getUnspentOutputs(
          federatedOpsForeverAddress,
        );
        const finalForeverUtxo = finalForeverUtxos.find((utxo) => {
          const [, output] = utxo.toCore();
          const assets = output.value.assets;
          return assets
            ? (assets.get(AssetId(federatedOpsForever.Script.hash())) ?? 0n) ===
                1n
            : false;
        });
        expect(finalForeverUtxo).toBeDefined();

        const [, finalOutput] = finalForeverUtxo!.toCore();
        const finalDatum = PlutusData.fromCore(finalOutput.datum!);
        const finalList = finalDatum.asList()!;

        // FederatedOpsV2 has 4 elements: [data, message, appendix, logic_round]
        expect(finalList.getLength()).toBe(4);

        // Verify the datum matches what createFederatedOpsDatumV2 produces
        expect(finalDatum.toCbor()).toBe(newDatumV2.toCbor());

        // Verify individual fields
        // Element 0: data (Unit constructor)
        const dataField = finalList.get(0);
        expect(dataField.toCbor()).toBe(
          PlutusData.fromCore({
            constructor: 0n,
            fields: { items: [] },
          }).toCbor(),
        );

        // Element 1: message (empty bytearray)
        const messageField = finalList.get(1);
        expect(messageField.toCbor()).toBe(
          PlutusData.newBytes(new Uint8Array()).toCbor(),
        );

        // Element 3: logic_round = 2
        const logicRoundField = finalList.get(3);
        expect(logicRoundField.toCbor()).toBe(
          PlutusData.newInteger(2n).toCbor(),
        );
      }
    });
  });
});
