import {
  Address,
  addressFromCredential,
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  fromHex,
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
import * as Contracts from "../contract_blueprint";
import { beforeEach, describe, test } from "bun:test";

describe("Change Auth Member", () => {
  const amount = 100_000_000n; // 100 ADA
  const scriptAmount = 10_000_000n; // 10 ADA for script outputs

  let emulator = new Emulator([]);

  // Contract instances
  const techAuthTwoStage =
    new Contracts.PermissionedTechAuthTwoStageUpgradeElse();

  const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();

  const techAuthLogic = new Contracts.PermissionedTechAuthLogicElse();

  const councilTwoStage =
    new Contracts.PermissionedCouncilTwoStageUpgradeElse();

  const councilForever = new Contracts.PermissionedCouncilForeverElse();

  const councilLogic = new Contracts.PermissionedCouncilLogicElse();

  const mainCouncilUpdateThreshold =
    new Contracts.ThresholdsMainCouncilUpdateThresholdElse();

  const mainTechAuthUpdateThreshold =
    new Contracts.ThresholdsMainTechAuthUpdateThresholdElse();

  // Default network config values from aiken.toml
  const config = {
    technical_authority_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000004",
    technical_authority_one_shot_index: 1,
    council_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000002",
    council_one_shot_index: 1,
    main_council_update_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000008",
    main_council_update_one_shot_index: 1,
    main_tech_auth_update_one_shot_hash:
      "0000000000000000000000000000000000000000000000000000000000000009",
    main_tech_auth_update_one_shot_index: 1,
  };

  beforeEach(async () => {
    // Reset emulator state
    emulator = new Emulator([]);
  });

  describe("Change authorization members", () => {
    test("Can change technical authority member", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "1111111111111111111111111111111111111111111111111111111111111111",
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

        // Deploy Tech Auth Update Threshold first
        const techAuthUpdateThresholdOneShotUtxo =
          TransactionUnspentOutput.fromCore([
            {
              index: config.main_tech_auth_update_one_shot_index,
              txId: TransactionId(config.main_tech_auth_update_one_shot_hash),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: 10_000_000n,
              },
            },
          ]);

        emulator.addUtxo(techAuthUpdateThresholdOneShotUtxo);

        const techAuthUpdateThresholdAddress = addressFromValidator(
          NetworkId.Testnet,
          mainTechAuthUpdateThreshold.Script,
        );

        const thresholdDatum: Contracts.MultisigThreshold = {
          technical_auth_numerator: 2n,
          technical_auth_denominator: 3n,
          council_numerator: 2n,
          council_denominator: 3n,
        };

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthUpdateThresholdOneShotUtxo)
            .addMint(
              PolicyId(mainTechAuthUpdateThreshold.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              PlutusData.newInteger(0n),
            )
            .provideScript(mainTechAuthUpdateThreshold.Script)
            .addOutput(
              TransactionOutput.fromCore({
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
              }),
            ),
        );

        // Add the created threshold UTxO to emulator
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

        // Deploy Technical Authority contracts
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          new Contracts.GovAuthMainGovAuthElse().Script.hash(),
          "",
          0n,
        ];

        const techAuthForeverState: Contracts.VersionedMultisig = {
          data: [
            2n,
            {
              ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
                // 32 byte Sr25519 PubKey
                "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
              ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
                "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
            },
          ],
          round: 0n,
        };

        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo)
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
              }),
            )
            .addMint(
              PolicyId(techAuthTwoStage.Script.hash()),
              new Map([
                [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
                [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
              ]),
              PlutusData.newInteger(0n),
            )
            .provideScript(techAuthTwoStage.Script)
            .provideScript(techAuthForever.Script)
            .addOutput(
              TransactionOutput.fromCore({
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
              }),
            )
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        techAuthTwoStage.Script.hash() +
                          toHex(new TextEncoder().encode("staging")),
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(
                  Contracts.UpgradeState,
                  techAuthUpgradeState,
                ).toCore(),
              }),
            )
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
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        // Add the created tech auth UTxOs to emulator
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

        // Deploy Council contracts
        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(councilOneShotUtxo);

        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(),
          "",
          mainCouncilUpdateThreshold.Script.hash(),
          "",
          0n,
        ];

        const councilForeverState: Contracts.VersionedMultisig = {
          data: [
            2n,
            {
              ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
                // 32 byte Sr25519 PubKey
                "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
              ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
                "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
            },
          ],
          round: 0n,
        };

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo)
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
              }),
            )
            .addMint(
              PolicyId(councilTwoStage.Script.hash()),
              new Map([
                [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
                [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
              ]),
              PlutusData.newInteger(0n),
            )
            .provideScript(councilTwoStage.Script)
            .provideScript(councilForever.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(councilTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        councilTwoStage.Script.hash() +
                          toHex(new TextEncoder().encode("main")),
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(
                  Contracts.UpgradeState,
                  councilUpgradeState,
                ).toCore(),
              }),
            )
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(councilTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        councilTwoStage.Script.hash() +
                          toHex(new TextEncoder().encode("staging")),
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(
                  Contracts.UpgradeState,
                  councilUpgradeState,
                ).toCore(),
              }),
            )
            .addOutput(
              TransactionOutput.fromCore({
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
              }),
            ),
        );

        // Add the created council UTxOs to emulator
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
          emulator.accounts.set(techAuthLogicRewardAccount, 0n);

          // Create new multisig state with changed member
          const newTechAuthForeverState: Contracts.VersionedMultisig = {
            data: [
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
            round: 0n,
          };

          // Create redeemer with new member public key hashes
          const memberRedeemer: Contracts.PermissionedRedeemer = {
            [newAddr.asBase()?.getPaymentCredential().hash!]:
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            [addr.asBase()?.getPaymentCredential().hash!]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
            [addr.asBase()?.getStakeCredential().hash!]:
              "1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF",
          };

          fromHex(addr.asBase()?.getPaymentCredential().hash!);
          fromHex(addr.asBase()?.getStakeCredential().hash!);

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

    test("Can change council member", async () => {
      await emulator.as("deployer", async (blaze, addr) => {
        // Add initial UTxO for deployer
        emulator.addUtxo(
          TransactionUnspentOutput.fromCore([
            {
              index: 0,
              txId: TransactionId(
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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

        // Deploy Tech Auth Update Threshold first
        const techAuthUpdateThresholdOneShotUtxo =
          TransactionUnspentOutput.fromCore([
            {
              index: config.main_tech_auth_update_one_shot_index,
              txId: TransactionId(config.main_tech_auth_update_one_shot_hash),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: 10_000_000n,
              },
            },
          ]);

        emulator.addUtxo(techAuthUpdateThresholdOneShotUtxo);

        const techAuthUpdateThresholdAddress = addressFromValidator(
          NetworkId.Testnet,
          mainTechAuthUpdateThreshold.Script,
        );

        const thresholdDatum: Contracts.MultisigThreshold = {
          technical_auth_numerator: 2n,
          technical_auth_denominator: 3n,
          council_numerator: 2n,
          council_denominator: 3n,
        };

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthUpdateThresholdOneShotUtxo)
            .addMint(
              PolicyId(mainTechAuthUpdateThreshold.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              PlutusData.newInteger(0n),
            )
            .provideScript(mainTechAuthUpdateThreshold.Script)
            .addOutput(
              TransactionOutput.fromCore({
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
              }),
            ),
        );

        // Deploy Council Update Threshold
        const councilUpdateThresholdOneShotUtxo =
          TransactionUnspentOutput.fromCore([
            {
              index: config.main_council_update_one_shot_index,
              txId: TransactionId(config.main_council_update_one_shot_hash),
            },
            {
              address: PaymentAddress(addr.toBech32()),
              value: {
                coins: 10_000_000n,
              },
            },
          ]);

        emulator.addUtxo(councilUpdateThresholdOneShotUtxo);

        const councilUpdateThresholdAddress = addressFromValidator(
          NetworkId.Testnet,
          mainCouncilUpdateThreshold.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilUpdateThresholdOneShotUtxo)
            .addMint(
              PolicyId(mainCouncilUpdateThreshold.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              PlutusData.newInteger(0n),
            )
            .provideScript(mainCouncilUpdateThreshold.Script)
            .addOutput(
              TransactionOutput.fromCore({
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
              }),
            ),
        );

        // Deploy Technical Authority contracts
        const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.technical_authority_one_shot_index,
            txId: TransactionId(config.technical_authority_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(techAuthOneShotUtxo);

        const techAuthTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthTwoStage.Script,
        );

        const techAuthUpgradeState: Contracts.UpgradeState = [
          techAuthLogic.Script.hash(),
          "",
          new Contracts.GovAuthMainGovAuthElse().Script.hash(),
          "",
          0n,
        ];

        const techAuthForeverState: Contracts.VersionedMultisig = {
          data: [
            2n,
            {
              ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
                // 32 byte Sr25519 PubKey
                "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
              ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
                "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
            },
          ],
          round: 0n,
        };

        const techAuthForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          techAuthForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(techAuthOneShotUtxo)
            .addMint(
              PolicyId(techAuthForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
              }),
            )
            .addMint(
              PolicyId(techAuthTwoStage.Script.hash()),
              new Map([
                [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
                [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
              ]),
              PlutusData.newInteger(0n),
            )
            .provideScript(techAuthTwoStage.Script)
            .provideScript(techAuthForever.Script)
            .addOutput(
              TransactionOutput.fromCore({
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
              }),
            )
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        techAuthTwoStage.Script.hash() +
                          toHex(new TextEncoder().encode("staging")),
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(
                  Contracts.UpgradeState,
                  techAuthUpgradeState,
                ).toCore(),
              }),
            )
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
                  techAuthForeverState,
                ).toCore(),
              }),
            ),
        );

        // Deploy Council contracts
        const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
          {
            index: config.council_one_shot_index,
            txId: TransactionId(config.council_one_shot_hash),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 10_000_000n,
            },
          },
        ]);

        emulator.addUtxo(councilOneShotUtxo);

        const councilTwoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          councilTwoStage.Script,
        );

        const councilUpgradeState: Contracts.UpgradeState = [
          councilLogic.Script.hash(),
          "",
          mainCouncilUpdateThreshold.Script.hash(),
          "",
          0n,
        ];

        const councilForeverState: Contracts.VersionedMultisig = {
          data: [
            2n,
            {
              ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
                "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
              ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
                "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
            },
          ],
          round: 0n,
        };

        const councilForeverAddress = addressFromValidator(
          NetworkId.Testnet,
          councilForever.Script,
        );

        await emulator.expectValidTransaction(
          blaze,
          blaze
            .newTransaction()
            .addInput(councilOneShotUtxo)
            .addMint(
              PolicyId(councilForever.Script.hash()),
              new Map([[AssetName(""), 1n]]),
              serialize(Contracts.PermissionedRedeemer, {
                [addr.asBase()?.getPaymentCredential().hash!]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                [addr.asBase()?.getStakeCredential().hash!]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
              }),
            )
            .addMint(
              PolicyId(councilTwoStage.Script.hash()),
              new Map([
                [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
                [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
              ]),
              PlutusData.newInteger(0n),
            )
            .provideScript(councilTwoStage.Script)
            .provideScript(councilForever.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(councilTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        councilTwoStage.Script.hash() +
                          toHex(new TextEncoder().encode("main")),
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(
                  Contracts.UpgradeState,
                  councilUpgradeState,
                ).toCore(),
              }),
            )
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(councilTwoStageAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(
                        councilTwoStage.Script.hash() +
                          toHex(new TextEncoder().encode("staging")),
                      ),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(
                  Contracts.UpgradeState,
                  councilUpgradeState,
                ).toCore(),
              }),
            )
            .addOutput(
              TransactionOutput.fromCore({
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
              }),
            ),
        );

        // Add the created tech auth and council UTxOs to emulator
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
                councilForeverState,
              ).toCore(),
            },
          ]),
        );

        // Add threshold UTxOs to emulator for reference
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

        // Add two-stage UTxO to emulator for reference
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
                        toHex(new TextEncoder().encode("main")),
                    ),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                councilUpgradeState,
              ).toCore(),
            },
          ]),
        );

        // Now change the council member
        await emulator.as("newCouncilMember", async (newBlaze, newAddr) => {
          // Add UTxO for new member
          emulator.addUtxo(
            TransactionUnspentOutput.fromCore([
              {
                index: 0,
                txId: TransactionId(
                  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
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

          // Add reward account balance for council logic withdrawal
          const councilLogicRewardAccount = RewardAccount.fromCredential(
            Credential.fromCore({
              hash: councilLogic.Script.hash(),
              type: CredentialType.ScriptHash,
            }).toCore(),
            NetworkId.Testnet,
          );
          emulator.accounts.set(councilLogicRewardAccount, 0n);

          // Create new multisig state with changed member
          const newCouncilForeverState: Contracts.VersionedMultisig = {
            data: [
              3n,
              {
                ["8200581c" + newAddr.asBase()?.getPaymentCredential().hash]:
                  "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
                ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
                  "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
                ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
                  "1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF",
              },
            ],
            round: 0n,
          };

          // Create redeemer with new member public key hashes
          const memberRedeemer: Contracts.PermissionedRedeemer = {
            [newAddr.asBase()?.getPaymentCredential().hash!]:
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
            [addr.asBase()?.getPaymentCredential().hash!]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
            [addr.asBase()?.getStakeCredential().hash!]:
              "1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF",
          };

          const nativeScriptCouncil: NativeScript = NativeScripts.atLeastNOfK(
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
                      councilForeverState,
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
                      techAuthForeverState,
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
                              toHex(new TextEncoder().encode("main")),
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      councilUpgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(councilForever.Script)
              .addMint(
                PolicyId(nativeScriptCouncil.hash()),
                new Map([[AssetName(""), 1n]]),
              )
              .provideScript(Script.newNativeScript(nativeScriptCouncil))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    newCouncilForeverState,
                  ).toCore(),
                }),
              )
              .addWithdrawal(
                RewardAccount.fromCredential(
                  Credential.fromCore({
                    hash: councilLogic.Script.hash(),
                    type: CredentialType.ScriptHash,
                  }).toCore(),
                  NetworkId.Testnet,
                ),
                0n,
                serialize(Contracts.PermissionedRedeemer, memberRedeemer),
              )
              .provideScript(councilLogic.Script),
          );
        });
      });
    });
  });
});
