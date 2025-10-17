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
          mainTechAuthUpdateThreshold.Script.hash(),
          "",
          0n,
        ];

        const initialTechAuthMembers = [
          fromHex("8200581c" + addr.asBase()?.getPaymentCredential().hash),
          fromHex("8200581c" + addr.asBase()?.getStakeCredential().hash),
        ];

        const techAuthForeverState: Contracts.Multisig = [
          2n,
          PlutusData.fromCore({
            items: initialTechAuthMembers,
          }),
          [],
        ];

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
              PlutusData.fromCore({
                items: [
                  fromHex(addr.asBase()?.getPaymentCredential().hash!),
                  fromHex(addr.asBase()?.getStakeCredential().hash!),
                ],
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
                  Contracts.Multisig,
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
                Contracts.Multisig,
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

        const initialCouncilMembers = [
          fromHex("8200581c" + addr.asBase()?.getPaymentCredential().hash),
          fromHex("8200581c" + addr.asBase()?.getStakeCredential().hash),
        ];

        const councilForeverState: Contracts.Multisig = [
          2n,
          PlutusData.fromCore({
            items: initialCouncilMembers,
          }),
          [],
        ];

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
              PlutusData.fromCore({
                items: [
                  fromHex(addr.asBase()?.getPaymentCredential().hash!),
                  fromHex(addr.asBase()?.getStakeCredential().hash!),
                ],
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
                  Contracts.Multisig,
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
                Contracts.Multisig,
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
          const newTechAuthMembers = [
            fromHex("8200581c" + newAddr.asBase()?.getPaymentCredential().hash), // Changed member
            fromHex("8200581c" + addr.asBase()?.getPaymentCredential().hash), // Keep one original
            fromHex("8200581c" + addr.asBase()?.getStakeCredential().hash), // Keep one original
          ];

          const newTechAuthForeverState: Contracts.Multisig = [
            3n,
            PlutusData.fromCore({
              items: newTechAuthMembers,
            }),
            [],
          ];

          // Create redeemer with new member public key hashes
          const memberRedeemer = PlutusData.fromCore({
            items: [
              fromHex(newAddr.asBase()?.getPaymentCredential().hash!),
              fromHex(addr.asBase()?.getPaymentCredential().hash!),
              fromHex(addr.asBase()?.getStakeCredential().hash!),
            ],
          });

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
                      Contracts.Multisig,
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
                      Contracts.Multisig,
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
                    Contracts.Multisig,
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
                memberRedeemer,
              )
              .provideScript(techAuthLogic.Script),
          );
        });
      });
    });

    // test("Can change council member", async () => {
    //   await emulator.as("deployer", async (blaze, addr) => {
    //     // Add initial UTxO for deployer
    //     emulator.addUtxo(
    //       TransactionUnspentOutput.fromCore([
    //         {
    //           index: 0,
    //           txId: TransactionId(
    //             "1111111111111111111111111111111111111111111111111111111111111111",
    //           ),
    //         },
    //         {
    //           address: PaymentAddress(addr.toBech32()),
    //           value: {
    //             coins: amount * 10n,
    //           },
    //         },
    //       ]),
    //     );

    //     // Deploy Tech Auth Update Threshold first
    //     const techAuthUpdateThresholdOneShotUtxo =
    //       TransactionUnspentOutput.fromCore([
    //         {
    //           index: config.main_tech_auth_update_one_shot_index,
    //           txId: TransactionId(config.main_tech_auth_update_one_shot_hash),
    //         },
    //         {
    //           address: PaymentAddress(addr.toBech32()),
    //           value: {
    //             coins: 10_000_000n,
    //           },
    //         },
    //       ]);

    //     emulator.addUtxo(techAuthUpdateThresholdOneShotUtxo);

    //     const techAuthUpdateThresholdAddress = addressFromValidator(
    //       NetworkId.Testnet,
    //       mainTechAuthUpdateThreshold.Script,
    //     );

    //     const thresholdDatum: Contracts.MultisigThreshold = {
    //       technical_auth_numerator: 2n,
    //       technical_auth_denominator: 3n,
    //       council_numerator: 2n,
    //       council_denominator: 3n,
    //     };

    //     await emulator.expectValidTransaction(
    //       blaze,
    //       blaze
    //         .newTransaction()
    //         .addInput(techAuthUpdateThresholdOneShotUtxo)
    //         .addMint(
    //           PolicyId(mainTechAuthUpdateThreshold.Script.hash()),
    //           new Map([[AssetName(""), 1n]]),
    //           PlutusData.newInteger(0n),
    //         )
    //         .provideScript(mainTechAuthUpdateThreshold.Script)
    //         .addOutput(
    //           TransactionOutput.fromCore({
    //             address: PaymentAddress(
    //               techAuthUpdateThresholdAddress.toBech32(),
    //             ),
    //             value: {
    //               coins: 2_000_000n,
    //               assets: new Map([
    //                 [AssetId(mainTechAuthUpdateThreshold.Script.hash()), 1n],
    //               ]),
    //             },
    //             datum: serialize(
    //               Contracts.MultisigThreshold,
    //               thresholdDatum,
    //             ).toCore(),
    //           }),
    //         ),
    //     );

    //     // Deploy Council Update Threshold
    //     const councilUpdateThresholdOneShotUtxo =
    //       TransactionUnspentOutput.fromCore([
    //         {
    //           index: config.main_council_update_one_shot_index,
    //           txId: TransactionId(config.main_council_update_one_shot_hash),
    //         },
    //         {
    //           address: PaymentAddress(addr.toBech32()),
    //           value: {
    //             coins: 10_000_000n,
    //           },
    //         },
    //       ]);

    //     emulator.addUtxo(councilUpdateThresholdOneShotUtxo);

    //     const councilUpdateThresholdAddress = addressFromValidator(
    //       NetworkId.Testnet,
    //       mainCouncilUpdateThreshold.Script,
    //     );

    //     await emulator.expectValidTransaction(
    //       blaze,
    //       blaze
    //         .newTransaction()
    //         .addInput(councilUpdateThresholdOneShotUtxo)
    //         .addMint(
    //           PolicyId(mainCouncilUpdateThreshold.Script.hash()),
    //           new Map([[AssetName(""), 1n]]),
    //           PlutusData.newInteger(0n),
    //         )
    //         .provideScript(mainCouncilUpdateThreshold.Script)
    //         .addOutput(
    //           TransactionOutput.fromCore({
    //             address: PaymentAddress(
    //               councilUpdateThresholdAddress.toBech32(),
    //             ),
    //             value: {
    //               coins: 2_000_000n,
    //               assets: new Map([
    //                 [AssetId(mainCouncilUpdateThreshold.Script.hash()), 1n],
    //               ]),
    //             },
    //             datum: serialize(
    //               Contracts.MultisigThreshold,
    //               thresholdDatum,
    //             ).toCore(),
    //           }),
    //         ),
    //     );

    //     // Deploy Technical Authority contracts
    //     const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
    //       {
    //         index: config.technical_authority_one_shot_index,
    //         txId: TransactionId(config.technical_authority_one_shot_hash),
    //       },
    //       {
    //         address: PaymentAddress(addr.toBech32()),
    //         value: {
    //           coins: 10_000_000n,
    //         },
    //       },
    //     ]);

    //     emulator.addUtxo(techAuthOneShotUtxo);

    //     const techAuthTwoStageAddress = addressFromValidator(
    //       NetworkId.Testnet,
    //       techAuthTwoStage.Script,
    //     );

    //     const techAuthUpgradeState: Contracts.UpgradeState = [
    //       techAuthLogic.Script.hash(),
    //       "",
    //       mainTechAuthUpdateThreshold.Script.hash(),
    //       "",
    //       0n,
    //     ];

    //     const initialTechAuthMembers = [
    //       fromHex("8200581c" + addr.asBase()?.getPaymentCredential().hash),
    //       fromHex("8200581c" + addr.asBase()?.getStakeCredential().hash),
    //     ];

    //     const techAuthForeverState: Contracts.Multisig = [
    //       2n,
    //       PlutusData.fromCore({
    //         items: initialTechAuthMembers,
    //       }),
    //     ];

    //     const techAuthForeverAddress = addressFromValidator(
    //       NetworkId.Testnet,
    //       techAuthForever.Script,
    //     );

    //     await emulator.expectValidTransaction(
    //       blaze,
    //       blaze
    //         .newTransaction()
    //         .addInput(techAuthOneShotUtxo)
    //         .addMint(
    //           PolicyId(techAuthForever.Script.hash()),
    //           new Map([[AssetName(""), 1n]]),
    //           PlutusData.fromCore({
    //             items: [
    //               fromHex(addr.asBase()?.getPaymentCredential().hash!),
    //               fromHex(addr.asBase()?.getStakeCredential().hash!),
    //             ],
    //           }),
    //         )
    //         .addMint(
    //           PolicyId(techAuthTwoStage.Script.hash()),
    //           new Map([
    //             [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
    //             [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
    //           ]),
    //           PlutusData.newInteger(0n),
    //         )
    //         .provideScript(techAuthTwoStage.Script)
    //         .provideScript(techAuthForever.Script)
    //         .addOutput(
    //           TransactionOutput.fromCore({
    //             address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
    //             value: {
    //               coins: 2_000_000n,
    //               assets: new Map([
    //                 [
    //                   AssetId(
    //                     techAuthTwoStage.Script.hash() +
    //                       toHex(new TextEncoder().encode("main")),
    //                   ),
    //                   1n,
    //                 ],
    //               ]),
    //             },
    //             datum: serialize(
    //               Contracts.UpgradeState,
    //               techAuthUpgradeState,
    //             ).toCore(),
    //           }),
    //         )
    //         .addOutput(
    //           TransactionOutput.fromCore({
    //             address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
    //             value: {
    //               coins: 2_000_000n,
    //               assets: new Map([
    //                 [
    //                   AssetId(
    //                     techAuthTwoStage.Script.hash() +
    //                       toHex(new TextEncoder().encode("staging")),
    //                   ),
    //                   1n,
    //                 ],
    //               ]),
    //             },
    //             datum: serialize(
    //               Contracts.UpgradeState,
    //               techAuthUpgradeState,
    //             ).toCore(),
    //           }),
    //         )
    //         .addOutput(
    //           TransactionOutput.fromCore({
    //             address: PaymentAddress(techAuthForeverAddress.toBech32()),
    //             value: {
    //               coins: 2_000_000n,
    //               assets: new Map([
    //                 [AssetId(techAuthForever.Script.hash()), 1n],
    //               ]),
    //             },
    //             datum: serialize(
    //               Contracts.Multisig,
    //               techAuthForeverState,
    //             ).toCore(),
    //           }),
    //         ),
    //     );

    //     // Deploy Council contracts
    //     const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
    //       {
    //         index: config.council_one_shot_index,
    //         txId: TransactionId(config.council_one_shot_hash),
    //       },
    //       {
    //         address: PaymentAddress(addr.toBech32()),
    //         value: {
    //           coins: 10_000_000n,
    //         },
    //       },
    //     ]);

    //     emulator.addUtxo(councilOneShotUtxo);

    //     const councilTwoStageAddress = addressFromValidator(
    //       NetworkId.Testnet,
    //       councilTwoStage.Script,
    //     );

    //     const councilUpgradeState: Contracts.UpgradeState = [
    //       councilLogic.Script.hash(),
    //       "",
    //       mainCouncilUpdateThreshold.Script.hash(),
    //       "",
    //       0n,
    //     ];

    //     const initialCouncilMembers = [
    //       fromHex("8200581c" + addr.asBase()?.getPaymentCredential().hash),
    //       fromHex("8200581c" + addr.asBase()?.getStakeCredential().hash),
    //     ];

    //     const councilForeverState: Contracts.Multisig = [
    //       2n,
    //       PlutusData.fromCore({
    //         items: initialCouncilMembers,
    //       }),
    //     ];

    //     const councilForeverAddress = addressFromValidator(
    //       NetworkId.Testnet,
    //       councilForever.Script,
    //     );

    //     await emulator.expectValidTransaction(
    //       blaze,
    //       blaze
    //         .newTransaction()
    //         .addInput(councilOneShotUtxo)
    //         .addMint(
    //           PolicyId(councilForever.Script.hash()),
    //           new Map([[AssetName(""), 1n]]),
    //           PlutusData.fromCore({
    //             items: [
    //               fromHex(addr.asBase()?.getPaymentCredential().hash!),
    //               fromHex(addr.asBase()?.getStakeCredential().hash!),
    //             ],
    //           }),
    //         )
    //         .addMint(
    //           PolicyId(councilTwoStage.Script.hash()),
    //           new Map([
    //             [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
    //             [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
    //           ]),
    //           PlutusData.newInteger(0n),
    //         )
    //         .provideScript(councilTwoStage.Script)
    //         .provideScript(councilForever.Script)
    //         .addOutput(
    //           TransactionOutput.fromCore({
    //             address: PaymentAddress(councilTwoStageAddress.toBech32()),
    //             value: {
    //               coins: 2_000_000n,
    //               assets: new Map([
    //                 [
    //                   AssetId(
    //                     councilTwoStage.Script.hash() +
    //                       toHex(new TextEncoder().encode("main")),
    //                   ),
    //                   1n,
    //                 ],
    //               ]),
    //             },
    //             datum: serialize(
    //               Contracts.UpgradeState,
    //               councilUpgradeState,
    //             ).toCore(),
    //           }),
    //         )
    //         .addOutput(
    //           TransactionOutput.fromCore({
    //             address: PaymentAddress(councilTwoStageAddress.toBech32()),
    //             value: {
    //               coins: 2_000_000n,
    //               assets: new Map([
    //                 [
    //                   AssetId(
    //                     councilTwoStage.Script.hash() +
    //                       toHex(new TextEncoder().encode("staging")),
    //                   ),
    //                   1n,
    //                 ],
    //               ]),
    //             },
    //             datum: serialize(
    //               Contracts.UpgradeState,
    //               councilUpgradeState,
    //             ).toCore(),
    //           }),
    //         )
    //         .addOutput(
    //           TransactionOutput.fromCore({
    //             address: PaymentAddress(councilForeverAddress.toBech32()),
    //             value: {
    //               coins: 2_000_000n,
    //               assets: new Map([
    //                 [AssetId(councilForever.Script.hash()), 1n],
    //               ]),
    //             },
    //             datum: serialize(
    //               Contracts.Multisig,
    //               councilForeverState,
    //             ).toCore(),
    //           }),
    //         ),
    //     );

    //     // Now change the council member
    //     await emulator.as("newCouncilMember", async (newBlaze, newAddr) => {
    //       // Add UTxO for new member
    //       emulator.addUtxo(
    //         TransactionUnspentOutput.fromCore([
    //           {
    //             index: 0,
    //             txId: TransactionId(
    //               "6666666666666666666666666666666666666666666666666666666666666666",
    //             ),
    //           },
    //           {
    //             address: PaymentAddress(newAddr.toBech32()),
    //             value: {
    //               coins: amount,
    //             },
    //           },
    //         ]),
    //       );

    //       // Create new multisig state with changed member
    //       const newCouncilMembers = [
    //         fromHex("8200581c" + newAddr.asBase()?.getPaymentCredential().hash), // Changed member
    //         fromHex("8200581c" + addr.asBase()?.getStakeCredential().hash), // Keep one original
    //       ];

    //       const newCouncilForeverState: Contracts.Multisig = [
    //         2n,
    //         PlutusData.fromCore({
    //           items: newCouncilMembers,
    //         }),
    //       ];

    //       // Create redeemer with new member public key hashes
    //       const memberRedeemer = PlutusData.fromCore({
    //         items: [
    //           fromHex(newAddr.asBase()?.getPaymentCredential().hash!),
    //           fromHex(addr.asBase()?.getStakeCredential().hash!),
    //         ],
    //       });

    //       const councilLogicAddress = addressFromValidator(
    //         NetworkId.Testnet,
    //         councilLogic.Script,
    //       );

    //       // Change member transaction using logic validator
    //       await emulator.expectValidTransaction(
    //         newBlaze,
    //         newBlaze
    //           .newTransaction()
    //           .addInput(
    //             TransactionUnspentOutput.fromCore([
    //               {
    //                 index: 0,
    //                 txId: TransactionId(
    //                   "7777777777777777777777777777777777777777777777777777777777777777",
    //                 ),
    //               },
    //               {
    //                 address: PaymentAddress(councilForeverAddress.toBech32()),
    //                 value: {
    //                   coins: 2_000_000n,
    //                   assets: new Map([
    //                     [AssetId(councilForever.Script.hash()), 1n],
    //                   ]),
    //                 },
    //                 datum: serialize(
    //                   Contracts.Multisig,
    //                   councilForeverState,
    //                 ).toCore(),
    //               },
    //             ]),
    //             memberRedeemer,
    //           )
    //           .addReferenceInput(
    //             TransactionUnspentOutput.fromCore([
    //               {
    //                 index: 0,
    //                 txId: TransactionId(
    //                   "8888888888888888888888888888888888888888888888888888888888888888",
    //                 ),
    //               },
    //               {
    //                 address: PaymentAddress(
    //                   councilUpdateThresholdAddress.toBech32(),
    //                 ),
    //                 value: {
    //                   coins: 2_000_000n,
    //                   assets: new Map([
    //                     [AssetId(mainCouncilUpdateThreshold.Script.hash()), 1n],
    //                   ]),
    //                 },
    //                 datum: serialize(
    //                   Contracts.MultisigThreshold,
    //                   thresholdDatum,
    //                 ).toCore(),
    //               },
    //             ]),
    //           )
    //           .addReferenceInput(
    //             TransactionUnspentOutput.fromCore([
    //               {
    //                 index: 0,
    //                 txId: TransactionId(
    //                   "9999999999999999999999999999999999999999999999999999999999999999",
    //                 ),
    //               },
    //               {
    //                 address: PaymentAddress(techAuthForeverAddress.toBech32()),
    //                 value: {
    //                   coins: 2_000_000n,
    //                   assets: new Map([
    //                     [AssetId(techAuthForever.Script.hash()), 1n],
    //                   ]),
    //                 },
    //                 datum: serialize(
    //                   Contracts.Multisig,
    //                   techAuthForeverState,
    //                 ).toCore(),
    //               },
    //             ]),
    //           )
    //           .addReferenceInput(
    //             TransactionUnspentOutput.fromCore([
    //               {
    //                 index: 0,
    //                 txId: TransactionId(
    //                   "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    //                 ),
    //               },
    //               {
    //                 address: PaymentAddress(councilTwoStageAddress.toBech32()),
    //                 value: {
    //                   coins: 2_000_000n,
    //                   assets: new Map([
    //                     [
    //                       AssetId(
    //                         councilTwoStage.Script.hash() +
    //                           toHex(new TextEncoder().encode("main")),
    //                       ),
    //                       1n,
    //                     ],
    //                   ]),
    //                 },
    //                 datum: serialize(
    //                   Contracts.UpgradeState,
    //                   councilUpgradeState,
    //                 ).toCore(),
    //               },
    //             ]),
    //           )
    //           .addMint(
    //             PolicyId(
    //               "8200581c" + newAddr.asBase()?.getPaymentCredential().hash!,
    //             ),
    //             new Map([[AssetName(""), 1n]]),
    //             PlutusData.newInteger(0n),
    //           )
    //           .addMint(
    //             PolicyId(
    //               "8200581c" + addr.asBase()?.getStakeCredential().hash!,
    //             ),
    //             new Map([[AssetName(""), 1n]]),
    //             PlutusData.newInteger(0n),
    //           )
    //           .provideScript(councilForever.Script)
    //           .addOutput(
    //             TransactionOutput.fromCore({
    //               address: PaymentAddress(councilForeverAddress.toBech32()),
    //               value: {
    //                 coins: 2_000_000n,
    //                 assets: new Map([
    //                   [AssetId(councilForever.Script.hash()), 1n],
    //                 ]),
    //               },
    //               datum: serialize(
    //                 Contracts.Multisig,
    //                 newCouncilForeverState,
    //               ).toCore(),
    //             }),
    //           )
    //           .addWithdrawal(
    //             RewardAccount(
    //               `stake_test1u${councilLogic.Script.hash().slice(2)}`,
    //             ),
    //             0n,
    //             PlutusData.newInteger(0n),
    //           )
    //           .provideScript(councilLogic.Script),
    //       );
    //     });
    //   });
    // });
  });
});
