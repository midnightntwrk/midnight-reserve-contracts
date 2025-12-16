import {
  addressFromCredential,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  NativeScripts,
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
import * as Contracts from "../contract_blueprint";
import {
  createMultisigStateCbor,
  createRedeemerMapCbor,
} from "../cli/lib/signers";
import { describe, test, expect } from "bun:test";

describe("Change Council with Duplicate Signers", () => {
  test("Should build transaction with same signer appearing multiple times", async () => {
    const emulator = new Emulator([]);
    const amount = 100_000_000n;

    await emulator.as("deployer", async (blaze, addr) => {
      // Fund deployer
      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 11,
            txId: TransactionId(
              "b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48",
            ),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: { coins: amount * 10n },
          },
        ]),
      );

      // Create contract instances
      const councilForever = new Contracts.PermissionedCouncilForeverElse();
      const councilLogic = new Contracts.PermissionedCouncilLogicElse();
      const mainCouncilUpdateThreshold =
        new Contracts.ThresholdsMainCouncilUpdateThresholdElse();
      const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
      const councilTwoStage =
        new Contracts.PermissionedCouncilTwoStageUpgradeElse();

      // Create addresses
      const councilForeverAddress = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.ScriptHash,
          hash: councilForever.Script.hash(),
        }),
      );

      const councilUpdateThresholdAddress = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.ScriptHash,
          hash: mainCouncilUpdateThreshold.Script.hash(),
        }),
      );

      const techAuthForeverAddress = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.ScriptHash,
          hash: techAuthForever.Script.hash(),
        }),
      );

      const councilTwoStageAddress = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.ScriptHash,
          hash: councilTwoStage.Script.hash(),
        }),
      );

      // Current council state - 3 different signers
      // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
      const currentCouncilState: Contracts.VersionedMultisig = [
        [
          3n,
          {
            ["8200581c3958ae4a79fa36f52c9e0f5fab7aac2d4c4446a290b44e2d2f53d387"]:
              "d2a9e63d7a883dfe271d2ca91c06917fdb459126162c77ff83b480d6415a551f",
            ["8200581cc6f2de5adbbf0b77adcc6883d562a4f5a535017eaedc6804c5e55b33"]:
              "9e6619809817313de02029b0b9232ccc880d8ee37e2fed8cabc73694045fee29",
            ["8200581ca7b42151bbc97e9ecd40f454d6dd0a24cf3e579c675f6552bd059c82"]:
              "ecfc4d62911bae419efea459f9f2271da3f9df5b8cebbda599116aa034b15c55",
          },
        ],
        0n,
      ];

      // Add council forever UTxO
      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId(
              "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            ),
          },
          {
            address: PaymentAddress(councilForeverAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(councilForever.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.VersionedMultisig,
              currentCouncilState,
            ).toCore(),
          },
        ]),
      );

      // Add threshold UTxO
      // MultisigThreshold is now a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
      const thresholdDatum: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];

      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId(
              "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
            ),
          },
          {
            address: PaymentAddress(councilUpdateThresholdAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [AssetId(mainCouncilUpdateThreshold.Script.hash()), 1n],
              ]),
            },
            datum: serialize(
              Contracts.MultisigThreshold,
              thresholdDatum,
            ).toCore(),
          },
        ]),
      );

      // Add tech auth forever UTxO - different signers from council (28 bytes = 56 hex chars)
      // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
      const techAuthState: Contracts.VersionedMultisig = [
        [
          3n,
          {
            ["8200581c11111111111111111111111111111111111111111111111111111111"]:
              "aaaa111111111111111111111111111111111111111111111111111111111111",
            ["8200581c22222222222222222222222222222222222222222222222222222222"]:
              "bbbb222222222222222222222222222222222222222222222222222222222222",
            ["8200581c33333333333333333333333333333333333333333333333333333333"]:
              "cccc333333333333333333333333333333333333333333333333333333333333",
          },
        ],
        0n,
      ];

      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId(
              "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            ),
          },
          {
            address: PaymentAddress(techAuthForeverAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(techAuthForever.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.VersionedMultisig,
              techAuthState,
            ).toCore(),
          },
        ]),
      );

      // Add council two stage UTxO
      const upgradeState: Contracts.UpgradeState = [
        councilLogic.Script.hash(),
        "",
        councilForever.Script.hash(),
        "",
        0n,
        0n,
      ];

      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId(
              "c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1",
            ),
          },
          {
            address: PaymentAddress(councilTwoStageAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [
                  AssetId(
                    councilTwoStage.Script.hash() +
                      Buffer.from("main").toString("hex"),
                  ),
                  1n,
                ],
              ]),
            },
            datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
          },
        ]),
      );

      // NEW COUNCIL - SAME SIGNER APPEARING 3 TIMES WITH DIFFERENT SR25519 KEYS!
      const singlePaymentHash =
        "f932cb4c0de84606b3da87214324887270f5fb0e04a6870dc7df5f23";
      const newCouncilSigners = [
        {
          paymentHash: singlePaymentHash,
          sr25519Key:
            "de2306334193be59122367e5a774769e59de84baacfd8e136fba8e18dbcd0833",
        },
        {
          paymentHash: singlePaymentHash,
          sr25519Key:
            "8c457a4b2383443ff5b30420aea92bfca65971fd0b76d21715529e4e8192be1d",
        },
        {
          paymentHash: singlePaymentHash,
          sr25519Key:
            "f6aa16d4c6892575af371fd14e1e40a7c4675876e8f331e2e2466a28e950765f",
        },
      ];

      // Use the new CBOR functions that preserve duplicate keys
      const newCouncilForeverStateCbor = createMultisigStateCbor(
        newCouncilSigners,
        0n,
      );
      const memberRedeemerCbor = createRedeemerMapCbor(newCouncilSigners);

      // Current signers for native script
      const currentCouncilSigners = [
        {
          paymentHash:
            "3958ae4a79fa36f52c9e0f5fab7aac2d4c4446a290b44e2d2f53d387",
        },
        {
          paymentHash:
            "c6f2de5adbbf0b77adcc6883d562a4f5a535017eaedc6804c5e55b33",
        },
        {
          paymentHash:
            "a7b42151bbc97e9ecd40f454d6dd0a24cf3e579c675f6552bd059c82",
        },
      ];

      // Use different signers for tech auth to avoid duplicate policy IDs
      // Payment hash must be 28 bytes = 56 hex chars
      const techAuthSigners = [
        {
          paymentHash:
            "11111111111111111111111111111111111111111111111111111111",
        },
        {
          paymentHash:
            "22222222222222222222222222222222222222222222222222222222",
        },
        {
          paymentHash:
            "33333333333333333333333333333333333333333333333333333333",
        },
      ];

      const requiredSigners = 2;

      const nativeScriptCouncil = NativeScripts.atLeastNOfK(
        requiredSigners,
        ...currentCouncilSigners.map((s) => {
          const bech32 = addressFromCredential(
            NetworkId.Testnet,
            Credential.fromCore({
              type: CredentialType.KeyHash,
              hash: Hash28ByteBase16(s.paymentHash),
            }),
          ).toBech32();
          return NativeScripts.justAddress(bech32, NetworkId.Testnet);
        }),
      );

      const councilPolicyId = PolicyId(nativeScriptCouncil.hash());

      const nativeScriptTechAuth = NativeScripts.atLeastNOfK(
        requiredSigners,
        ...techAuthSigners.map((s) => {
          const bech32 = addressFromCredential(
            NetworkId.Testnet,
            Credential.fromCore({
              type: CredentialType.KeyHash,
              hash: Hash28ByteBase16(s.paymentHash),
            }),
          ).toBech32();
          return NativeScripts.justAddress(bech32, NetworkId.Testnet);
        }),
      );

      const techAuthPolicyId = PolicyId(nativeScriptTechAuth.hash());

      const councilLogicRewardAccount = RewardAccount.fromCredential(
        Credential.fromCore({
          type: CredentialType.ScriptHash,
          hash: councilLogic.Script.hash(),
        }).toCore(),
        NetworkId.Testnet,
      );
      emulator.accounts.set(councilLogicRewardAccount, 0n);

      // Build transaction
      const txBuilder = blaze
        .newTransaction()
        .addInput(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              ),
            },
            {
              address: PaymentAddress(councilForeverAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([[AssetId(councilForever.Script.hash()), 1n]]),
              },
              datum: serialize(
                Contracts.VersionedMultisig,
                currentCouncilState,
              ).toCore(),
            },
          ]),
          PlutusData.newInteger(0n),
        )
        .addReferenceInput(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
              ),
            },
            {
              address: PaymentAddress(councilUpdateThresholdAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [AssetId(mainCouncilUpdateThreshold.Script.hash()), 1n],
                ]),
              },
              datum: serialize(
                Contracts.MultisigThreshold,
                thresholdDatum,
              ).toCore(),
            },
          ]),
        )
        .addReferenceInput(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
              ),
            },
            {
              address: PaymentAddress(techAuthForeverAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([[AssetId(techAuthForever.Script.hash()), 1n]]),
              },
              datum: serialize(
                Contracts.VersionedMultisig,
                techAuthState,
              ).toCore(),
            },
          ]),
        )
        .addReferenceInput(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1",
              ),
            },
            {
              address: PaymentAddress(councilTwoStageAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(
                      councilTwoStage.Script.hash() +
                        Buffer.from("main").toString("hex"),
                    ),
                    1n,
                  ],
                ]),
              },
              datum: serialize(Contracts.UpgradeState, upgradeState).toCore(),
            },
          ]),
        )
        .provideScript(councilForever.Script)
        .addMint(councilPolicyId, new Map([[AssetName(""), 1n]]))
        .provideScript(Script.newNativeScript(nativeScriptCouncil))
        .addMint(techAuthPolicyId, new Map([[AssetName(""), 1n]]))
        .provideScript(Script.newNativeScript(nativeScriptTechAuth))
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(councilForeverAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(councilForever.Script.hash()), 1n]]),
            },
            datum: newCouncilForeverStateCbor.toCore(), // Use CBOR with duplicate keys!
          }),
        )
        .addWithdrawal(
          councilLogicRewardAccount,
          0n,
          memberRedeemerCbor, // Use CBOR with duplicate keys!
        )
        .provideScript(councilLogic.Script);

      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });
});
