/**
 * Measure a quorum update in the Blaze emulator (spec §11): a committee of N
 * single-seat keys (default 160), exactly `required(N, 2, 3)` signers with
 * the abstentions spread every third key, and an MMR proof of depth 20
 * (block 2^20). Prints the signed transaction's bytes, the redeemer's and
 * the rest, the fee and each script's execution units, unfunded and as a
 * funded handover, built through `buildBridgeUpdateTx` over the reference
 * scripts. `bun tests/bridge/measure.ts [N]` (slow: the MMR has 2^20
 * leaves).
 */
import {
  NetworkId,
  PaymentAddress,
  type Script,
  Transaction,
  TransactionId,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import { Option } from "effect";
import * as C from "../../contract_blueprint";
import {
  buildBridgeUpdateTx,
  poolDebit,
  poolMinimum,
} from "../../cli/bridge/bridge-tx";
import { MAIN_TOKEN_HEX } from "../../cli/chain/governance-provider";
import { nextBridgeState } from "../../cli/datum/bridge";
import {
  keyAddress,
  registerRewardAccount,
  scriptAddress,
  scriptUtxo,
  upgradeState,
} from "../helpers/fixtures";
import { required } from "./reference/commitment";
import {
  bootstrapOf,
  committeeOf,
  renumbered,
  signedUpdate,
} from "./reference/session";

const N = Number(process.argv[2] ?? 160);
const BLOCK = 2 ** 20;
const FEE_CAP: C.BeefyThreshold = {
  numerator: 2n,
  denominator: 3n,
  base: 650_000n,
  per_signer: 13_000n,
};

/** The Conway redeemer tags, by number. */
const REDEEMER_TAGS = ["spend", "mint", "cert", "withdraw", "vote", "propose"];

const forever = new C.CommitteeBridgeCommitteeBridgeForeverElse();
const logic = new C.CommitteeBridgeCommitteeBridgeLogicElse();
const twoStage = new C.CommitteeBridgeCommitteeBridgeTwoStageUpgradeElse();
const threshold = new C.ThresholdsBeefySignerThresholdElse();
const pool = new C.CommitteeBridgePoolCommitteeBridgePoolElse();

/** A UTxO under a fixed transaction id, so the input order, and with it the scripts' costs, repeat run to run. */
const utxoAt = (
  txId: string,
  address: string,
  coins: bigint,
  script?: Script,
): TransactionUnspentOutput =>
  TransactionUnspentOutput.fromCore([
    { index: 0, txId: TransactionId(txId.repeat(32)) },
    {
      address: PaymentAddress(address),
      value: { coins },
      ...(script ? { scriptReference: script.toCore() } : {}),
    },
  ]);

const current = committeeOf(
  4n,
  Array.from({ length: N }, (_, i) => BigInt(1000 + i)),
  Array.from({ length: N }, () => 1),
);
const next = renumbered(current, 5n);
const signers = Array.from({ length: N }, (_, i) => i).filter(
  (i) => i % 3 !== 2,
);
if (signers.length !== required(N, 2, 3))
  throw new Error(`${signers.length} signers, quorum ${required(N, 2, 3)}`);

/** Build, sign and submit one update on a fresh emulator; report its size and budgets. */
const measure = async (label: string, funded: boolean) => {
  const emulator = new Emulator([]);
  await emulator.as("wallet", async (blaze, wallet) => {
    emulator.addUtxo(utxoAt("f0", wallet.toBech32(), 1_000_000_000n));
    registerRewardAccount(emulator, logic.Script.hash());
    const stateIn = bootstrapOf(current, next, 1);
    const holder = keyAddress("ee".repeat(28)).toBech32();
    const inputs = {
      forever: forever.Script,
      logic: logic.Script,
      mitigationLogic: Option.none(),
      pool: pool.Script,
      foreverUtxo: scriptUtxo(
        "aa".repeat(32),
        forever.Script,
        "",
        serialize(C.BeefyConsensusState, stateIn),
        5_000_000n,
      ),
      mainUtxo: scriptUtxo(
        "bb".repeat(32),
        twoStage.Script,
        MAIN_TOKEN_HEX,
        upgradeState(logic.Script.hash(), ""),
      ),
      thresholdUtxo: scriptUtxo(
        "cc".repeat(32),
        threshold.Script,
        "",
        serialize(C.BeefyThreshold, FEE_CAP),
      ),
      scriptRefs: [forever, logic, ...(funded ? [pool] : [])].map((c, i) =>
        utxoAt(`e${i}`, holder, 50_000_000n, c.Script),
      ),
    };
    const poolUtxo = utxoAt("dd", scriptAddress(pool.Script), 40_000_000n);
    for (const u of [
      inputs.foreverUtxo,
      inputs.mainUtxo,
      inputs.thresholdUtxo,
      ...inputs.scriptRefs,
      poolUtxo,
    ])
      emulator.addUtxo(u);

    const update = funded
      ? signedUpdate(next, BLOCK, renumbered(next, 6n).commitment, signers)
      : signedUpdate(current, BLOCK, next.commitment, signers);
    const stateOut = nextBridgeState(stateIn, update);
    const build = (debit: bigint) =>
      buildBridgeUpdateTx(
        blaze,
        inputs,
        update,
        stateOut,
        funded ? Option.some({ poolUtxos: [poolUtxo], debit }) : Option.none(),
        NetworkId.Testnet,
      );
    const fee = (await build(0n).complete()).body().fee();
    const debit = funded
      ? poolDebit(
          fee,
          FEE_CAP.base + FEE_CAP.per_signer * BigInt(signers.length),
          poolUtxo.output().amount().coin(),
          poolMinimum(
            pool.Script,
            NetworkId.Testnet,
            emulator.params.coinsPerUtxoByte,
          ),
        )
      : 0n;
    const signed: Transaction = await blaze.signTransaction(
      await build(debit).complete(),
    );
    await emulator.submitTransaction(signed);

    const bytes = signed.toCbor().length / 2;
    const redeemer = serialize(C.BridgeUpdate, update).toCbor().length / 2;
    console.log(
      `\n${label}: N = ${N}, ${signers.length} signers, MMR depth ${update.mmr_proof.length}`,
    );
    console.log(
      `  transaction ${bytes} B (limit ${emulator.params.maxTxSize}), redeemer ${redeemer} B, the rest ${bytes - redeemer} B`,
    );
    console.log(
      `  fee ${signed.body().fee()} lovelace${funded ? `, the pool pays ${debit}` : ""}`,
    );
    const spent = [...signed.body().inputs().values()].map((input) =>
      input.transactionId() === inputs.foreverUtxo.input().transactionId()
        ? "the forever spend"
        : input.transactionId() === poolUtxo.input().transactionId()
          ? "the pool spend"
          : "an input",
    );
    for (const r of signed.witnessSet().redeemers()?.values() ?? []) {
      const units = r.exUnits();
      const script =
        REDEEMER_TAGS[r.tag()] === "spend"
          ? spent[Number(r.index())]
          : "the logic withdrawal";
      console.log(`  ${script}: mem ${units.mem()}, cpu ${units.steps()}`);
    }
  });
};

await measure("unfunded update", false);
await measure("funded handover", true);
