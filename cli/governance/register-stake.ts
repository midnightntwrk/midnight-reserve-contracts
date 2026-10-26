/**
 * Stake registration of the governance scripts. The plans are pure over the
 * resolved scripts (and, for the cNIGHT mint logic, the fee UTxO); the
 * programs resolve them from the blueprint and the chain, refuse a
 * credential the chain already has registered, compile the plan and write the
 * unsigned transaction file.
 */
import type {
  Address,
  Script,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect, Option } from "effect";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { deployerUtxo, deployerWallet } from "../chain/utxo";
import { registrationOnChain } from "../chain/registration";
import { createRewardAccount } from "../tx/scripts";
import type { TxPlan } from "../tx/plan";
import { DEPLOYER_ONLY, signAndWrite, UNSIGNED } from "../signing/signer";
import { Output } from "../output";
import { compile } from "../tx/compile";
import { Blueprint } from "../contracts/contracts";
import {
  type Environment,
  environmentOf,
  slotConfigOf,
} from "../config/network-mapping";
import { BlueprintError, PreconditionFailed } from "../errors";

/** A cNIGHT mint logic registration: its fee UTxO and where the file goes. */
export type RegisterCnightMintLogicInput = TxFileInput & FeeInput;

/** The two scripts register-gov-auth registers. */
export interface GovAuthScripts {
  readonly govAuth: Script;
  readonly stagingGovAuth: Script;
}

/** Register the main and staging gov-auth scripts as stake credentials in one transaction; the wallet supplies the inputs. */
export const planRegisterGovAuth = (scripts: GovAuthScripts): TxPlan => ({
  spends: [],
  references: [],
  scripts: [],
  mints: [],
  outputs: [],
  withdrawals: [],
  registrations: [scripts.govAuth, scripts.stagingGovAuth],
  collateral: [],
  requiredSignatures: 0,
});

export interface RegisterCnightMintLogicInputs {
  readonly userUtxo: TransactionUnspentOutput;
  readonly cnightMintLogic: Script;
}

/** Register the cNIGHT mint logic script as a stake credential, paying from the given UTxO. */
export const planRegisterCnightMintLogic = (
  inputs: RegisterCnightMintLogicInputs,
): TxPlan => ({
  spends: [{ utxo: inputs.userUtxo, redeemer: Option.none() }],
  references: [],
  scripts: [],
  mints: [],
  outputs: [],
  withdrawals: [],
  registrations: [inputs.cnightMintLogic],
  collateral: [],
  requiredSignatures: 0,
});

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

/** Read and report the two gov-auth scripts, and refuse when either credential is already registered. */
export const resolveRegisterGovAuth = (input: TxFileInput) =>
  Effect.gen(function* () {
    const { network } = input;
    const out = yield* Output;
    yield* out.log(`\nRegistering Gov Auth scripts on ${network} network`);

    const contracts = yield* Effect.flatMap(Blueprint, (b) => b.instances);
    const govAuth = contracts.govAuth.Script;
    const stagingGovAuth = contracts.stagingGovAuth.Script;
    yield* out.log(`\nMain Gov Auth script hash: ${govAuth.hash()}`);
    yield* out.log(`Staging Gov Auth script hash: ${stagingGovAuth.hash()}`);
    yield* refuseRegistered("register-gov-auth", network, [
      { label: "Main Gov Auth", script: govAuth },
      { label: "Staging Gov Auth", script: stagingGovAuth },
    ]);
    const scripts: GovAuthScripts = { govAuth, stagingGovAuth };
    return scripts;
  });

/** Resolve, plan, compile and write (never submit) the registration of main and staging gov auth; the wallet's own address takes the change and no fee padding is added. */
export const registerGovAuthProgram = (input: TxFileInput) =>
  Effect.gen(function* () {
    const scripts = yield* resolveRegisterGovAuth(input);
    const wallet = yield* deployerWallet;
    const tx = yield* compile(planRegisterGovAuth(scripts), {
      commandName: "register-gov-auth",
      slotConfig: slotConfigOf(input.network),
      wallet,
      changeAddress: wallet.address,
      feePadding: 0n,
      metadata: Option.none(),
      expectedWitnesses: DEPLOYER_ONLY,
      contracts: yield* Effect.flatMap(Blueprint, (b) => b.contracts),
    });
    yield* signAndWrite(
      tx,
      txFilePath(input),
      UNSIGNED,
      "Register Government Authority Transaction",
    );
    return tx;
  });

/** What the cNIGHT mint logic plan is built from and where its change goes. */
export interface ResolvedRegisterCnightMintLogic {
  readonly inputs: RegisterCnightMintLogicInputs;
  readonly changeAddress: Address;
}

/** Read and report the cNIGHT mint logic script and the fee UTxO, and refuse when the credential is already registered. */
export const resolveRegisterCnightMintLogic = (
  input: RegisterCnightMintLogicInput,
) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex } = input;
    const out = yield* Output;

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

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const resolved: ResolvedRegisterCnightMintLogic = {
      inputs: { userUtxo, cnightMintLogic },
      changeAddress,
    };
    return resolved;
  });

/** Resolve, plan, compile and write (never submit) the registration of the cNIGHT mint logic script. */
export const registerCnightMintLogicProgram = (
  input: RegisterCnightMintLogicInput,
) =>
  Effect.gen(function* () {
    const { inputs, changeAddress } =
      yield* resolveRegisterCnightMintLogic(input);
    const tx = yield* compile(planRegisterCnightMintLogic(inputs), {
      commandName: "register-cnight-mint-logic",
      slotConfig: slotConfigOf(input.network),
      wallet: yield* deployerWallet,
      changeAddress,
      feePadding: input.feePadding,
      metadata: Option.none(),
      expectedWitnesses: DEPLOYER_ONLY,
      contracts: yield* Effect.flatMap(Blueprint, (b) => b.contracts),
    });
    yield* signAndWrite(
      tx,
      txFilePath(input),
      UNSIGNED,
      "Register cNIGHT Mint Logic Transaction",
    );
    return tx;
  });
