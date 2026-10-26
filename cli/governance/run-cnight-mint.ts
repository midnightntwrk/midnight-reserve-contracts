/**
 * run-cnight-mint-mainnet: withdraw zero from the cNIGHT mint forever and
 * from the logic (and mitigation logic) that its two-stage main state
 * names, with that UTxO as reference input. The program resolves the UTxO
 * and the scripts and checks their reward accounts; planRunCnightMint is
 * pure over them and compile completes it.
 */
import {
  type Address,
  type NetworkId,
  PlutusData,
  type Script,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect, Option } from "effect";
import { environmentOf, slotConfigOf } from "../config/network-mapping";
import { contractUtxos, deployerUtxo, deployerWallet } from "../chain/utxo";
import { ensureRegistered } from "../chain/registration";
import { upgradeScripts, upgradeStateAt } from "./two-stage";
import { createRewardAccount, withdrawThroughLogic } from "../tx/scripts";
import type { TxPlan } from "../tx/plan";
import { DEPLOYER_ONLY, signAndWrite, UNSIGNED } from "../signing/signer";
import { Output } from "../output";
import { compile } from "../tx/compile";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { Blueprint } from "../contracts/contracts";

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
}

/** Zero withdrawals from the forever, the logic and, when set, the mitigation logic, each with the redeemer 0. */
export const planRunCnightMint = (
  inputs: RunCnightMintInputs,
  params: RunCnightMintParams,
): TxPlan => {
  const redeemer = PlutusData.newInteger(0n);
  return {
    spends: [{ utxo: inputs.userUtxo, redeemer: Option.none() }],
    references: [inputs.twoStageMainUtxo],
    scripts: [],
    mints: [],
    outputs: [],
    withdrawals: [
      {
        rewardAccount: createRewardAccount(
          inputs.forever.hash(),
          params.networkId,
        ),
        script: inputs.forever,
        redeemer,
      },
      ...withdrawThroughLogic(
        inputs.logicScript,
        inputs.mitigationLogicScript,
        redeemer,
        params.networkId,
      ),
    ],
    registrations: [],
    collateral: [],
    requiredSignatures: 0,
  };
};

/** What the run plan is built from and where its change goes. */
export interface ResolvedRunCnightMint {
  readonly inputs: RunCnightMintInputs;
  readonly params: RunCnightMintParams;
  readonly changeAddress: Address;
}

/** Read and report everything the run needs: the two-stage main UTxO, the logic scripts it names, their registered reward accounts and the fee UTxO. */
export const resolveRunCnightMint = (input: RunCnightMintInput) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex } = input;
    const out = yield* Output;
    const blueprint = yield* Blueprint;
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

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const resolved: ResolvedRunCnightMint = {
      inputs: {
        forever: forever.Script,
        twoStageMainUtxo,
        userUtxo,
        logicScript,
        mitigationLogicScript,
      },
      params: { networkId },
      changeAddress,
    };
    return resolved;
  });

/** Resolve, plan, compile (never submit) and write the cNIGHT mint run. */
export const runCnightMintProgram = (input: RunCnightMintInput) =>
  Effect.gen(function* () {
    const { inputs, params, changeAddress } =
      yield* resolveRunCnightMint(input);
    const tx = yield* compile(planRunCnightMint(inputs, params), {
      commandName: COMMAND,
      slotConfig: slotConfigOf(input.network),
      wallet: yield* deployerWallet,
      changeAddress,
      feePadding: input.feePadding,
      metadata: Option.some(COMMAND),
      expectedWitnesses: DEPLOYER_ONLY,
      contracts: yield* Effect.flatMap(Blueprint, (b) => b.contracts),
    });
    yield* signAndWrite(
      tx,
      txFilePath(input),
      UNSIGNED,
      "Run cNIGHT Mint Mainnet Transaction",
    );
    return tx;
  });
