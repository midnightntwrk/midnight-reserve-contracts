import {
  addressFromCredential,
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  PolicyId,
  NativeScript,
  NativeScripts,
  NetworkId,
  PaymentAddress,
  PlutusData,
  RewardAccount,
  Script,
  toHex,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import * as Contracts from "../contract_blueprint";
import { describe, expect, test } from "bun:test";

const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));
const STAGING_TOKEN_HEX = toHex(new TextEncoder().encode("staging"));
const TECH_WITNESS_ASSET = toHex(new TextEncoder().encode("tech-auth-witness"));
const COUNCIL_WITNESS_ASSET = toHex(
  new TextEncoder().encode("council-auth-witness"),
);

type UpgradeActors = {
  twoStage: { Script: Script };
  initialDatum: Contracts.UpgradeState;
  mainTx: string;
  stagingTx: string;
};

const addTwoStageState = (emulator: Emulator, actor: UpgradeActors) => {
  const address = addressFromValidator(
    NetworkId.Testnet,
    actor.twoStage.Script,
  );

  const buildUtxo = (txId: string, tokenHex: string) =>
    TransactionUnspentOutput.fromCore([
      {
        index: 0,
        txId: TransactionId(txId),
      },
      {
        address: PaymentAddress(address.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [AssetId(actor.twoStage.Script.hash() + tokenHex), 1n],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, actor.initialDatum).toCore(),
      },
    ]);

  emulator.addUtxo(buildUtxo(actor.mainTx, MAIN_TOKEN_HEX));
  emulator.addUtxo(buildUtxo(actor.stagingTx, STAGING_TOKEN_HEX));
};

const findUtxoByToken = (
  utxos: TransactionUnspentOutput[],
  scriptHash: string,
  tokenHex: string,
) => {
  const target = AssetId(scriptHash + tokenHex);
  const match = utxos.find((utxo) => {
    const [, output] = utxo.toCore();
    const assets = output.value.assets;
    return assets ? (assets.get(target) ?? 0n) === 1n : false;
  });

  if (!match) {
    throw new Error(`Missing ${tokenHex} UTxO for ${scriptHash}`);
  }

  return match;
};

const datumCbor = (datum: PlutusData) => datum.toCbor();

const expectDatum = (
  utxo: TransactionUnspentOutput,
  expected: Contracts.UpgradeState,
) => {
  const [, output] = utxo.toCore();
  if (!output.datum) throw new Error("Missing datum on output");

  const actual = PlutusData.fromCore(output.datum);
  const expectedDatum = serialize(
    Contracts.UpgradeState,
    expected,
  ) as PlutusData;
  expect(datumCbor(actual)).toBe(datumCbor(expectedDatum));
};

const buildNativeScriptFromState = (
  state: Contracts.VersionedMultisig,
  numerator: bigint,
  denominator: bigint,
) => {
  const [totalSigners, signers] = state.data;
  const signerScripts = Object.keys(signers)
    .sort()
    .map((key) => {
      const paymentHash = key.slice("8200581c".length);
      const addr = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.KeyHash,
          hash: Hash28ByteBase16(paymentHash),
        }),
      );
      return NativeScripts.justAddress(addr.toBech32(), NetworkId.Testnet);
    });

  const minSigners = Number(
    (totalSigners * numerator + (denominator - 1n)) / denominator,
  );

  return NativeScripts.atLeastNOfK(minSigners, ...signerScripts);
};

describe("Tech + Council upgrade path", () => {
  test("deploy, stage new logic, then promote to main", async () => {
    const emulator = new Emulator([]);
    const govAuth = new Contracts.GovAuthMainGovAuthElse();
    const mainGovThreshold = new Contracts.ThresholdsMainGovThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();

    const govAuthRewardAccount = RewardAccount.fromCredential(
      Credential.fromCore({
        hash: govAuth.Script.hash(),
        type: CredentialType.ScriptHash,
      }).toCore(),
      NetworkId.Testnet,
    );
    emulator.accounts.set(govAuthRewardAccount, 0n);

    const techActors: UpgradeActors = {
      twoStage: new Contracts.PermissionedTechAuthTwoStageUpgradeElse(),
      initialDatum: [
        new Contracts.PermissionedTechAuthLogicElse().Script.hash(),
        "",
        govAuth.Script.hash(),
        "",
        0n,
      ],
      mainTx: "aa".repeat(32),
      stagingTx: "bb".repeat(32),
    };

    const councilActors: UpgradeActors = {
      twoStage: new Contracts.PermissionedCouncilTwoStageUpgradeElse(),
      initialDatum: [
        new Contracts.PermissionedCouncilLogicElse().Script.hash(),
        "",
        govAuth.Script.hash(),
        "",
        0n,
      ],
      mainTx: "cc".repeat(32),
      stagingTx: "dd".repeat(32),
    };

    await emulator.as("deployer", async (blaze, addr) => {
      const fundingUtxos = Array.from({ length: 4 }).map((_, idx) => {
        const txSuffix = idx.toString(16).padStart(4, "0");
        return TransactionUnspentOutput.fromCore([
          {
            index: idx,
            txId: TransactionId("ff".repeat(30) + txSuffix),
          },
          {
            address: PaymentAddress(addr.toBech32()),
            value: {
              coins: 900_000_000n,
            },
          },
        ]);
      });
      fundingUtxos.forEach((utxo) => emulator.addUtxo(utxo));

      const paymentHash = addr.asBase()?.getPaymentCredential().hash!;
      const stakeHash = addr.asBase()?.getStakeCredential().hash!;

      const techAuthForeverState: Contracts.VersionedMultisig = {
        data: [
          1n,
          {
            ["8200581c" + paymentHash]:
              "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
          },
        ],
        round: 0n,
      };

      const councilForeverState: Contracts.VersionedMultisig = {
        data: [
          1n,
          {
            ["8200581c" + stakeHash]:
              "72679690ACD6B5186F59F5133B57DA6A38084250D13576FC3C780E3443D78D86",
          },
        ],
        round: 0n,
      };

      const thresholdDatum: Contracts.MultisigThreshold = {
        technical_auth_numerator: 1n,
        technical_auth_denominator: 2n,
        council_numerator: 1n,
        council_denominator: 2n,
      };

      const govAuthRedeemerData = serialize(Contracts.PermissionedRedeemer, {
        [paymentHash]:
          "7DCE5A2128D798C2244A52BF12272F4DA78E893F2A7BD63FD08C22A9F3787A2B",
      });

      const techNativeScript = buildNativeScriptFromState(
        techAuthForeverState,
        thresholdDatum.technical_auth_numerator,
        thresholdDatum.technical_auth_denominator,
      );

      const councilNativeScript = buildNativeScriptFromState(
        councilForeverState,
        thresholdDatum.council_numerator,
        thresholdDatum.council_denominator,
      );

      const techWitnessPolicy = techNativeScript.hash();
      const councilWitnessPolicy = councilNativeScript.hash();
      const buildWitnessValue = () =>
        new Map([
          [AssetId(techWitnessPolicy + TECH_WITNESS_ASSET), 1n],
          [AssetId(councilWitnessPolicy + COUNCIL_WITNESS_ASSET), 1n],
        ]);

      const techForeverUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("11".repeat(32)),
        },
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
          datum: serialize(Contracts.VersionedMultisig, techAuthForeverState).toCore(),
        },
      ]);

      const councilForeverUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("22".repeat(32)),
        },
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
          datum: serialize(Contracts.VersionedMultisig, councilForeverState).toCore(),
        },
      ]);

      const mainGovThresholdUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId("33".repeat(32)),
        },
        {
          address: PaymentAddress(
            addressFromValidator(
              NetworkId.Testnet,
              mainGovThreshold.Script,
            ).toBech32(),
          ),
          value: {
            coins: 3_000_000n,
            assets: new Map([[AssetId(mainGovThreshold.Script.hash()), 1n]]),
          },
          datum: serialize(
            Contracts.MultisigThreshold,
            thresholdDatum,
          ).toCore(),
        },
      ]);

      emulator.addUtxo(techForeverUtxo);
      emulator.addUtxo(councilForeverUtxo);
      emulator.addUtxo(mainGovThresholdUtxo);

      addTwoStageState(emulator, techActors);
      addTwoStageState(emulator, councilActors);

      const applyGovernanceWitnesses = (txBuilder: TxBuilder) =>
        txBuilder
          .addMint(
            PolicyId(techWitnessPolicy),
            new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
          )
          .addMint(
            PolicyId(councilWitnessPolicy),
            new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
          )
          .provideScript(Script.newNativeScript(techNativeScript))
          .provideScript(Script.newNativeScript(councilNativeScript));

      const stageUpdate = async (
        actor: UpgradeActors,
        newLogicHash: string,
        fundingUtxo: TransactionUnspentOutput,
      ) => {
        const scriptAddress = addressFromValidator(
          NetworkId.Testnet,
          actor.twoStage.Script,
        );
        const scriptUtxos =
          await blaze.provider.getUnspentOutputs(scriptAddress);

        const mainRef = findUtxoByToken(
          scriptUtxos,
          actor.twoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        );
        const stagingInput = findUtxoByToken(
          scriptUtxos,
          actor.twoStage.Script.hash(),
          STAGING_TOKEN_HEX,
        );

        const [mainInput] = mainRef.toCore();
        const redeemer = serialize(Contracts.TwoStageRedeemer, {
          update_field: "Logic",
          which_stage: {
            Staging: [
              {
                transaction_id: mainInput.txId.toString(),
                output_index: BigInt(mainInput.index),
              },
              newLogicHash,
            ],
          },
        });

        const tx = applyGovernanceWitnesses(
          blaze
            .newTransaction()
            .addInput(stagingInput, redeemer)
            .addInput(fundingUtxo)
            .addReferenceInput(mainRef)
            .addReferenceInput(mainGovThresholdUtxo)
            .addReferenceInput(techForeverUtxo)
            .addReferenceInput(councilForeverUtxo)
            .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
            .provideScript(actor.twoStage.Script)
            .provideScript(govAuth.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(scriptAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(actor.twoStage.Script.hash() + STAGING_TOKEN_HEX),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, [
                  newLogicHash,
                  "",
                  govAuth.Script.hash(),
                  "",
                  1n,
                ]).toCore(),
              }),
            ),
        );

        await emulator.expectValidTransaction(blaze, tx);
      };

      const promoteMain = async (
        actor: UpgradeActors,
        stagedHash: string,
        fundingUtxo: TransactionUnspentOutput,
      ) => {
        const scriptAddress = addressFromValidator(
          NetworkId.Testnet,
          actor.twoStage.Script,
        );
        const scriptUtxos =
          await blaze.provider.getUnspentOutputs(scriptAddress);

        const mainInput = findUtxoByToken(
          scriptUtxos,
          actor.twoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        );
        const stagingRef = findUtxoByToken(
          scriptUtxos,
          actor.twoStage.Script.hash(),
          STAGING_TOKEN_HEX,
        );
        const [stagingInput] = stagingRef.toCore();

        const redeemer = serialize(Contracts.TwoStageRedeemer, {
          update_field: "Logic",
          which_stage: {
            Main: [
              {
                transaction_id: stagingInput.txId.toString(),
                output_index: BigInt(stagingInput.index),
              },
            ],
          },
        });

        const tx = applyGovernanceWitnesses(
          blaze
            .newTransaction()
            .addInput(mainInput, redeemer)
            .addInput(fundingUtxo)
            .addReferenceInput(stagingRef)
            .addReferenceInput(mainGovThresholdUtxo)
            .addReferenceInput(techForeverUtxo)
            .addReferenceInput(councilForeverUtxo)
            .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
            .provideScript(actor.twoStage.Script)
            .provideScript(govAuth.Script)
            .addOutput(
              TransactionOutput.fromCore({
                address: PaymentAddress(scriptAddress.toBech32()),
                value: {
                  coins: 2_000_000n,
                  assets: new Map([
                    [
                      AssetId(actor.twoStage.Script.hash() + MAIN_TOKEN_HEX),
                      1n,
                    ],
                  ]),
                },
                datum: serialize(Contracts.UpgradeState, [
                  stagedHash,
                  "",
                  govAuth.Script.hash(),
                  "",
                  1n,
                ]).toCore(),
              }),
            ),
        );

        await emulator.expectValidTransaction(blaze, tx);
      };

      const techStagedHash = "11".repeat(28);
      const councilStagedHash = "22".repeat(28);

      await stageUpdate(techActors, techStagedHash, fundingUtxos[0]);
      await stageUpdate(councilActors, councilStagedHash, fundingUtxos[1]);
      await promoteMain(techActors, techStagedHash, fundingUtxos[2]);
      await promoteMain(councilActors, councilStagedHash, fundingUtxos[3]);

      const techUtxos = await blaze.provider.getUnspentOutputs(
        addressFromValidator(NetworkId.Testnet, techActors.twoStage.Script),
      );
      const councilUtxos = await blaze.provider.getUnspentOutputs(
        addressFromValidator(NetworkId.Testnet, councilActors.twoStage.Script),
      );

      expectDatum(
        findUtxoByToken(
          techUtxos,
          techActors.twoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        ),
        [techStagedHash, "", govAuth.Script.hash(), "", 1n],
      );

      expectDatum(
        findUtxoByToken(
          councilUtxos,
          councilActors.twoStage.Script.hash(),
          MAIN_TOKEN_HEX,
        ),
        [councilStagedHash, "", govAuth.Script.hash(), "", 1n],
      );
    });
  });
});
