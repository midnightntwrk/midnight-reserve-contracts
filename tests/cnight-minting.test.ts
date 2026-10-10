import {
  addressFromValidator,
  AssetName,
  NetworkId,
  PlutusData,
  PolicyId,
  type Script,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Emulator } from "@blaze-cardano/emulator";
import { Either, Option } from "effect";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import {
  TestCnightMintingProxyTestCnightMintingProxyElse,
  TestCnightNoAuditTcnightMintInfiniteElse,
} from "../contract_blueprint_mainnet";
import { describe, test } from "bun:test";
import {
  buildPromoteUpgradeTx,
  buildStageUpgradeTx,
  type GovernanceAuthority,
} from "../cli/governance/two-stage-upgrade";
import {
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
} from "../cli/chain/governance-provider";
import {
  councilSigners,
  feeUtxo,
  findUtxoByToken,
  registerRewardAccount,
  scriptUtxo,
  techAuthSigners,
  upgradeState,
  requirementsOf,
  thresholdUtxo,
  authorityForevers,
} from "./helpers/fixtures";

describe("CNight minting proxy chain", () => {
  test("full pipeline: lockdown -> upgrade -> mint", async () => {
    const emulator = new Emulator([]);

    const cnightTwoStage =
      new Contracts.CnightMintingCnightMintTwoStageUpgradeElse();
    const cnightLogic = new Contracts.CnightMintingV2CnightMintLogicV2Else(); // always-false
    const cnightForever = new Contracts.CnightMintingCnightMintForeverElse();
    const mintingProxy = new TestCnightMintingProxyTestCnightMintingProxyElse();
    const alwaysTrueLogic = new TestCnightNoAuditTcnightMintInfiniteElse();

    const stagingGovAuth = new Contracts.GovAuthStagingGovAuthElse();
    const mainGovAuth = new Contracts.GovAuthMainGovAuthElse();
    const stagingGovThreshold =
      new Contracts.ThresholdsStagingGovThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();
    const councilTwoStage =
      new Contracts.PermissionedCouncilTwoStageUpgradeElse();

    const rewardAccount = (script: Script) =>
      registerRewardAccount(emulator, script.hash());
    const foreverRewardAccount = rewardAccount(cnightForever.Script);
    rewardAccount(stagingGovAuth.Script);

    // Lockdown: logic is the always-false script.
    const initialDatum = upgradeState(
      cnightLogic.Script.hash(),
      stagingGovAuth.Script.hash(),
    );
    const mainUtxo = scriptUtxo(
      "aa".repeat(32),
      cnightTwoStage.Script,
      MAIN_TOKEN_HEX,
      initialDatum,
    );
    const stagingUtxo = scriptUtxo(
      "bb".repeat(32),
      cnightTwoStage.Script,
      STAGING_TOKEN_HEX,
      initialDatum,
    );
    emulator.addUtxo(mainUtxo);
    emulator.addUtxo(stagingUtxo);

    const twoStageAddress = addressFromValidator(
      NetworkId.Testnet,
      cnightTwoStage.Script,
    );
    const proxyPolicyId = PolicyId(mintingProxy.Script.hash());
    const assetName = AssetName("00");
    const redeemer = PlutusData.newInteger(0n);

    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxos = ["f0", "f1", "f2", "f3"].map((id) =>
        feeUtxo(addr, id.repeat(32)),
      );
      fundingUtxos.forEach((utxo) => emulator.addUtxo(utxo));

      const mintTx = (
        funding: TransactionUnspentOutput,
        twoStageMain: TransactionUnspentOutput,
        logic: Script,
      ) =>
        blaze
          .newTransaction()
          .addInput(funding)
          .addReferenceInput(twoStageMain)
          .addMint(proxyPolicyId, new Map([[assetName, 1n]]), redeemer)
          .provideScript(mintingProxy.Script)
          .addWithdrawal(foreverRewardAccount, 0n, redeemer)
          .provideScript(cnightForever.Script)
          .addWithdrawal(rewardAccount(logic), 0n, redeemer)
          .provideScript(logic);

      // Withdraw[0] is the always-false logic: its hash sorts before the forever's.
      await emulator.expectScriptFailure(
        mintTx(fundingUtxos[0], mainUtxo, cnightLogic.Script),
        /failed script execution\s+Withdraw\[0\]/,
      );

      // Staging threshold: tech auth 1/2, council 0/1.
      const threshold: Contracts.MultisigThreshold = [1n, 2n, 0n, 1n];
      const forevers = authorityForevers(
        councilForever.Script,
        techAuthForever.Script,
      );
      const stagingThresholdUtxo = thresholdUtxo(
        "e3".repeat(32),
        stagingGovThreshold.Script,
        threshold,
      );
      // Council main names mainGovAuth, so staging_gov_auth applies the staging threshold.
      const councilMainUtxo = scriptUtxo(
        "d1".repeat(32),
        councilTwoStage.Script,
        MAIN_TOKEN_HEX,
        upgradeState(councilForever.Script.hash(), mainGovAuth.Script.hash()),
      );
      for (const utxo of [
        ...Object.values(forevers),
        stagingThresholdUtxo,
        councilMainUtxo,
      ])
        emulator.addUtxo(utxo);

      const authority: GovernanceAuthority = {
        govAuth: stagingGovAuth.Script,
        thresholdUtxo: stagingThresholdUtxo,
        ...forevers,
        techAuthSigners,
        councilSigners,
        requirements: requirementsOf(
          { techAuthSigners, councilSigners },
          threshold,
        ),
        councilMainUtxo: Option.some(councilMainUtxo),
      };
      const params = {
        field: "Logic" as const,
        networkId: NetworkId.Testnet,
        changeAddress: addr,
        feePadding: 0n,
      };

      await emulator.expectValidTransaction(
        blaze,
        Either.getOrThrow(
          buildStageUpgradeTx(
            blaze,
            {
              target: {
                twoStage: cnightTwoStage.Script,
                mainUtxo,
                stagingUtxo,
                scriptRef: Option.none(),
              },
              authority,
              userUtxo: fundingUtxos[1],
            },
            { ...params, newHash: alwaysTrueLogic.Script.hash() },
          ),
        ),
      );

      const staged = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(twoStageAddress),
        cnightTwoStage.Script.hash(),
        STAGING_TOKEN_HEX,
      );
      await emulator.expectValidTransaction(
        blaze,
        Either.getOrThrow(
          buildPromoteUpgradeTx(
            blaze,
            {
              target: {
                twoStage: cnightTwoStage.Script,
                mainUtxo,
                stagingUtxo: staged,
                scriptRef: Option.none(),
              },
              authority,
              userUtxo: fundingUtxos[2],
            },
            { ...params, registerLogic: Option.none() },
          ),
        ),
      );

      const promoted = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(twoStageAddress),
        cnightTwoStage.Script.hash(),
        MAIN_TOKEN_HEX,
      );
      await emulator.expectValidTransaction(
        blaze,
        mintTx(fundingUtxos[3], promoted, alwaysTrueLogic.Script),
      );
    });
  });
});
