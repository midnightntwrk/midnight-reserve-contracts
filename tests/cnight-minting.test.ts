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
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import {
  CnightMintingCnightMintTwoStageUpgradeElse,
  CnightMintingV2CnightMintLogicV2Else,
  CnightMintingCnightMintForeverElse,
} from "../deployed-scripts/mainnet/contract_blueprint";
import {
  TestCnightMintingProxyTestCnightMintingProxyElse,
  TestCnightNoAuditTcnightMintInfiniteElse,
} from "../contract_blueprint";
import { describe, expect, test } from "bun:test";
import {
  buildNativeScriptFromState,
  COUNCIL_WITNESS_ASSET,
  findUtxoByToken,
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
  TECH_WITNESS_ASSET,
} from "./helpers/upgrade";

describe("CNight minting proxy chain", () => {
  test("full pipeline: lockdown -> upgrade -> mint", async () => {
    const emulator = new Emulator([]);

    // CNight contracts
    const cnightTwoStage = new CnightMintingCnightMintTwoStageUpgradeElse();
    const cnightLogic = new CnightMintingV2CnightMintLogicV2Else(); // always-false
    const cnightForever = new CnightMintingCnightMintForeverElse();
    const mintingProxy = new TestCnightMintingProxyTestCnightMintingProxyElse();
    const alwaysTrueLogic = new TestCnightNoAuditTcnightMintInfiniteElse();

    // Governance infrastructure
    const stagingGovAuth = new Contracts.GovAuthStagingGovAuthElse();
    const mainGovAuth = new Contracts.GovAuthMainGovAuthElse();
    const stagingGovThreshold =
      new Contracts.ThresholdsStagingGovThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();
    const councilTwoStage =
      new Contracts.PermissionedCouncilTwoStageUpgradeElse();

    // Register forever withdrawal reward account
    const foreverRewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: cnightForever.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(foreverRewardAccount, { balance: 0n });

    // Register always-false logic reward account
    const logicRewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: cnightLogic.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(logicRewardAccount, { balance: 0n });

    // Register staging gov auth reward account
    const govAuthRewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: stagingGovAuth.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(govAuthRewardAccount, { balance: 0n });

    // Two-stage address and initial datum (lockdown: logic = always-false)
    const twoStageAddress = addressFromValidator(
      NetworkId.Testnet,
      cnightTwoStage.Script,
    );

    const initialDatum: Contracts.UpgradeState = [
      cnightLogic.Script.hash(), // logic = always-false
      "", // mitigation_logic = empty
      stagingGovAuth.Script.hash(), // auth = staging gov auth
      "", // mitigation_auth = empty
      0n, // round
      0n, // logic_round
    ];

    // Main UTxO
    const mainUtxo = TransactionUnspentOutput.fromCore([
      { index: 0, txId: TransactionId("aa".repeat(32)) },
      {
        address: PaymentAddress(twoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [AssetId(cnightTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, initialDatum).toCore(),
      },
    ]);

    // Staging UTxO
    const stagingUtxo = TransactionUnspentOutput.fromCore([
      { index: 0, txId: TransactionId("bb".repeat(32)) },
      {
        address: PaymentAddress(twoStageAddress.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [AssetId(cnightTwoStage.Script.hash() + STAGING_TOKEN_HEX), 1n],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, initialDatum).toCore(),
      },
    ]);

    emulator.addUtxo(mainUtxo);
    emulator.addUtxo(stagingUtxo);

    const proxyPolicyId = PolicyId(mintingProxy.Script.hash());
    const assetName = AssetName("00");
    const redeemer = PlutusData.newInteger(0n);

    await emulator.as("deployer", async (blaze, addr) => {
      // --- Funding UTxOs (one per phase that needs a tx) ---
      const fundingUtxos = Array.from({ length: 5 }).map((_, idx) => {
        const txSuffix = idx.toString(16).padStart(4, "0");
        return TransactionUnspentOutput.fromCore([
          { index: idx, txId: TransactionId("ff".repeat(30) + txSuffix) },
          {
            address: PaymentAddress(addr.toBech32()),
            value: { coins: 900_000_000n },
          },
        ]);
      });
      fundingUtxos.forEach((utxo) => emulator.addUtxo(utxo));

      // ===== Phase 2: Verify lockdown — minting FAILS =====

      const lockdownMintTx = blaze
        .newTransaction()
        .addInput(fundingUtxos[0])
        .addReferenceInput(mainUtxo)
        .addMint(proxyPolicyId, new Map([[assetName, 1n]]), redeemer)
        .provideScript(mintingProxy.Script)
        .addWithdrawal(foreverRewardAccount, 0n, redeemer)
        .provideScript(cnightForever.Script)
        .addWithdrawal(logicRewardAccount, 0n, redeemer)
        .provideScript(cnightLogic.Script);

      await expect(
        emulator.expectValidTransaction(blaze, lockdownMintTx),
      ).rejects.toThrow();

      // ===== Phase 3: Two-stage upgrade to always-true logic =====

      const paymentHash = addr.asBase()?.getPaymentCredential().hash!;
      const stakeHash = addr.asBase()?.getStakeCredential().hash!;

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

      // Staging threshold: tech auth required (1/2), council NOT required (0/1)
      const thresholdDatum: Contracts.MultisigThreshold = [1n, 2n, 0n, 1n];

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

      const govAuthRedeemerData = serialize(Contracts.PermissionedRedeemer, {
        [paymentHash]:
          "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
      });

      const applyGovernanceWitnesses = (txBuilder: TxBuilder) =>
        txBuilder
          .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
          .provideScript(stagingGovAuth.Script)
          .addMint(
            PolicyId(techNativeScript.hash()),
            new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
          )
          .provideScript(Script.newNativeScript(techNativeScript))
          .addMint(
            PolicyId(councilNativeScript.hash()),
            new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
          )
          .provideScript(Script.newNativeScript(councilNativeScript));

      // Governance reference UTxOs
      const techForeverUtxo = TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId("e1".repeat(32)) },
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
        { index: 0, txId: TransactionId("e2".repeat(32)) },
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

      const stagingGovThresholdUtxo = TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId("e3".repeat(32)) },
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

      // Council two-stage main UTxO — needed by staging_gov_auth's auth_is_on_main check.
      // The council main datum uses mainGovAuth as auth, so auth_is_on_main returns false
      // for stagingGovAuth, causing the staging threshold to be used.
      const councilTwoStageAddress = addressFromValidator(
        NetworkId.Testnet,
        councilTwoStage.Script,
      );
      const councilMainDatum: Contracts.UpgradeState = [
        councilForever.Script.hash(),
        "",
        mainGovAuth.Script.hash(), // auth = mainGovAuth (not staging)
        "",
        0n,
        0n,
      ];
      const councilMainUtxo = TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId("d1".repeat(32)) },
        {
          address: PaymentAddress(councilTwoStageAddress.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([
              [AssetId(councilTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, councilMainDatum).toCore(),
        },
      ]);

      emulator.addUtxo(techForeverUtxo);
      emulator.addUtxo(councilForeverUtxo);
      emulator.addUtxo(stagingGovThresholdUtxo);
      emulator.addUtxo(councilMainUtxo);

      // --- Step 3a: Stage new logic ---
      const [mainInputCore] = mainUtxo.toCore();
      const stageRedeemer = serialize(Contracts.TwoStageRedeemer, [
        "Logic",
        {
          Staging: [
            {
              transaction_id: mainInputCore.txId.toString(),
              output_index: BigInt(mainInputCore.index),
            },
            alwaysTrueLogic.Script.hash(),
          ],
        },
      ]);

      const stagedDatum: Contracts.UpgradeState = [
        alwaysTrueLogic.Script.hash(), // logic -> always-true
        "", // mitigation_logic unchanged
        stagingGovAuth.Script.hash(), // auth unchanged
        "", // mitigation_auth unchanged
        0n, // round unchanged (Logic update doesn't increment round)
        1n, // logic_round incremented
      ];

      const stageTx = applyGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(fundingUtxos[1])
          .addInput(stagingUtxo, stageRedeemer)
          .addReferenceInput(mainUtxo)
          .addReferenceInput(stagingGovThresholdUtxo)
          .addReferenceInput(techForeverUtxo)
          .addReferenceInput(councilForeverUtxo)
          .addReferenceInput(councilMainUtxo)
          .provideScript(cnightTwoStage.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(twoStageAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(cnightTwoStage.Script.hash() + STAGING_TOKEN_HEX),
                    1n,
                  ],
                ]),
              },
              datum: serialize(Contracts.UpgradeState, stagedDatum).toCore(),
            }),
          ),
      );

      await emulator.expectValidTransaction(blaze, stageTx);

      // --- Step 3b: Promote staged logic to main ---
      const twoStageUtxos =
        await blaze.provider.getUnspentOutputs(twoStageAddress);
      const newStagingUtxo = findUtxoByToken(
        twoStageUtxos,
        cnightTwoStage.Script.hash(),
        STAGING_TOKEN_HEX,
      );
      const newMainUtxo = findUtxoByToken(
        twoStageUtxos,
        cnightTwoStage.Script.hash(),
        MAIN_TOKEN_HEX,
      );

      const [stagingInputCore] = newStagingUtxo.toCore();
      const promoteRedeemer = serialize(Contracts.TwoStageRedeemer, [
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

      const promoteTx = applyGovernanceWitnesses(
        blaze
          .newTransaction()
          .addInput(fundingUtxos[2])
          .addInput(newMainUtxo, promoteRedeemer)
          .addReferenceInput(newStagingUtxo)
          .addReferenceInput(stagingGovThresholdUtxo)
          .addReferenceInput(techForeverUtxo)
          .addReferenceInput(councilForeverUtxo)
          .addReferenceInput(councilMainUtxo)
          .provideScript(cnightTwoStage.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(twoStageAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [AssetId(cnightTwoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
                ]),
              },
              datum: serialize(Contracts.UpgradeState, stagedDatum).toCore(),
            }),
          ),
      );

      await emulator.expectValidTransaction(blaze, promoteTx);

      // ===== Phase 4: Mint succeeds with upgraded logic =====

      // Register always-true logic reward account
      const alwaysTrueRewardAccount = RewardAccount.fromCredential(
        Credential.fromCore({
          hash: alwaysTrueLogic.Script.hash(),
          type: CredentialType.ScriptHash,
        }).toCore(),
        NetworkId.Testnet,
      );
      emulator.accounts.set(alwaysTrueRewardAccount, { balance: 0n });

      const finalUtxos =
        await blaze.provider.getUnspentOutputs(twoStageAddress);
      const promotedMainUtxo = findUtxoByToken(
        finalUtxos,
        cnightTwoStage.Script.hash(),
        MAIN_TOKEN_HEX,
      );

      const successMintTx = blaze
        .newTransaction()
        .addInput(fundingUtxos[3])
        .addReferenceInput(promotedMainUtxo)
        .addMint(proxyPolicyId, new Map([[assetName, 1n]]), redeemer)
        .provideScript(mintingProxy.Script)
        .addWithdrawal(foreverRewardAccount, 0n, redeemer)
        .provideScript(cnightForever.Script)
        .addWithdrawal(alwaysTrueRewardAccount, 0n, redeemer)
        .provideScript(alwaysTrueLogic.Script);

      await emulator.expectValidTransaction(blaze, successMintTx);
    });
  });
});
