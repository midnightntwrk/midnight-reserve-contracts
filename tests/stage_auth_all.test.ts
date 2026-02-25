import {
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  NetworkId,
  PaymentAddress,
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
// cnight-minting is not yet in the mainnet deployed blueprint — must use default.
import {
  CnightMintingCnightMintTwoStageUpgradeElse,
  CnightMintingCnightMintLogicElse,
} from "../contract_blueprint";
import { describe, test } from "bun:test";
import {
  buildNativeScriptFromState,
  COUNCIL_WITNESS_ASSET,
  expectDatum,
  findUtxoByToken,
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
  TECH_WITNESS_ASSET,
} from "./helpers/upgrade";

/**
 * Stage a new Auth script hash across ALL 7 two-stage upgrade contracts
 * in a single transaction, using reference scripts to keep within tx size limits.
 *
 * The 7 contracts: tech-auth, council, reserve, ICS, federated-ops, T&C, cnight-minting.
 *
 * Approach:
 * 1. Deploy each two-stage validator script into a reference script UTxO
 * 2. Spend all 7 staging UTxOs with TwoStageRedeemer [Auth, Staging(mainOutRef, newAuthHash)]
 * 3. Reference the main UTxOs + reference script UTxOs + shared infrastructure
 * 4. Use staging_gov_auth withdrawal (inline) + tech/council witness minting
 */
describe("Stage Auth across all two-stage contracts in one transaction", () => {
  test("stage new auth hash for all 7 contracts using reference scripts", async () => {
    const emulator = new Emulator([]);

    // Shared governance contracts
    const stagingGovAuth = new Contracts.GovAuthStagingGovAuthElse();
    const mainGovAuth = new Contracts.GovAuthMainGovAuthElse();
    const stagingGovThreshold =
      new Contracts.ThresholdsStagingGovThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();

    // Register staging gov auth reward account
    const govAuthRewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: stagingGovAuth.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(govAuthRewardAccount, { balance: 0n });

    // All 7 two-stage actors
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

    // The new auth script hash to stage across all contracts
    const newAuthHash = "ab".repeat(28);

    await emulator.as("deployer", async (blaze, addr) => {
      // Funding UTxO
      const fundingUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("ff".repeat(32)),
        },
        {
          address: PaymentAddress(addr.toBech32()),
          value: { coins: 900_000_000n },
        },
      ]);
      emulator.addUtxo(fundingUtxo);

      const paymentHash = addr.asBase()?.getPaymentCredential().hash!;
      const stakeHash = addr.asBase()?.getStakeCredential().hash!;

      // VersionedMultisig state for tech auth and council forever UTxOs
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

      // Staging threshold: tech auth required (1/2), council NOT required (0/1).
      // Council witnesses are still minted to match the real flow, but the 0/1
      // threshold means the validator does not enforce them.
      const thresholdDatum: Contracts.MultisigThreshold = [1n, 2n, 0n, 1n];

      const govAuthRedeemerData = serialize(Contracts.PermissionedRedeemer, {
        [paymentHash]:
          "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
      });

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

      const techWitnessPolicy = techNativeScript.hash();
      const councilWitnessPolicy = councilNativeScript.hash();

      // --- Shared reference inputs ---

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

      emulator.addUtxo(techForeverUtxo);
      emulator.addUtxo(councilForeverUtxo);
      emulator.addUtxo(stagingGovThresholdUtxo);

      // --- Per-actor UTxOs: main, staging, and reference script ---

      // TX ID scheme:
      //   main UTxO:    "a0", "a1", "a2", ... (one per actor)
      //   staging UTxO: "b0", "b1", "b2", ...
      //   ref script:   "c0", "c1", "c2", ...
      const actorData = actors.map((actor, idx) => {
        const idxHex = idx.toString(16);
        const twoStageAddress = addressFromValidator(
          NetworkId.Testnet,
          actor.twoStage.Script,
        );

        // For the council main datum: use mainGovAuth so auth_is_on_main returns FALSE
        // For all others: also use mainGovAuth on main (matches real deployment)
        const mainDatum: Contracts.UpgradeState = [
          actor.logic.Script.hash(),
          "",
          mainGovAuth.Script.hash(),
          "",
          0n,
          0n,
        ];

        // Staging datums use stagingGovAuth (the withdrawal we'll provide)
        const stagingDatum: Contracts.UpgradeState = [
          actor.logic.Script.hash(),
          "",
          stagingGovAuth.Script.hash(),
          "",
          0n,
          0n,
        ];

        const mainTxId = ("a" + idxHex).padEnd(2, "0").repeat(32);
        const stagingTxId = ("b" + idxHex).padEnd(2, "0").repeat(32);
        const refScriptTxId = ("c" + idxHex).padEnd(2, "0").repeat(32);

        const mainUtxo = TransactionUnspentOutput.fromCore([
          { index: 0, txId: TransactionId(mainTxId) },
          {
            address: PaymentAddress(twoStageAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [AssetId(actor.twoStage.Script.hash() + MAIN_TOKEN_HEX), 1n],
              ]),
            },
            datum: serialize(Contracts.UpgradeState, mainDatum).toCore(),
          },
        ]);

        const stagingUtxo = TransactionUnspentOutput.fromCore([
          { index: 0, txId: TransactionId(stagingTxId) },
          {
            address: PaymentAddress(twoStageAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([
                [AssetId(actor.twoStage.Script.hash() + STAGING_TOKEN_HEX), 1n],
              ]),
            },
            datum: serialize(Contracts.UpgradeState, stagingDatum).toCore(),
          },
        ]);

        // Reference script UTxO: holds the two-stage validator script
        // Address is the deployer's — it just needs to exist as a reference input
        const refScriptUtxo = TransactionUnspentOutput.fromCore([
          { index: 0, txId: TransactionId(refScriptTxId) },
          {
            address: PaymentAddress(addr.toBech32()),
            value: { coins: 10_000_000n },
            scriptReference: actor.twoStage.Script.toCore(),
          },
        ]);

        emulator.addUtxo(mainUtxo);
        emulator.addUtxo(stagingUtxo);
        emulator.addUtxo(refScriptUtxo);

        return {
          ...actor,
          twoStageAddress,
          mainDatum,
          stagingDatum,
          mainUtxo,
          stagingUtxo,
          refScriptUtxo,
        };
      });

      // --- Build the single transaction that stages Auth for all 7 contracts ---

      let tx = blaze.newTransaction().addInput(fundingUtxo);

      // Add shared reference inputs
      tx = tx
        .addReferenceInput(stagingGovThresholdUtxo)
        .addReferenceInput(techForeverUtxo)
        .addReferenceInput(councilForeverUtxo);

      // For each actor: spend staging, reference main + ref script, add output
      for (const actor of actorData) {
        const [mainInput] = actor.mainUtxo.toCore();

        const redeemer = serialize(Contracts.TwoStageRedeemer, [
          "Auth",
          {
            Staging: [
              {
                transaction_id: mainInput.txId.toString(),
                output_index: BigInt(mainInput.index),
              },
              newAuthHash,
            ],
          },
        ]);

        // Expected output datum: auth updated, round incremented
        const newStagingDatum: Contracts.UpgradeState = [
          actor.stagingDatum[0], // logic unchanged
          actor.stagingDatum[1], // mitigation_logic unchanged
          newAuthHash, // auth → new value
          actor.stagingDatum[3], // mitigation_auth unchanged
          actor.stagingDatum[4] + 1n, // round incremented
          actor.stagingDatum[5], // logic_round unchanged
        ];

        tx = tx
          .addInput(actor.stagingUtxo, redeemer)
          .addReferenceInput(actor.mainUtxo)
          .addReferenceInput(actor.refScriptUtxo)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(actor.twoStageAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(actor.twoStage.Script.hash() + STAGING_TOKEN_HEX),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                newStagingDatum,
              ).toCore(),
            }),
          );
      }

      // Governance auth withdrawal + witness minting (inline scripts)
      tx = tx
        .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
        .provideScript(stagingGovAuth.Script)
        .addMint(
          PolicyId(techWitnessPolicy),
          new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
        )
        .provideScript(Script.newNativeScript(techNativeScript))
        .addMint(
          PolicyId(councilWitnessPolicy),
          new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
        )
        .provideScript(Script.newNativeScript(councilNativeScript));

      await emulator.expectValidTransaction(blaze, tx);

      // Verify all 7 staging UTxOs were updated correctly
      for (const actor of actorData) {
        const utxos = await blaze.provider.getUnspentOutputs(
          actor.twoStageAddress,
        );
        const stagingOutput = findUtxoByToken(
          utxos,
          actor.twoStage.Script.hash(),
          STAGING_TOKEN_HEX,
        );

        expectDatum(stagingOutput, [
          actor.stagingDatum[0], // logic unchanged
          actor.stagingDatum[1], // mitigation_logic unchanged
          newAuthHash, // auth → new value
          actor.stagingDatum[3], // mitigation_auth unchanged
          actor.stagingDatum[4] + 1n, // round incremented
          actor.stagingDatum[5], // logic_round unchanged
        ]);
      }
    });
  });
});
