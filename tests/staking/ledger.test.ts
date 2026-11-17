/**
 * Ledger-level oracle for night_registration and night_staking (user decision 11-17: the
 * withdrawal checks everything). The agreement tests evaluate built ScriptContexts; this test
 * submits the transactions to the Blaze emulator, so the ledger's reward-account rules apply:
 * each script's stake credential is registered first, and every transaction withdraws 0 from it
 * with the action as its redeemer. The negative cases stop at build time, where Blaze runs the
 * scripts, and check which purpose fails and with what trace.
 */
import {
  addressFromCredential,
  addressFromValidator,
  AssetId,
  AssetName,
  Certificate,
  CertificateType,
  ConstrPlutusData,
  Credential,
  CredentialType,
  Ed25519KeyHashHex,
  Hash28ByteBase16,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PlutusList,
  PolicyId,
  PoolId,
  RewardAccount,
  Script,
  Slot,
  TransactionId,
  TransactionBody,
  TransactionOutput,
  TransactionUnspentOutput,
  toHex,
} from "@blaze-cardano/core";
import { Emulator } from "@blaze-cardano/emulator";
import type { Blaze, Provider, Wallet } from "@blaze-cardano/sdk";
import { describe, expect, test } from "vite-plus/test";
import * as Contracts from "../../contract_blueprint_default";
import { lockDatum, nodeDatum } from "./plutus";
import type { DelegationLock, Node, Registration } from "./reference";

// aiken.toml [config.default].
const ONE_SHOT_TX = "00".repeat(30) + "0a11";
const UNBONDING_DELAY_MS = 1_728_000_000;

const registration = new Contracts.NightRegistrationNightRegistrationElse()
  .Script;
const staking = new Contracts.NightStakingNightStakingElse().Script;
const tcnight = new Contracts.TestCnightNoAuditTcnightMintInfiniteElse().Script;
const NIGHT_NAME = toHex(new TextEncoder().encode("NIGHT"));
const NIGHT = AssetId(tcnight.hash() + NIGHT_NAME);

const constr = (index: bigint, fields: PlutusData[] = []) => {
  const list = new PlutusList();
  for (const field of fields) list.add(field);
  return PlutusData.newConstrPlutusData(new ConstrPlutusData(index, list));
};

// RegistrationAction and StakingAction, in the order the Aiken types declare them.
const [INIT, , CREATE_ONE_ANCHOR, UPDATE, DEACTIVATE] = [
  0n,
  1n,
  2n,
  3n,
  4n,
].map((i) => constr(i));
const [LOCK, , UNBOND, UNLOCK] = [0n, 1n, 2n, 3n].map((i) => constr(i));
/** A redeemer the gates and the always-true scripts do not read. */
const ANY = constr(0n);

const scriptCredential = (script: Script) =>
  Credential.fromCore({
    hash: Hash28ByteBase16(script.hash()),
    type: CredentialType.ScriptHash,
  });

const rewardAccount = (script: Script) =>
  RewardAccount.fromCredential(
    scriptCredential(script).toCore(),
    NetworkId.Testnet,
  );

const scriptAddress = (script: Script) =>
  PaymentAddress(addressFromValidator(NetworkId.Testnet, script).toBech32());

const nodeOutput = (lovelace: bigint, node: Node) =>
  TransactionOutput.fromCore({
    address: scriptAddress(registration),
    value: {
      coins: lovelace,
      assets: new Map([[AssetId(registration.hash()), 1n]]),
    },
    datum: nodeDatum(node),
  });

/** The UTxO at `script`'s address whose inline datum is `datum`. */
const utxoWithDatum = async (
  blaze: Blaze<Provider, Wallet>,
  script: Script,
  datum: PlutusData,
) => {
  const utxos = await blaze.provider.getUnspentOutputs(
    addressFromValidator(NetworkId.Testnet, script),
  );
  const found = utxos.filter(
    (u) => u.output().datum()?.asInlineData()?.toCbor() === datum.toCbor(),
  );
  expect(found).toHaveLength(1);
  return found[0];
};

/** Registers the script's stake credential: night_registration and night_staking accept it. */
const registerCredential = async (
  emulator: Emulator,
  blaze: Blaze<Provider, Wallet>,
  script: Script,
) => {
  await emulator.expectValidTransaction(
    blaze,
    blaze
      .newTransaction()
      .addRegisterStake(scriptCredential(script), ANY)
      .provideScript(script),
  );
  expect(emulator.accounts.has(rewardAccount(script))).toBe(true);
};

/**
 * Blaze's error for the first purpose that fails while it builds the transaction, e.g.
 * `Spend[1] the validator crashed / exited prematurely` and, when the script traced one, the
 * trace line. The index is the redeemer's: it depends on how the ledger sorts the inputs.
 */
const refusal = (purpose: "Publish" | "Spend", trace?: string) =>
  new RegExp(
    `^failed script execution\\n\\s+${purpose}\\[\\d+\\] the validator crashed / exited prematurely` +
      (trace === undefined ? "" : `\\n\\s+Trace ${trace}`) +
      "$",
  );

describe("night_registration and night_staking on the ledger", () => {
  test("register, Init, Create, Update, Lock, Unbond, Unlock and Deactivate, each with its 0 withdrawal", async () => {
    const emulator = new Emulator([]);

    await emulator.as("operator", async (blaze, addr) => {
      const wallet = PaymentAddress(addr.toBech32());
      const coldKey = addr.asBase()!.getPaymentCredential().hash;
      const stakeKey = addr.asBase()!.getStakeCredential().hash;
      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          { index: 0, txId: TransactionId("ff".repeat(32)) },
          { address: wallet, value: { coins: 900_000_000n } },
        ]),
      );

      // Diagram 1 for both scripts, and the operator's own stake key, which the Create
      // delegates to the pool.
      await registerCredential(emulator, blaze, registration);
      await registerCredential(emulator, blaze, staking);
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addRegisterStake(
            Credential.fromCore({
              hash: Hash28ByteBase16(stakeKey),
              type: CredentialType.KeyHash,
            }),
          )
          .addRequiredSigner(Ed25519KeyHashHex(stakeKey)),
      );

      // night_registration's publish purpose refuses every certificate but the registration
      // (`_ -> fail`, which traces nothing): a delegation, and a combined registration and
      // delegation. Each transaction has one certificate, so Publish[0] is night_registration's.
      // TxBuilder has no call for the combined certificate, so the test builds the delegation
      // with its redeemer and swaps the certificate in the body for the combined one.
      const pool = PoolId.fromKeyHash(Ed25519KeyHashHex(coldKey));
      const delegation = () =>
        blaze
          .newTransaction()
          .addDelegation(scriptCredential(registration), pool, ANY)
          .provideScript(registration);
      await emulator.expectScriptFailure(delegation(), refusal("Publish"));
      const combined = delegation();
      // TxBuilder keeps the body it builds in a private `body` field; check that it is there.
      const builder: unknown = combined;
      if (
        !(
          typeof builder === "object" &&
          builder !== null &&
          "body" in builder &&
          builder.body instanceof TransactionBody
        )
      )
        throw new Error("TxBuilder no longer keeps its body in `body`");
      const body = builder.body;
      const certificates = body.certs()!;
      certificates.setValues([
        Certificate.fromCore({
          __typename: CertificateType.StakeRegistrationDelegation,
          stakeCredential: scriptCredential(registration).toCore(),
          poolId: pool,
          deposit: 2_000_000n,
        }),
      ]);
      body.setCerts(certificates);
      expect(body.certs()!.values()[0].toCore().__typename).toBe(
        CertificateType.StakeRegistrationDelegation,
      );
      await emulator.expectScriptFailure(combined, refusal("Publish"));

      // Diagram 6: the Init spends the seed and creates the Head alone.
      const seed = TransactionUnspentOutput.fromCore([
        { index: 0, txId: TransactionId(ONE_SHOT_TX) },
        { address: wallet, value: { coins: 10_000_000n } },
      ]);
      emulator.addUtxo(seed);
      const head: Node = { Head: { next_crch: "", next_pool: "" } };
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(seed)
          .addMint(
            PolicyId(registration.hash()),
            new Map([[AssetName(""), 1n]]),
            ANY,
          )
          .addWithdrawal(rewardAccount(registration), 0n, INIT)
          .provideScript(registration)
          .addOutput(nodeOutput(3_000_000n, head)),
      );

      // Diagram 7b: the Head anchors the new node in both lists.
      const active: Registration = {
        active: true,
        crch: "cc".repeat(32),
        next_crch: "",
        pool_id: coldKey,
        next_pool: "",
        owner: { VerificationKey: coldKey },
        crch_signature: "dd".repeat(64),
        keys: [],
        signatures: [],
        reward_address: "ee".repeat(32),
        fixed_cost: "0",
        attributes: [],
      };
      const relinkedHead: Node = {
        Head: { next_crch: active.crch, next_pool: coldKey },
      };
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(
            await utxoWithDatum(
              blaze,
              registration,
              PlutusData.fromCore(nodeDatum(head)),
            ),
            ANY,
          )
          .addMint(
            PolicyId(registration.hash()),
            new Map([[AssetName(""), 1n]]),
            ANY,
          )
          .addDelegation(
            Credential.fromCore({
              hash: Hash28ByteBase16(stakeKey),
              type: CredentialType.KeyHash,
            }),
            PoolId.fromKeyHash(Ed25519KeyHashHex(coldKey)),
          )
          .addRequiredSigner(Ed25519KeyHashHex(coldKey))
          .addRequiredSigner(Ed25519KeyHashHex(stakeKey))
          .addWithdrawal(rewardAccount(registration), 0n, CREATE_ONE_ANCHOR)
          .provideScript(registration)
          .addOutput(nodeOutput(3_000_000n, { Registration: active }))
          .addOutput(nodeOutput(3_000_000n, relinkedHead)),
      );

      // Diagram 8: the owner changes fixed_cost.
      const updated: Registration = { ...active, fixed_cost: "340000000" };
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(
            await utxoWithDatum(
              blaze,
              registration,
              PlutusData.fromCore(nodeDatum({ Registration: active })),
            ),
            ANY,
          )
          .addRequiredSigner(Ed25519KeyHashHex(coldKey))
          .addWithdrawal(rewardAccount(registration), 0n, UPDATE)
          .provideScript(registration)
          .addOutput(nodeOutput(3_000_000n, { Registration: updated })),
      );
      const node = await utxoWithDatum(
        blaze,
        registration,
        PlutusData.fromCore(nodeDatum({ Registration: updated })),
      );

      // Diagram 2: a lock of 1,000 NIGHT behind the pool, reading its node.
      const returns = PaymentAddress(
        addressFromCredential(
          NetworkId.Testnet,
          Credential.fromCore({
            hash: Hash28ByteBase16(coldKey),
            type: CredentialType.KeyHash,
          }),
        ).toBech32(),
      );
      const lock: DelegationLock = {
        owner: { VerificationKey: coldKey },
        pool_id: coldKey,
        reward_address: "ee".repeat(32),
        return_address: { payment: { VerificationKey: coldKey }, stake: null },
        unbond_at: null,
        attributes: [],
      };
      const lockOutput = (datum: DelegationLock) =>
        TransactionOutput.fromCore({
          address: scriptAddress(staking),
          value: {
            coins: 3_000_000n,
            assets: new Map([
              [AssetId(staking.hash()), 1n],
              [NIGHT, 1_000n],
            ]),
          },
          datum: lockDatum(datum),
        });
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addReferenceInput(node)
          .addMint(
            PolicyId(staking.hash()),
            new Map([[AssetName(""), 1n]]),
            ANY,
          )
          .addMint(
            PolicyId(tcnight.hash()),
            new Map([[AssetName(NIGHT_NAME), 1_000n]]),
            ANY,
          )
          .addRequiredSigner(Ed25519KeyHashHex(coldKey))
          .addWithdrawal(rewardAccount(staking), 0n, LOCK)
          .provideScript(staking)
          .provideScript(tcnight)
          .addOutput(lockOutput(lock)),
      );

      // Diagram 4: unbond at the validity upper bound.
      const until = emulator.clock.slot + 600;
      const unbondAt = emulator.slotToUnix(Slot(until));
      const unbonding: DelegationLock = {
        ...lock,
        unbond_at: String(unbondAt),
      };
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(
            await utxoWithDatum(
              blaze,
              staking,
              PlutusData.fromCore(lockDatum(lock)),
            ),
            ANY,
          )
          .addRequiredSigner(Ed25519KeyHashHex(coldKey))
          .addWithdrawal(rewardAccount(staking), 0n, UNBOND)
          .provideScript(staking)
          .setValidUntil(Slot(until))
          .addOutput(lockOutput(unbonding)),
      );

      // Diagram 5: once UNBONDING_DELAY has passed, the NIGHT goes back to the return address,
      // as the first output. Without the withdrawal, night_staking's spend gate refuses it: the
      // lock is the only script input, and the gate returns false with no withdrawal from
      // night_staking.
      emulator.stepForwardToUnix(unbondAt + UNBONDING_DELAY_MS + 1_000);
      const unlock = async () =>
        blaze
          .newTransaction()
          .addInput(
            await utxoWithDatum(
              blaze,
              staking,
              PlutusData.fromCore(lockDatum(unbonding)),
            ),
            ANY,
          )
          .addMint(
            PolicyId(staking.hash()),
            new Map([[AssetName(""), -1n]]),
            ANY,
          )
          .addRequiredSigner(Ed25519KeyHashHex(coldKey))
          .provideScript(staking)
          .setValidFrom(Slot(emulator.clock.slot))
          .addOutput(
            TransactionOutput.fromCore({
              address: returns,
              value: { coins: 2_000_000n, assets: new Map([[NIGHT, 1_000n]]) },
            }),
          );
      await emulator.expectScriptFailure(
        await unlock(),
        refusal("Spend", "Validator returned false"),
      );
      await emulator.expectValidTransaction(
        blaze,
        (await unlock()).addWithdrawal(rewardAccount(staking), 0n, UNLOCK),
      );

      // Diagram 9: the pool leaves the pool list; the Head is its anchor. Without the
      // withdrawal, night_registration's spend gate refuses it: the node and the Head are the
      // only script inputs, and the gate returns false with no withdrawal from
      // night_registration.
      const cleared: Registration = {
        ...updated,
        active: false,
        pool_id: "",
        next_pool: "",
        owner: { VerificationKey: "" },
        crch_signature: "",
        reward_address: "",
        fixed_cost: "0",
      };
      const deactivate = async () =>
        blaze
          .newTransaction()
          .addInput(node, ANY)
          .addInput(
            await utxoWithDatum(
              blaze,
              registration,
              PlutusData.fromCore(nodeDatum(relinkedHead)),
            ),
            ANY,
          )
          .addRequiredSigner(Ed25519KeyHashHex(coldKey))
          .provideScript(registration)
          .addOutput(nodeOutput(2_000_000n, { Registration: cleared }))
          .addOutput(
            nodeOutput(3_000_000n, {
              Head: { next_crch: active.crch, next_pool: "" },
            }),
          );
      await emulator.expectScriptFailure(
        await deactivate(),
        refusal("Spend", "Validator returned false"),
      );
      await emulator.expectValidTransaction(
        blaze,
        (await deactivate()).addWithdrawal(
          rewardAccount(registration),
          0n,
          DEACTIVATE,
        ),
      );
      await utxoWithDatum(
        blaze,
        registration,
        PlutusData.fromCore(nodeDatum({ Registration: cleared })),
      );
    });
  });
});
