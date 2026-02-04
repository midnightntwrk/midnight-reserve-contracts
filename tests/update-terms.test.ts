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
import { describe, test, expect } from "bun:test";

describe("Update Terms and Conditions Test", () => {
  test("Build update terms transaction", async () => {
    const emulator = new Emulator([]);
    const amount = 100_000_000n;

    await emulator.as("deployer", async (blaze, addr) => {
      await emulator.as("signer1", async (_, addr1) => {
        await emulator.as("signer2", async (_, addr2) => {
          // Add deployer UTxO for fees
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

          // Create contract instances
          const termsForever =
            new Contracts.TermsAndConditionsTermsAndConditionsForeverElse();
          const termsLogic =
            new Contracts.TermsAndConditionsTermsAndConditionsLogicElse();
          const termsTwoStage =
            new Contracts.TermsAndConditionsTermsAndConditionsTwoStageUpgradeElse();
          const termsThreshold =
            new Contracts.ThresholdsTermsAndConditionsThresholdElse();
          const councilForever =
            new Contracts.PermissionedCouncilForeverElse();
          const techAuthForever =
            new Contracts.PermissionedTechAuthForeverElse();

          // Create addresses
          const termsForeverAddress = addressFromCredential(
            NetworkId.Testnet,
            Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: termsForever.Script.hash(),
            }),
          );

          const termsThresholdAddress = addressFromCredential(
            NetworkId.Testnet,
            Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: termsThreshold.Script.hash(),
            }),
          );

          const termsTwoStageAddress = addressFromCredential(
            NetworkId.Testnet,
            Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: termsTwoStage.Script.hash(),
            }),
          );

          const councilForeverAddress = addressFromCredential(
            NetworkId.Testnet,
            Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: councilForever.Script.hash(),
            }),
          );

          const techAuthForeverAddress = addressFromCredential(
            NetworkId.Testnet,
            Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: techAuthForever.Script.hash(),
            }),
          );

          // Current terms and conditions state
          // VersionedTermsAndConditions = [[hash, url], logic_round]
          // Both hash and url are ByteArrays, so url needs to be hex-encoded
          const currentHash =
            "0000000000000000000000000000000000000000000000000000000000000000";
          const currentUrl = Buffer.from("https://example.com/old-terms").toString("hex");
          const currentTermsState: Contracts.VersionedTermsAndConditions = [
            [currentHash, currentUrl],
            0n,
          ];

          // Add terms forever UTxO
          emulator.addUtxo(
            TransactionUnspentOutput.fromCore([
              {
                index: 0,
                txId: TransactionId(
                  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                ),
              },
              {
                address: PaymentAddress(termsForeverAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(termsForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.VersionedTermsAndConditions,
                  currentTermsState,
                ).toCore(),
              },
            ]),
          );

          // MultisigThreshold for terms: [tech_auth_num, tech_auth_denom, council_num, council_denom]
          const thresholdDatum: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];

          // Add threshold UTxO
          emulator.addUtxo(
            TransactionUnspentOutput.fromCore([
              {
                index: 0,
                txId: TransactionId(
                  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                ),
              },
              {
                address: PaymentAddress(termsThresholdAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(termsThreshold.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.MultisigThreshold,
                  thresholdDatum,
                ).toCore(),
              },
            ]),
          );

          // Council signers (for authorization)
          const councilSigners = [
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

          // Council forever state
          const councilState: Contracts.VersionedMultisig = [
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
                  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
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
                  councilState,
                ).toCore(),
              },
            ]),
          );

          // Tech auth signers (different from council to avoid duplicate policy)
          // Payment hash is 28 bytes (56 hex chars)
          const techAuthSigners = [
            {
              paymentHash:
                "11111111111111111111111111111111111111111111111111111111",
              sr25519Key:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            {
              paymentHash:
                "22222222222222222222222222222222222222222222222222222222",
              sr25519Key:
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
            {
              paymentHash:
                "33333333333333333333333333333333333333333333333333333333",
              sr25519Key:
                "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            },
          ];

          // Tech auth forever state
          // Key format: 8200581c + 56 hex chars (28 bytes payment hash)
          const techAuthState: Contracts.VersionedMultisig = [
            [
              3n,
              {
                ["8200581c" + techAuthSigners[0].paymentHash]:
                  techAuthSigners[0].sr25519Key,
                ["8200581c" + techAuthSigners[1].paymentHash]:
                  techAuthSigners[1].sr25519Key,
                ["8200581c" + techAuthSigners[2].paymentHash]:
                  techAuthSigners[2].sr25519Key,
              },
            ],
            0n,
          ];

          // Add tech auth forever UTxO
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

          // Two-stage upgrade state
          const upgradeState: Contracts.UpgradeState = [
            termsLogic.Script.hash(),
            "",
            termsForever.Script.hash(),
            "",
            0n,
            0n,
          ];

          // Add two-stage UTxO with "main" asset
          emulator.addUtxo(
            TransactionUnspentOutput.fromCore([
              {
                index: 0,
                txId: TransactionId(
                  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                ),
              },
              {
                address: PaymentAddress(termsTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        termsTwoStage.Script.hash() +
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

          // New terms and conditions
          // Both hash and url are ByteArrays, so url needs to be hex-encoded
          const newHash =
            "1111111111111111111111111111111111111111111111111111111111111111";
          const newUrl = Buffer.from("https://example.com/new-terms").toString("hex");
          const newTermsState: Contracts.VersionedTermsAndConditions = [
            [newHash, newUrl],
            0n, // Keep same logic round
          ];

          // Create native multisig scripts for authorization
          const requiredSigners = 2;

          const nativeScriptCouncil = NativeScripts.atLeastNOfK(
            requiredSigners,
            ...councilSigners.map((s) => {
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

          const councilPolicyId = PolicyId(nativeScriptCouncil.hash());
          const techAuthPolicyId = PolicyId(nativeScriptTechAuth.hash());

          // Register logic reward account
          const termsLogicRewardAccount = RewardAccount.fromCredential(
            Credential.fromCore({
              type: CredentialType.ScriptHash,
              hash: termsLogic.Script.hash(),
            }).toCore(),
            NetworkId.Testnet,
          );
          emulator.accounts.set(termsLogicRewardAccount, 0n);

          // Build transaction
          const txBuilder = blaze
            .newTransaction()
            .addInput(
              TransactionUnspentOutput.fromCore([
                {
                  index: 0,
                  txId: TransactionId(
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  ),
                },
                {
                  address: PaymentAddress(termsForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(termsForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedTermsAndConditions,
                    currentTermsState,
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
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  ),
                },
                {
                  address: PaymentAddress(termsThresholdAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(termsThreshold.Script.hash()), 1n],
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
                    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
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
                    councilState,
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
                    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                  ),
                },
                {
                  address: PaymentAddress(termsTwoStageAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(
                          termsTwoStage.Script.hash() +
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
            .provideScript(termsForever.Script)
            .addMint(councilPolicyId, new Map([[AssetName(""), 1n]]))
            .provideScript(Script.newNativeScript(nativeScriptCouncil))
            .addMint(techAuthPolicyId, new Map([[AssetName(""), 1n]]))
            .provideScript(Script.newNativeScript(nativeScriptTechAuth))
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(termsForeverAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [AssetId(termsForever.Script.hash()), 1n],
                  ]),
                },
                datum: serialize(
                  Contracts.VersionedTermsAndConditions,
                  newTermsState,
                ).toCore(),
              }),
            )
            .addWithdrawal(
              termsLogicRewardAccount,
              0n,
              PlutusData.newInteger(0n),
            )
            .provideScript(termsLogic.Script);

          await emulator.expectValidTransaction(blaze, txBuilder);
        });
      });
    });
  });

  test("Datum structure is correct", () => {
    // Test that VersionedTermsAndConditions has the expected structure
    // Both hash and url are ByteArrays
    const hash =
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const url = Buffer.from("https://example.com/terms").toString("hex");
    const logicRound = 0n;

    const termsState: Contracts.VersionedTermsAndConditions = [
      [hash, url],
      logicRound,
    ];

    // Verify structure
    expect(termsState[0][0]).toBe(hash);
    expect(termsState[0][1]).toBe(url);
    expect(termsState[1]).toBe(logicRound);

    // Verify serialization doesn't throw
    const serialized = serialize(
      Contracts.VersionedTermsAndConditions,
      termsState,
    );
    expect(serialized).toBeDefined();
  });
});
