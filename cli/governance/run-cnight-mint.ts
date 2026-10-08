/**
 * run-cnight-mint-mainnet: withdraw zero from the cNIGHT mint forever and
 * from the logic (and mitigation logic) that its two-stage main state
 * names, with that UTxO as reference input. The program resolves the UTxO
 * and the scripts and checks their reward accounts; buildRunCnightMintTx is
 * pure over them.
 */
import {
  type Address,
  type NetworkId,
  PlutusData,
  type Script,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Option } from "effect";
import { environmentOf } from "../config/network-mapping";
import {
  contractUtxos,
  deployerUtxo,
  ensureRegistered,
  upgradeScripts,
  upgradeStateAt,
} from "../chain/governance-provider";
import {
  createRewardAccount,
  createTxMetadata,
  DEPLOYER_ONLY,
  signAndWrite,
  UNSIGNED,
  withdrawThroughLogic,
} from "../chain/transaction";
import { Output } from "../output";
import { buildTx } from "../chain/complete-tx";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { Blueprint } from "../contracts/contracts";
import { Provider } from "../chain/provider";

const COMMAND = "run-cnight-mint-mainnet";

/** A cNIGHT mint run: its fee UTxO and where the file goes. */
export type RunCnightMintInput = TxFileInput & FeeInput;

/** What the run references and withdraws through, resolved from the chain and the blueprint. */
export interface RunCnightMintInputs {
  readonly forever: Script;
  readonly twoStageMainUtxo: TransactionUnspentOutput;
  readonly userUtxo: TransactionUnspentOutput;
  readonly logicScript: Script;
  readonly mitigationLogicScript: Option.Option<Script>;
}

export interface RunCnightMintParams {
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
}

/** Zero withdrawals from the forever, the logic and, when set, the mitigation logic, each with the redeemer 0. */
export const buildRunCnightMintTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: RunCnightMintInputs,
  params: RunCnightMintParams,
): TxBuilder => {
  const redeemer = PlutusData.newInteger(0n);
  return withdrawThroughLogic(
    blaze
      .newTransaction()
      .addInput(inputs.userUtxo)
      .addReferenceInput(inputs.twoStageMainUtxo)
      .addWithdrawal(
        createRewardAccount(inputs.forever.hash(), params.networkId),
        0n,
        redeemer,
      )
      .provideScript(inputs.forever),
    inputs.logicScript,
    inputs.mitigationLogicScript,
    redeemer,
    params.networkId,
  )
    .setChangeAddress(params.changeAddress)
    .setMetadata(createTxMetadata(COMMAND))
    .setFeePadding(params.feePadding);
};

/** Build (never submit) the cNIGHT mint run, and write it to a file. */
export const runCnightMintProgram = (input: RunCnightMintInput) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex } = input;
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);
    const { networkId } = environmentOf(network);

    yield* out.log(`\nRunning cNIGHT mint withdrawals on ${network} network`);
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { twoStage, forever, logic } =
      yield* blueprint.twoStage("cnight-minting");
    const found = yield* contractUtxos(
      { twoStage: twoStage.Script },
      networkId,
    );
    const twoStageMainUtxo = yield* found.main("twoStage");
    yield* out.log("\nFound cNIGHT minting two-stage main UTxO");

    const { logicHash, mitigationLogicHash } =
      yield* upgradeStateAt(twoStageMainUtxo);
    yield* out.log(`  Logic hash: ${logicHash}`);
    yield* out.log(
      `  Mitigation logic hash: ${mitigationLogicHash || "(empty)"}`,
    );
    const { logic: logicScript, mitigationLogic: mitigationLogicScript } =
      yield* upgradeScripts(
        { logicHash, mitigationLogicHash },
        logic.Script.hash(),
      );

    const account = (label: string, script: Script) => ({
      label,
      rewardAccount: createRewardAccount(script.hash(), networkId),
      scriptHash: script.hash(),
    });
    const accounts = [
      account("cNIGHT Mint Forever", forever.Script),
      account("cNIGHT Mint Logic", logicScript),
      ...Option.toArray(mitigationLogicScript).map((script) =>
        account("cNIGHT Mint Mitigation Logic", script),
      ),
    ];
    for (const { label, rewardAccount } of accounts) {
      yield* out.log(`${label} reward account: ${rewardAccount}`);
    }
    yield* ensureRegistered(accounts, network);

    const blaze = yield* provider.blaze;
    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const tx = yield* buildTx(
      buildRunCnightMintTx(
        blaze,
        {
          forever: forever.Script,
          twoStageMainUtxo,
          userUtxo,
          logicScript,
          mitigationLogicScript,
        },
        { networkId, changeAddress, feePadding: input.feePadding },
      ),
      {
        commandName: COMMAND,
        environment: network,
        witnesses: DEPLOYER_ONLY,
        knownUtxos: [twoStageMainUtxo, userUtxo],
      },
    );
    yield* signAndWrite(
      tx,
      outputPath,
      UNSIGNED,
      "Run cNIGHT Mint Mainnet Transaction",
    );
    return tx;
  });
