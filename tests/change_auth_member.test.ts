import {
  addressFromCredential,
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  NativeScript,
  NativeScripts,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  RewardAccount,
  Script,
  toHex,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import { beforeEach, describe, test } from "bun:test";

describe("Change Auth Member", () => {
  const amount = 100_000_000n; // 100 ADA

  let emulator = new Emulator([]);

  // Contract instances
  const techAuthTwoStage =
    new Contracts.PermissionedTechAuthTwoStageUpgradeElse();

  const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();

  const techAuthLogic = new Contracts.PermissionedTechAuthLogicElse();

  const councilForever = new Contracts.PermissionedCouncilForeverElse();

  const mainTechAuthUpdateThreshold =
    new Contracts.ThresholdsMainTechAuthUpdateThresholdElse();

  beforeEach(async () => {
    // Reset emulator state
    emulator = new Emulator([]);
  });

  describe("Change authorization members", () => {
    test("Can change technical authority member", async () => {
      await emulator.as("deployer", async (_blaze, addr) => {
        const techAuthUpdateThresholdAddress = addressFromValidator(
          NetworkId.Testnet,
          mainTechAuthUpdateThreshold.Script,
        );
        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );
        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );
        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        // MultisigThreshold is now a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
        const thresholdDatum: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          new Contracts.GovAuthMainGovAuthElse().Script.hash(),
          "",
          0n,
          0n,
        ];

        // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
        const techAuthForeverState: Contracts.VersionedMultisig = [
          [
            2n,
            {
              ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
                // 32 byte Sr25519 PubKey
                "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
              ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
                "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
            },
          ],
          0n,
        ];
        // The council shares the tech-auth signers.
        const councilForeverState = techAuthForeverState;

        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "4444444444444444444444444444444444444444444444444444444444444444",
              ),
            },
            {
              address: PaymentAddress(
                techAuthUpdateThresholdAddress.toBech32(),
              ),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [AssetId(mainTechAuthUpdateThreshold.Script.hash()), 1n],
                ]),
              },
              datum: serialize(
                Contracts.MultisigThreshold,
                thresholdDatum,
              ).toCore(),
            },
          ]),
        );

        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              ),
            },
            {
              address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(
                      techAuthTwoStage.Script.hash() +
                        toHex(new TextEncoder().encode("main")),
                    ),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                techAuthUpgradeState,
              ).toCore(),
            },
          ]),
        );

        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "3333333333333333333333333333333333333333333333333333333333333333",
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
                techAuthForeverState,
              ).toCore(),
            },
          ]),
        );

        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "5555555555555555555555555555555555555555555555555555555555555555",
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
                councilForeverState,
              ).toCore(),
            },
          ]),
        );

        // Now change the technical authority member
        await emulator.as("newMember", async (newBlaze, newAddr) => {
          // Add UTxO for new member
          emulator.addUtxo(
            TransactionUnspentOutput.fromCore([
              {
                index: 0,
                txId: TransactionId(
                  "2222222222222222222222222222222222222222222222222222222222222222",
                ),
              },
              {
                address: PaymentAddress(newAddr.toBech32()),
                value: {
                  coins: amount,
                },
              },
            ]),
          );

          // Add reward account balance for tech auth logic withdrawal
          const techAuthLogicRewardAccount = RewardAccount.fromCredential(
            Credential.fromCore({
              hash: techAuthLogic.Script.hash(),
              type: CredentialType.ScriptHash,
            }).toCore(),
            NetworkId.Testnet,
          );
          emulator.accounts.set(techAuthLogicRewardAccount, { balance: 0n });

          // Create new multisig state with changed member
          // VersionedMultisig is now a tuple: [[totalSigners, signerMap], round]
          const newTechAuthForeverState: Contracts.VersionedMultisig = [
            [
              3n,
              {
                ["8200581c" + newAddr.asBase()?.getPaymentCredential().hash]:
                  // 32 byte Sr25519 PubKey
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
                ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
                  "1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF",
              },
            ],
            0n,
          ];

          // Create redeemer with new member public key hashes
          const memberRedeemer: Contracts.PermissionedRedeemer = {
            [newAddr.asBase()?.getPaymentCredential().hash!]:
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            [addr.asBase()?.getPaymentCredential().hash!]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
            [addr.asBase()?.getStakeCredential().hash!]:
              "1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF",
          };

          const nativeScriptTechAuth: NativeScript = NativeScripts.atLeastNOfK(
            2,
            NativeScripts.justAddress(
              addressFromCredential(
                NetworkId.Testnet,
                Credential.fromCore(addr.getProps().paymentPart!),
              ).toBech32(),
              NetworkId.Testnet,
            ),
            NativeScripts.justAddress(
              addressFromCredential(
                NetworkId.Testnet,
                Credential.fromCore(addr.getProps().delegationPart!),
              ).toBech32(),
              NetworkId.Testnet,
            ),
          );

          // Change member transaction using logic validator
          await emulator.expectValidTransaction(
            newBlaze,
            newBlaze
              .newTransaction()
              .addInput(
                TransactionUnspentOutput.fromCore([
                  {
                    index: 0,
                    txId: TransactionId(
                      "3333333333333333333333333333333333333333333333333333333333333333",
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
                      techAuthForeverState,
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
                      "4444444444444444444444444444444444444444444444444444444444444444",
                    ),
                  },
                  {
                    address: PaymentAddress(
                      techAuthUpdateThresholdAddress.toBech32(),
                    ),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(mainTechAuthUpdateThreshold.Script.hash()),
                          1n,
                        ],
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
                      "5555555555555555555555555555555555555555555555555555555555555555",
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
                      councilForeverState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  {
                    index: 0,
                    txId: TransactionId(
                      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    ),
                  },
                  {
                    address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(
                            techAuthTwoStage.Script.hash() +
                              toHex(new TextEncoder().encode("main")),
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      techAuthUpgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(techAuthForever.Script)
              .addMint(
                PolicyId(nativeScriptTechAuth.hash()),
                new Map([[AssetName(""), 1n]]),
              )
              .provideScript(Script.newNativeScript(nativeScriptTechAuth))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    newTechAuthForeverState,
                  ).toCore(),
                }),
              )
              .addWithdrawal(
                RewardAccount.fromCredential(
                  Credential.fromCore({
                    hash: techAuthLogic.Script.hash(),
                    type: CredentialType.ScriptHash,
                  }).toCore(),
                  NetworkId.Testnet,
                ),
                0n,
                serialize(Contracts.PermissionedRedeemer, memberRedeemer),
              )
              .provideScript(techAuthLogic.Script),
          );
        });
      });
    });
  });
});
