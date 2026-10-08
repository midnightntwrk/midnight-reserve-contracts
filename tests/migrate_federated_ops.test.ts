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
import { parse, serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
// V2 contracts are not yet deployed to mainnet — the V2 and v1 scripts must
// come from the same compilation so their cross-script hash references match.
import * as Contracts from "../contract_blueprint";
import { describe, test, expect } from "bun:test";
import {
  buildNativeScriptFromState,
  COUNCIL_WITNESS_ASSET,
  MAIN_TOKEN_HEX,
  TECH_WITNESS_ASSET,
} from "./helpers/upgrade";
import {
  candidateToPermissionedDatum,
  createFederatedOpsDatumFromString,
  createFederatedOpsDatumV2,
  parsePermissionedCandidatesString,
} from "../cli-yargs/lib/candidates";

describe("Migrate Federated Ops from v1 to v2 datum", () => {
  test("v2 logic on main migrates the v1 datum to v2", async () => {
    const emulator = new Emulator([]);

    const govAuth = new Contracts.GovAuthMainGovAuthElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();
    const federatedOpsForever =
      new Contracts.PermissionedFederatedOpsForeverElse();
    const federatedOpsTwoStage =
      new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse();
    const federatedOpsLogicV2 =
      new Contracts.PermissionedV2FederatedOpsLogicV2Else();
    const mainFederatedOpsUpdateThreshold =
      new Contracts.ThresholdsMainFederatedOpsUpdateThresholdElse();

    const federatedOpsLogicV2RewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: federatedOpsLogicV2.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(federatedOpsLogicV2RewardAccount, { balance: 0n });

    const federatedOpsForeverAddress = addressFromValidator(
      NetworkId.Testnet,
      federatedOpsForever.Script,
    );
    const federatedOpsTwoStageAddress = addressFromValidator(
      NetworkId.Testnet,
      federatedOpsTwoStage.Script,
    );

    const promotedV2UpgradeState: Contracts.UpgradeState = [
      federatedOpsLogicV2.Script.hash(),
      "",
      govAuth.Script.hash(),
      "",
      0n,
      1n,
    ];

    const testCandidatesInput = `[
      {
        sidechain_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8,
        aura_pub_key:1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03,
        grandpa_pub_key:5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5,
        beefy_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8
      }
    ]`;

    const federatedOpsDatumV1 = createFederatedOpsDatumFromString(
      testCandidatesInput,
      1n,
    );

    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("ff".repeat(32)),
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
            promotedV2UpgradeState,
          ).toCore(),
        },
      ]);

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

      emulator.addUtxo(techForeverUtxo);
      emulator.addUtxo(councilForeverUtxo);
      emulator.addUtxo(fedOpsThresholdUtxo);
      emulator.addUtxo(fedOpsTwoStageMainUtxo);
      emulator.addUtxo(fedOpsForeverUtxo);

      const newDatumV2 = createFederatedOpsDatumV2(
        fedOpsForeverUtxo.output().datum()!.asInlineData()!,
      );

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(fundingUtxo)
          .addInput(fedOpsForeverUtxo, PlutusData.newInteger(0n))
          .addReferenceInput(fedOpsTwoStageMainUtxo)
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
          .provideScript(federatedOpsLogicV2.Script)
          .addMint(
            PolicyId(techNativeScript.hash()),
            new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
          )
          .addMint(
            PolicyId(councilNativeScript.hash()),
            new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
          )
          .provideScript(Script.newNativeScript(techNativeScript))
          .provideScript(Script.newNativeScript(councilNativeScript)),
      );

      const finalForeverUtxo = (
        await blaze.provider.getUnspentOutputs(federatedOpsForeverAddress)
      ).find(
        (utxo) =>
          utxo
            .output()
            .amount()
            .multiasset()
            ?.get(AssetId(federatedOpsForever.Script.hash())) === 1n,
      )!;
      const finalDatum = parse(
        Contracts.FederatedOpsV2,
        finalForeverUtxo.output().datum()!.asInlineData()!,
      );

      expect(finalDatum[2]).toEqual(
        parsePermissionedCandidatesString(testCandidatesInput).map(
          candidateToPermissionedDatum,
        ),
      );
    });
  });
});
