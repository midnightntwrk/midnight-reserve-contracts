import {
  NetworkId,
  PaymentAddress,
  TransactionId,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
// cnight-minting is not yet in the mainnet deployed blueprint — must use default.
import {
  CnightMintingCnightMintTwoStageUpgradeElse,
  CnightMintingCnightMintLogicElse,
} from "../contract_blueprint";
import { describe, test } from "bun:test";
import { Either, Option } from "effect";
import {
  type GovernanceAuthority,
  withGovernanceAuthority,
  stageUpgradeStep,
} from "../cli/governance/two-stage-upgrade";
import {
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
} from "../cli/chain/governance-provider";
import {
  asFunded,
  councilSigners,
  registerRewardAccount,
  scriptUtxo,
  techAuthSigners,
  upgradeState,
  requirementsOf,
  thresholdUtxo,
  authorityForevers,
} from "./helpers/fixtures";

/**
 * Stage a new Auth script hash across ALL 7 two-stage upgrade contracts
 * in a single transaction, using reference scripts to keep within tx size limits.
 *
 * The 7 contracts: tech-auth, council, reserve, ICS, federated-ops, T&C, cnight-minting.
 *
 * Approach:
 * 1. Deploy each two-stage validator script into a reference script UTxO
 * 2. One stageUpgradeStep per contract: spend its staging UTxO, reference its
 *    main and its reference script
 * 3. One withGovernanceAuthority: staging_gov_auth withdrawal (inline) + tech/council witness minting
 */

/** Seed all 7 two-stage contracts, stage a new auth hash for each, and run the authority as given. */
const stageAllAuth = (
  authorityOf: (authority: GovernanceAuthority) => GovernanceAuthority,
) =>
  asFunded(async (emulator, blaze, addr, fundingUtxo) => {
    const stagingGovAuth = new Contracts.GovAuthStagingGovAuthElse();
    const mainGovAuth = new Contracts.GovAuthMainGovAuthElse();
    const stagingGovThreshold =
      new Contracts.ThresholdsStagingGovThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();

    registerRewardAccount(emulator, stagingGovAuth.Script.hash());

    const actors = [
      {
        name: "tech-auth",
        twoStage: new Contracts.PermissionedTechAuthTwoStageUpgradeElse(),
        logic: new Contracts.PermissionedTechAuthLogicElse(),
      },
      {
        name: "council",
        twoStage: new Contracts.PermissionedCouncilTwoStageUpgradeElse(),
        logic: new Contracts.PermissionedCouncilLogicElse(),
      },
      {
        name: "reserve",
        twoStage: new Contracts.ReserveReserveTwoStageUpgradeElse(),
        logic: new Contracts.ReserveReserveLogicElse(),
      },
      {
        name: "ics",
        twoStage:
          new Contracts.IlliquidCirculationSupplyIcsTwoStageUpgradeElse(),
        logic: new Contracts.IlliquidCirculationSupplyIcsLogicElse(),
      },
      {
        name: "federated-ops",
        twoStage: new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse(),
        logic: new Contracts.PermissionedFederatedOpsLogicElse(),
      },
      {
        name: "terms-and-conditions",
        twoStage:
          new Contracts.TermsAndConditionsTermsAndConditionsTwoStageUpgradeElse(),
        logic: new Contracts.TermsAndConditionsTermsAndConditionsLogicElse(),
      },
      {
        name: "cnight-minting",
        twoStage: new CnightMintingCnightMintTwoStageUpgradeElse(),
        logic: new CnightMintingCnightMintLogicElse(),
      },
    ];

    const newAuthHash = "ab".repeat(28);

    // Staging threshold: tech auth required (1/2), council NOT required (0/1).
    // Council witnesses are still minted to match the real flow, but the 0/1
    // threshold means the validator does not enforce them.
    const thresholdDatum: Contracts.MultisigThreshold = [1n, 2n, 0n, 1n];

    const forevers = authorityForevers(
      councilForever.Script,
      techAuthForever.Script,
    );
    const stagingGovThresholdUtxo = thresholdUtxo(
      "e3".repeat(32),
      stagingGovThreshold.Script,
      thresholdDatum,
    );

    for (const utxo of [...Object.values(forevers), stagingGovThresholdUtxo])
      emulator.addUtxo(utxo);

    const actorData = actors.map((actor, idx) => {
      const idxHex = idx.toString(16);
      // Main names mainGovAuth (as deployed), so auth_is_on_main is false for the council.
      const mainUtxo = scriptUtxo(
        ("a" + idxHex).repeat(32),
        actor.twoStage.Script,
        MAIN_TOKEN_HEX,
        upgradeState(actor.logic.Script.hash(), mainGovAuth.Script.hash()),
      );
      const stagingUtxo = scriptUtxo(
        ("b" + idxHex).repeat(32),
        actor.twoStage.Script,
        STAGING_TOKEN_HEX,
        upgradeState(actor.logic.Script.hash(), stagingGovAuth.Script.hash()),
      );
      // The two-stage script as a reference script at the deployer's address.
      const refScriptUtxo = TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId(("d" + idxHex).repeat(32)) },
        {
          address: PaymentAddress(addr.toBech32()),
          value: { coins: 10_000_000n },
          scriptReference: actor.twoStage.Script.toCore(),
        },
      ]);
      for (const utxo of [mainUtxo, stagingUtxo, refScriptUtxo])
        emulator.addUtxo(utxo);
      return { ...actor, mainUtxo, stagingUtxo, refScriptUtxo };
    });

    const authority: GovernanceAuthority = {
      govAuth: stagingGovAuth.Script,
      thresholdUtxo: stagingGovThresholdUtxo,
      ...forevers,
      techAuthSigners,
      councilSigners,
      requirements: requirementsOf(
        { techAuthSigners, councilSigners },
        thresholdDatum,
      ),
      councilMainUtxo: Option.none(),
    };
    let tx = blaze.newTransaction().addInput(fundingUtxo);
    for (const actor of actorData) {
      tx = Either.getOrThrow(
        stageUpgradeStep(
          tx,
          {
            twoStage: actor.twoStage.Script,
            mainUtxo: actor.mainUtxo,
            stagingUtxo: actor.stagingUtxo,
            scriptRef: Option.some(actor.refScriptUtxo),
          },
          "Auth",
          newAuthHash,
          NetworkId.Testnet,
        ),
      );
    }
    tx = withGovernanceAuthority(tx, authorityOf(authority), NetworkId.Testnet);

    return { emulator, blaze, tx };
  });

describe("Stage Auth across all two-stage contracts in one transaction", () => {
  test("stage new auth hash for all 7 contracts using reference scripts", async () => {
    const { emulator, blaze, tx } = await stageAllAuth(
      (authority) => authority,
    );
    await emulator.expectValidTransaction(blaze, tx);
  });

  test("a tech-auth witness over the council signers is rejected", async () => {
    const { emulator, tx } = await stageAllAuth((authority) => ({
      ...authority,
      techAuthSigners: authority.councilSigners,
    }));
    await emulator.expectScriptFailure(
      tx,
      /Withdraw\[0\][\s\S]*Validator returned false/,
    );
  });
});
