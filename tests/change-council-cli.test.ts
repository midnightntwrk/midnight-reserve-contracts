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
import { describe, test } from "bun:test";

describe("Change Council CLI Test", () => {
  test("Build change council transaction", async () => {
    const emulator = new Emulator([]);
    const amount = 100_000_000n;

    await emulator.as("deployer", async (blaze, addr) => {
      await emulator.as("signer1", async (_blaze1, _addr1) => {
        await emulator.as("signer2", async (_blaze2, _addr2) => {
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
                value: {
                  coins: amount * 10n,
                },
              },
            ]),
          );

          const councilForever = new Contracts.PermissionedCouncilForeverElse();
          const councilLogic = new Contracts.PermissionedCouncilLogicElse();
          const mainCouncilUpdateThreshold =
            new Contracts.ThresholdsMainCouncilUpdateThresholdElse();
          const techAuthForever =
            new Contracts.PermissionedTechAuthForeverElse();
          const councilTwoStage =
            new Contracts.PermissionedCouncilTwoStageUpgradeElse();

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

          // Current council state - exact on-chain state from preview
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.VersionedMultisig,
                  currentCouncilState,
                ).toCore(),
              },
            ]),
          );

          // MultisigThreshold is a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
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
                address: PaymentAddress(
                  councilUpdateThresholdAddress.toBech32(),
                ),
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

          // Add tech auth forever UTxO - exact on-chain state from preview (same as council)
          // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
          const techAuthState: Contracts.VersionedMultisig = [
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
                  assets: new Map([
                    [AssetId(techAuthForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.VersionedMultisig,
                  techAuthState,
                ).toCore(),
              },
            ]),
          );

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

          // New council signers - from .env COUNCIL_SIGNERS
          const newCouncilSigners = [
            {
              paymentHash:
                "f932cb4c0de84606b3da87214324887270f5fb0e04a6870dc7df5f23",
              sr25519Key:
                "1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03",
            },
            {
              paymentHash:
                "1ef4e15cba8217811b9a9b2a7ec4a24a110418a38c2a9f0ae7127e04",
              sr25519Key:
                "28eceada5cc07c9be83c24678f90a3cc595ccf957bb13a91dd20879fcee55e14",
            },
            {
              paymentHash:
                "8585125fa41171f55c23cdadc3d0ad3692be927c6ed1b92d1f048335",
              sr25519Key:
                "6690ab0b224e70294bb6962b37376632540ba46612f0c14ee6658b82cbdd3748",
            },
          ];

          // Create new state using CBOR functions that support duplicate keys
          const newCouncilForeverStateCbor = createMultisigStateCbor(
            newCouncilSigners,
            0n,
          );
          const memberRedeemerCbor = createRedeemerMapCbor(newCouncilSigners);

          const requiredSigners = 2;

          const nativeScriptCouncil = NativeScripts.atLeastNOfK(
            requiredSigners,
            ...newCouncilSigners.map((s) => {
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

          // Also need tech auth native script for ML-3
          const techAuthSigners = [
            {
              paymentHash:
                "3958ae4a79fa36f52c9e0f5fab7aac2d4c4446a290b44e2d2f53d387",
              sr25519Key:
                "d2a9e63d7a883dfe271d2ca91c06917fdb459126162c77ff83b480d6415a551f",
            },
            {
              paymentHash:
                "c6f2de5adbbf0b77adcc6883d562a4f5a535017eaedc6804c5e55b33",
              sr25519Key:
                "9e6619809817313de02029b0b9232ccc880d8ee37e2fed8cabc73694045fee29",
            },
            {
              paymentHash:
                "a7b42151bbc97e9ecd40f454d6dd0a24cf3e579c675f6552bd059c82",
              sr25519Key:
                "ecfc4d62911bae419efea459f9f2271da3f9df5b8cebbda599116aa034b15c55",
            },
          ];

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
          emulator.accounts.set(councilLogicRewardAccount, { balance: 0n });

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
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
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
                  address: PaymentAddress(
                    councilUpdateThresholdAddress.toBech32(),
                  ),
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
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
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
                  datum: serialize(
                    Contracts.UpgradeState,
                    upgradeState,
                  ).toCore(),
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
                  assets: new Map([
                    [AssetId(councilForever.Script.hash()), 1n],
                  ]),
                },
                datum: newCouncilForeverStateCbor.toCore(),
              }),
            )
            .addWithdrawal(councilLogicRewardAccount, 0n, memberRedeemerCbor)
            .provideScript(councilLogic.Script);

          await emulator.expectValidTransaction(blaze, txBuilder);
        });
      });
    });
  });
});
