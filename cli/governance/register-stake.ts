/**
 * Stake registration of the governance scripts. Both builders are pure over
 * the resolved scripts (and, for the cNIGHT mint logic, the fee UTxO); the
 * programs resolve them from the blueprint and the chain, refuse a
 * credential the chain already has registered, and write the unsigned
 * transaction file.
 */
import type {
  Address,
  Script,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Option } from "effect";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import {
  deployerUtxo,
  registrationOnChain,
} from "../chain/governance-provider";
import {
  createRewardAccount,
  registerScriptStake,
  signAndWrite,
  UNSIGNED,
  DEPLOYER_ONLY,
} from "../chain/transaction";
import { Output } from "../output";
import { buildTx } from "../chain/complete-tx";
import { Blueprint } from "../contracts/contracts";
import { Provider } from "../chain/provider";
import { type Environment, environmentOf } from "../config/network-mapping";
import { BlueprintError, PreconditionFailed } from "../errors";

/** A cNIGHT mint logic registration: its fee UTxO and where the file goes. */
export type RegisterCnightMintLogicInput = TxFileInput & FeeInput;

/** Register the main and staging gov-auth scripts as stake credentials in one transaction. */
export const buildRegisterGovAuthTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  govAuth: Script,
  stagingGovAuth: Script,
): TxBuilder =>
  registerScriptStake(
    registerScriptStake(blaze.newTransaction(), govAuth),
    stagingGovAuth,
  );

export interface RegisterCnightMintLogicInputs {
  readonly userUtxo: TransactionUnspentOutput;
  readonly cnightMintLogic: Script;
}

export interface RegisterCnightMintLogicParams {
  readonly changeAddress: Address;
  readonly feePadding: bigint;
}

/** Register the cNIGHT mint logic script as a stake credential, paying from the given UTxO. */
export const buildRegisterCnightMintLogicTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: RegisterCnightMintLogicInputs,
  params: RegisterCnightMintLogicParams,
): TxBuilder =>
  registerScriptStake(
    blaze.newTransaction().addInput(inputs.userUtxo),
    inputs.cnightMintLogic,
  )
    .setChangeAddress(params.changeAddress)
    .setFeePadding(params.feePadding);

/** Fail when a script's stake credential is already registered on chain; local and emulator cannot tell, and build. */
export const refuseRegistered = (
  command: string,
  environment: Environment,
  scripts: readonly { readonly label: string; readonly script: Script }[],
) =>
  Effect.gen(function* () {
    const { networkId } = environmentOf(environment);
    const registered = yield* Effect.filter(
      scripts,
      ({ script }) =>
        Effect.map(
          registrationOnChain(
            createRewardAccount(script.hash(), networkId),
            environment,
          ),
          Option.getOrElse(() => false),
        ),
      { concurrency: "unbounded" },
    );
    if (registered.length > 0) {
      return yield* new PreconditionFailed({
        command,
        refusal: {
          _tag: "AlreadyRegistered",
          environment,
          scripts: registered.map(({ label, script }) => ({
            label,
            scriptHash: script.hash(),
          })),
        },
      });
    }
  });

/** Build (never submit) the registration of main and staging gov auth, and write it to a file. */
export const registerGovAuthProgram = (input: TxFileInput) =>
  Effect.gen(function* () {
    const { network } = input;
    const out = yield* Output;
    const outputPath = txFilePath(input);
    yield* out.log(`\nRegistering Gov Auth scripts on ${network} network`);

    // govAuth/stagingGovAuth are audited immutable contracts: same hash in build and deployed
    const contracts = yield* Effect.flatMap(Blueprint, (b) => b.instances);
    const govAuth = contracts.govAuth.Script;
    const stagingGovAuth = contracts.stagingGovAuth.Script;
    yield* out.log(`\nMain Gov Auth script hash: ${govAuth.hash()}`);
    yield* out.log(`Staging Gov Auth script hash: ${stagingGovAuth.hash()}`);
    yield* refuseRegistered("register-gov-auth", network, [
      { label: "Main Gov Auth", script: govAuth },
      { label: "Staging Gov Auth", script: stagingGovAuth },
    ]);

    const blaze = yield* Effect.flatMap(Provider, (p) => p.blaze);
    const tx = yield* buildTx(
      buildRegisterGovAuthTx(blaze, govAuth, stagingGovAuth),
      {
        commandName: "register-gov-auth",
        witnesses: DEPLOYER_ONLY,
      },
    );
    yield* signAndWrite(
      tx,
      outputPath,
      UNSIGNED,
      "Register Government Authority Transaction",
    );
    return tx;
  });

/** Build (never submit) the registration of the cNIGHT mint logic script, and write it to a file. */
export const registerCnightMintLogicProgram = (
  input: RegisterCnightMintLogicInput,
) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex } = input;
    const out = yield* Output;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);

    yield* out.log(
      `\nRegistering cNIGHT mint logic script on ${network} network`,
    );
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

    const blueprint = yield* Blueprint;
    const contracts = yield* blueprint.instances;
    if (!contracts.cnightMintLogic) {
      return yield* new BlueprintError({
        environment: network,
        source: blueprint.source,
        reason:
          "cNIGHT mint logic contract not found in the blueprint" +
          (blueprint.source === "build"
            ? `; run 'just build ${environmentOf(network).aikenConfigSection}' first`
            : "; pass --use-build if it is only in the build output"),
      });
    }
    const cnightMintLogic = contracts.cnightMintLogic.Script;
    yield* out.log(
      `\ncNIGHT mint logic script hash: ${cnightMintLogic.hash()}`,
    );
    yield* refuseRegistered("register-cnight-mint-logic", network, [
      { label: "cNIGHT mint logic", script: cnightMintLogic },
    ]);

    const blaze = yield* provider.blaze;
    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );

    const tx = yield* buildTx(
      buildRegisterCnightMintLogicTx(
        blaze,
        { userUtxo, cnightMintLogic },
        { changeAddress, feePadding: input.feePadding },
      ),
      {
        commandName: "register-cnight-mint-logic",
        witnesses: DEPLOYER_ONLY,
        knownUtxos: [userUtxo],
      },
    );
    yield* signAndWrite(
      tx,
      outputPath,
      UNSIGNED,
      "Register cNIGHT Mint Logic Transaction",
    );
    return tx;
  });
