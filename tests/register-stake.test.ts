/**
 * Stake registration of the gov-auth scripts and the cNIGHT mint logic: the
 * builders submitted on the emulator (the ledger applies the certs, and
 * refuses a credential it already holds); on preview, the registration
 * checks read the chain.
 */
import { describe, expect, test } from "bun:test";
import {
  type Address,
  NetworkId,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type { Emulator } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Layer } from "effect";
import * as Contracts from "../contract_blueprint";
import {
  buildRegisterCnightMintLogicTx,
  buildRegisterGovAuthTx,
  refuseRegistered,
} from "../cli/governance/register-stake";
import { ensureRegistered } from "../cli/chain/governance-provider";
import { createRewardAccount } from "../cli/chain/transaction";
import { Blueprint, BlueprintLive } from "../cli/contracts/contracts";
import {
  expectFailure,
  onPreview,
  PreviewLive,
  runTest,
} from "./helpers/effect";
import {
  asFunded,
  type BlazeOf,
  randomHash,
  registerRewardAccount,
} from "./helpers/fixtures";

const cnightMintLogic = new Contracts.CnightMintingCnightMintLogicElse();
const govAuth = new Contracts.GovAuthMainGovAuthElse();
const stagingGovAuth = new Contracts.GovAuthStagingGovAuthElse();

/** Complete, sign and submit as expectValidTransaction does, without its dump of the transaction when the ledger refuses it. */
const submitted = async (emulator: Emulator, blaze: BlazeOf, tx: TxBuilder) =>
  emulator.submitTransaction(await blaze.signTransaction(await tx.complete()));

/** Each registration: its builder over the funded wallet and the credential it registers. */
const REGISTRATIONS = [
  {
    name: "both gov-auth scripts",
    credential: stagingGovAuth.Script.hash(),
    build: (blaze: BlazeOf) =>
      buildRegisterGovAuthTx(blaze, govAuth.Script, stagingGovAuth.Script),
  },
  {
    name: "the cNIGHT mint logic",
    credential: cnightMintLogic.Script.hash(),
    build: (blaze: BlazeOf, addr: Address, fee: TransactionUnspentOutput) =>
      buildRegisterCnightMintLogicTx(
        blaze,
        { userUtxo: fee, cnightMintLogic: cnightMintLogic.Script },
        { changeAddress: addr, feePadding: 0n },
      ),
  },
];

describe("registration builders submitted on the emulator", () => {
  test.each(REGISTRATIONS)("$name register in one transaction", ({ build }) =>
    asFunded((emulator, blaze, addr, fee) =>
      emulator.expectValidTransaction(blaze, build(blaze, addr, fee)),
    ),
  );

  test.each(REGISTRATIONS)(
    "$name: a credential the ledger already holds is refused",
    ({ build, credential }) =>
      asFunded(async (emulator, blaze, addr, fee) => {
        registerRewardAccount(emulator, credential);
        await expect(
          submitted(emulator, blaze, build(blaze, addr, fee)),
        ).rejects.toThrow(/already registered/);
      }),
  );
});

describe.if(onPreview)("registration checks on preview", () => {
  const layer = Layer.mergeAll(
    PreviewLive,
    BlueprintLive("preview", "deployed"),
  );
  const deployed = (title: "govAuth" | "stagingGovAuth") =>
    runTest(
      layer,
      Effect.flatMap(Blueprint, (b) =>
        Effect.map(b.instances, (c) => c[title].Script),
      ),
    );

  test("refuseRegistered refuses the registered gov-auth credentials", async () => {
    const error = await expectFailure(
      layer,
      refuseRegistered("register-gov-auth", "preview", [
        { label: "Main Gov Auth", script: await deployed("govAuth") },
        { label: "Staging Gov Auth", script: await deployed("stagingGovAuth") },
      ]),
      "PreconditionFailed",
    );
    expect(error.command).toBe("register-gov-auth");
    expect(error.refusal._tag).toBe("AlreadyRegistered");
  }, 30_000);

  test("ensureRegistered is StakeNotRegistered for a credential never registered", async () => {
    const scriptHash = randomHash(28);
    const rewardAccount = createRewardAccount(scriptHash, NetworkId.Testnet);
    const error = await expectFailure(
      layer,
      ensureRegistered(
        [{ label: "Unregistered", rewardAccount, scriptHash }],
        "preview",
      ),
      "StakeNotRegistered",
    );
    expect(error.accounts.map((a) => a.rewardAccount)).toEqual([rewardAccount]);
  }, 30_000);
});
