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
  type Address,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import type { Blaze, Provider, Wallet } from "@blaze-cardano/sdk";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import { beforeEach, describe, expect, test } from "bun:test";

describe("Change Terms and Conditions", () => {
  const amount = 100_000_000n;

  let emulator = new Emulator([]);

  // Contract instances
  const termsForever =
    new Contracts.TermsAndConditionsTermsAndConditionsForeverElse();
  const termsLogic =
    new Contracts.TermsAndConditionsTermsAndConditionsLogicElse();
  const termsTwoStage =
    new Contracts.TermsAndConditionsTermsAndConditionsTwoStageUpgradeElse();
  const termsThreshold =
    new Contracts.ThresholdsTermsAndConditionsThresholdElse();

  const techAuthTwoStage =
    new Contracts.PermissionedTechAuthTwoStageUpgradeElse();
  const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
  const techAuthLogic = new Contracts.PermissionedTechAuthLogicElse();

  const councilTwoStage =
    new Contracts.PermissionedCouncilTwoStageUpgradeElse();
  const councilForever = new Contracts.PermissionedCouncilForeverElse();
  const councilLogic = new Contracts.PermissionedCouncilLogicElse();

  const _mainCouncilUpdateThreshold =
    new Contracts.ThresholdsMainCouncilUpdateThresholdElse();
  const mainTechAuthUpdateThreshold =
    new Contracts.ThresholdsMainTechAuthUpdateThresholdElse();

  // Mainnet one-shot config (all contracts share the same deployment tx)
  const MAINNET_ONE_SHOT_HASH =
    "d514e2ca336b1b6bb962433c4730fe7cab593b7ca230208a73896cf2145cb717";
  const config = {
    technical_authority_one_shot_hash: MAINNET_ONE_SHOT_HASH,
    technical_authority_one_shot_index: 3,
    council_one_shot_hash: MAINNET_ONE_SHOT_HASH,
    council_one_shot_index: 1,
    terms_one_shot_hash: MAINNET_ONE_SHOT_HASH,
    terms_one_shot_index: 12,
    terms_threshold_one_shot_hash: MAINNET_ONE_SHOT_HASH,
    terms_threshold_one_shot_index: 13,
    main_council_update_one_shot_hash: MAINNET_ONE_SHOT_HASH,
    main_council_update_one_shot_index: 7,
    main_tech_auth_update_one_shot_hash: MAINNET_ONE_SHOT_HASH,
    main_tech_auth_update_one_shot_index: 8,
  };

  beforeEach(async () => {
    emulator = new Emulator([]);
  });

  /** Deploy all prerequisite contracts and return UTxO references */
  async function deployAll(
    emulator: Emulator,
    blaze: Blaze<Provider, Wallet>,
    addr: Address,
  ) {
    const thresholdDatum: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];

    // --- Deploy Tech Auth Update Threshold ---
    const techAuthUpdateThresholdOneShotUtxo =
      TransactionUnspentOutput.fromCore([
        {
          index: config.main_tech_auth_update_one_shot_index,
          txId: TransactionId(config.main_tech_auth_update_one_shot_hash),
        },
        {
          address: PaymentAddress(addr.toBech32()),
          value: { coins: 10_000_000n },
        },
      ]);
    emulator.addUtxo(techAuthUpdateThresholdOneShotUtxo);

    const techAuthUpdateThresholdAddress = addressFromValidator(
      NetworkId.Testnet,
      mainTechAuthUpdateThreshold.Script,
    );

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
            address: PaymentAddress(techAuthUpdateThresholdAddress.toBech32()),
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

    // --- Deploy Terms Threshold ---
    const termsThresholdOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.terms_threshold_one_shot_index,
        txId: TransactionId(config.terms_threshold_one_shot_hash),
      },
      {
        address: PaymentAddress(addr.toBech32()),
        value: { coins: 10_000_000n },
      },
    ]);
    emulator.addUtxo(termsThresholdOneShotUtxo);

    const termsThresholdAddress = addressFromValidator(
      NetworkId.Testnet,
      termsThreshold.Script,
    );

    await emulator.expectValidTransaction(
      blaze,
      blaze
        .newTransaction()
        .addInput(termsThresholdOneShotUtxo)
        .addMint(
          PolicyId(termsThreshold.Script.hash()),
          new Map([[AssetName(""), 1n]]),
          PlutusData.newInteger(0n),
        )
        .provideScript(termsThreshold.Script)
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(termsThresholdAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(termsThreshold.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.MultisigThreshold,
              thresholdDatum,
            ).toCore(),
          }),
        ),
    );

    // --- Deploy Tech Auth Forever + Two Stage ---
    const techAuthOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.technical_authority_one_shot_index,
        txId: TransactionId(config.technical_authority_one_shot_hash),
      },
      {
        address: PaymentAddress(addr.toBech32()),
        value: { coins: 10_000_000n },
      },
    ]);
    emulator.addUtxo(techAuthOneShotUtxo);

    const techAuthTwoStageAddress = addressFromValidator(
      NetworkId.Testnet,
      techAuthTwoStage.Script,
    );
    const techAuthForeverAddress = addressFromValidator(
      NetworkId.Testnet,
      techAuthForever.Script,
    );

    const techAuthUpgradeState: Contracts.UpgradeState = [
      techAuthLogic.Script.hash(),
      "",
      new Contracts.GovAuthMainGovAuthElse().Script.hash(),
      "",
      0n,
      0n,
    ];

    const techAuthForeverState: Contracts.VersionedMultisig = [
      [
        2n,
        {
          ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
            "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
          ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
            "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
        },
      ],
      0n,
    ];

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
              assets: new Map([[AssetId(techAuthForever.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.VersionedMultisig,
              techAuthForeverState,
            ).toCore(),
          }),
        ),
    );

    // --- Deploy Council Forever + Two Stage ---
    const councilOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.council_one_shot_index,
        txId: TransactionId(config.council_one_shot_hash),
      },
      {
        address: PaymentAddress(addr.toBech32()),
        value: { coins: 10_000_000n },
      },
    ]);
    emulator.addUtxo(councilOneShotUtxo);

    const councilTwoStageAddress = addressFromValidator(
      NetworkId.Testnet,
      councilTwoStage.Script,
    );
    const councilForeverAddress = addressFromValidator(
      NetworkId.Testnet,
      councilForever.Script,
    );

    const councilUpgradeState: Contracts.UpgradeState = [
      councilLogic.Script.hash(),
      "",
      new Contracts.GovAuthMainGovAuthElse().Script.hash(),
      "",
      0n,
      0n,
    ];

    const councilForeverState: Contracts.VersionedMultisig = [
      [
        2n,
        {
          ["8200581c" + addr.asBase()?.getPaymentCredential().hash]:
            "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
          ["8200581c" + addr.asBase()?.getStakeCredential().hash]:
            "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
        },
      ],
      0n,
    ];

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
              assets: new Map([[AssetId(councilForever.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.VersionedMultisig,
              councilForeverState,
            ).toCore(),
          }),
        ),
    );

    // --- Deploy Terms Forever + Two Stage ---
    const termsOneShotUtxo = TransactionUnspentOutput.fromCore([
      {
        index: config.terms_one_shot_index,
        txId: TransactionId(config.terms_one_shot_hash),
      },
      {
        address: PaymentAddress(addr.toBech32()),
        value: { coins: 10_000_000n },
      },
    ]);
    emulator.addUtxo(termsOneShotUtxo);

    const termsTwoStageAddress = addressFromValidator(
      NetworkId.Testnet,
      termsTwoStage.Script,
    );
    const termsForeverAddress = addressFromValidator(
      NetworkId.Testnet,
      termsForever.Script,
    );

    const termsUpgradeState: Contracts.UpgradeState = [
      termsLogic.Script.hash(),
      "",
      termsThreshold.Script.hash(),
      "",
      0n,
      0n,
    ];

    const initialTerms: Contracts.VersionedTermsAndConditions = [
      [
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "68747470733a2f2f6578616d706c652e636f6d",
      ],
      0n,
    ];

    await emulator.expectValidTransaction(
      blaze,
      blaze
        .newTransaction()
        .addInput(termsOneShotUtxo)
        .addMint(
          PolicyId(termsForever.Script.hash()),
          new Map([[AssetName(""), 1n]]),
          PlutusData.newInteger(0n),
        )
        .addMint(
          PolicyId(termsTwoStage.Script.hash()),
          new Map([
            [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
            [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
          ]),
          PlutusData.newInteger(0n),
        )
        .provideScript(termsTwoStage.Script)
        .provideScript(termsForever.Script)
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(termsTwoStageAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [
                  AssetId(
                    termsTwoStage.Script.hash() +
                      toHex(new TextEncoder().encode("main")),
                  ),
                  1n,
                ],
              ]),
            },
            datum: serialize(
              Contracts.UpgradeState,
              termsUpgradeState,
            ).toCore(),
          }),
        )
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(termsTwoStageAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [
                  AssetId(
                    termsTwoStage.Script.hash() +
                      toHex(new TextEncoder().encode("staging")),
                  ),
                  1n,
                ],
              ]),
            },
            datum: serialize(
              Contracts.UpgradeState,
              termsUpgradeState,
            ).toCore(),
          }),
        )
        .addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(termsForeverAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(termsForever.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.VersionedTermsAndConditions,
              initialTerms,
            ).toCore(),
          }),
        ),
    );

    // Add UTxOs that the change-terms tx will reference
    const termsForeverUtxoId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0001";
    const termsThresholdUtxoId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0002";
    const councilForeverUtxoId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0003";
    const techAuthForeverUtxoId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0004";
    const termsTwoStageUtxoId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0005";
    const councilTwoStageUtxoId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0006";
    const techAuthTwoStageUtxoId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0007";

    emulator.addUtxo(
      TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId(termsForeverUtxoId) },
        {
          address: PaymentAddress(termsForeverAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(termsForever.Script.hash()), 1n]]),
          },
          datum: serialize(
            Contracts.VersionedTermsAndConditions,
            initialTerms,
          ).toCore(),
        },
      ]),
    );

    emulator.addUtxo(
      TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId(termsThresholdUtxoId) },
        {
          address: PaymentAddress(termsThresholdAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(termsThreshold.Script.hash()), 1n]]),
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
        { index: 0, txId: TransactionId(councilForeverUtxoId) },
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

    emulator.addUtxo(
      TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId(techAuthForeverUtxoId) },
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
        { index: 0, txId: TransactionId(termsTwoStageUtxoId) },
        {
          address: PaymentAddress(termsTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [
                AssetId(
                  termsTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("main")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, termsUpgradeState).toCore(),
        },
      ]),
    );

    emulator.addUtxo(
      TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId(councilTwoStageUtxoId) },
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

    emulator.addUtxo(
      TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId(techAuthTwoStageUtxoId) },
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

    return {
      thresholdDatum,
      termsForeverAddress,
      termsThresholdAddress,
      techAuthForeverAddress,
      techAuthTwoStageAddress,
      councilForeverAddress,
      councilTwoStageAddress,
      termsUpgradeState,
      initialTerms,
      techAuthForeverState,
      councilForeverState,
      councilUpgradeState,
      techAuthUpgradeState,
      termsForeverUtxoId,
      termsThresholdUtxoId,
      councilForeverUtxoId,
      techAuthForeverUtxoId,
      termsTwoStageUtxoId,
    };
  }

  /** Build the change-terms transaction */
  function buildChangeTermsTx(
    blaze: Blaze<Provider, Wallet>,
    addr: Address,
    deps: Awaited<ReturnType<typeof deployAll>>,
    newHash: string,
    newUrl: string,
  ) {
    const newTerms: Contracts.VersionedTermsAndConditions = [
      [newHash, newUrl],
      0n,
    ];

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

    const termsLogicRewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: termsLogic.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );

    return blaze
      .newTransaction()
      .addInput(
        TransactionUnspentOutput.fromCore([
          { index: 0, txId: TransactionId(deps.termsForeverUtxoId) },
          {
            address: PaymentAddress(deps.termsForeverAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(termsForever.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.VersionedTermsAndConditions,
              deps.initialTerms,
            ).toCore(),
          },
        ]),
        PlutusData.newInteger(0n),
      )
      .addReferenceInput(
        TransactionUnspentOutput.fromCore([
          { index: 0, txId: TransactionId(deps.termsThresholdUtxoId) },
          {
            address: PaymentAddress(deps.termsThresholdAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(termsThreshold.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.MultisigThreshold,
              deps.thresholdDatum,
            ).toCore(),
          },
        ]),
      )
      .addReferenceInput(
        TransactionUnspentOutput.fromCore([
          { index: 0, txId: TransactionId(deps.councilForeverUtxoId) },
          {
            address: PaymentAddress(deps.councilForeverAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(councilForever.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.VersionedMultisig,
              deps.councilForeverState,
            ).toCore(),
          },
        ]),
      )
      .addReferenceInput(
        TransactionUnspentOutput.fromCore([
          { index: 0, txId: TransactionId(deps.techAuthForeverUtxoId) },
          {
            address: PaymentAddress(deps.techAuthForeverAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(techAuthForever.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.VersionedMultisig,
              deps.techAuthForeverState,
            ).toCore(),
          },
        ]),
      )
      .provideScript(termsForever.Script)
      .addReferenceInput(
        TransactionUnspentOutput.fromCore([
          { index: 0, txId: TransactionId(deps.termsTwoStageUtxoId) },
          {
            address: PaymentAddress(
              addressFromValidator(
                NetworkId.Testnet,
                termsTwoStage.Script,
              ).toBech32(),
            ),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [
                  AssetId(
                    termsTwoStage.Script.hash() +
                      toHex(new TextEncoder().encode("main")),
                  ),
                  1n,
                ],
              ]),
            },
            datum: serialize(
              Contracts.UpgradeState,
              deps.termsUpgradeState,
            ).toCore(),
          },
        ]),
      )
      .addMint(
        PolicyId(nativeScriptCouncil.hash()),
        new Map([[AssetName(""), 1n]]),
      )
      .provideScript(Script.newNativeScript(nativeScriptCouncil))
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(deps.termsForeverAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[AssetId(termsForever.Script.hash()), 1n]]),
          },
          datum: serialize(
            Contracts.VersionedTermsAndConditions,
            newTerms,
          ).toCore(),
        }),
      )
      .addWithdrawal(termsLogicRewardAccount, 0n, PlutusData.newInteger(0n))
      .provideScript(termsLogic.Script);
  }

  test("Can change terms with valid 32-byte hash", async () => {
    await emulator.as("deployer", async (blaze, addr) => {
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
            value: { coins: amount * 10n },
          },
        ]),
      );

      const deps = await deployAll(emulator, blaze, addr);

      // Register reward account for logic withdrawal
      const termsLogicRewardAccount = RewardAccount.fromCredential(
        Credential.fromCore({
          hash: termsLogic.Script.hash(),
          type: CredentialType.ScriptHash,
        }).toCore(),
        NetworkId.Testnet,
      );
      emulator.accounts.set(termsLogicRewardAccount, { balance: 0n });

      // Add fee UTxO
      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId(
              "fefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefe",
            ),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: { coins: amount },
          },
        ]),
      );

      const newHash =
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const newUrl = "68747470733a2f2f6e65772e636f6d";

      const txBuilder = buildChangeTermsTx(blaze, addr, deps, newHash, newUrl);
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
  });

  test("31-byte hash produces 'Validator returned false' trace", async () => {
    await emulator.as("deployer", async (blaze, addr) => {
      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId(
              "2222222222222222222222222222222222222222222222222222222222222222",
            ),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: { coins: amount * 10n },
          },
        ]),
      );

      const deps = await deployAll(emulator, blaze, addr);

      const termsLogicRewardAccount = RewardAccount.fromCredential(
        Credential.fromCore({
          hash: termsLogic.Script.hash(),
          type: CredentialType.ScriptHash,
        }).toCore(),
        NetworkId.Testnet,
      );
      emulator.accounts.set(termsLogicRewardAccount, { balance: 0n });

      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 0,
            txId: TransactionId(
              "fdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfd",
            ),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: { coins: amount },
          },
        ]),
      );

      // 31 bytes (62 hex chars) — will cause validator to return false with trace
      const badHash =
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const newUrl = "68747470733a2f2f6e65772e636f6d";

      const txBuilder = buildChangeTermsTx(blaze, addr, deps, badHash, newUrl);

      try {
        await emulator.expectValidTransaction(blaze, txBuilder);
        throw new Error("Should have failed");
      } catch (e) {
        const msg = String(e);
        expect(msg).toContain("Validator returned false");
      }
    });
  });
});
