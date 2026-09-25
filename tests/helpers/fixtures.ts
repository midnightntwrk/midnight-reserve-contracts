/** Emulator fixtures shared by the tests: signer sets, governance datums, script and fee UTxOs. */
import {
  type Address,
  addressFromCredential,
  addressFromValidator,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  AssetId,
  NetworkId,
  PaymentAddress,
  PlutusData,
  type Script,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import { randomBytes } from "crypto";
import * as Contracts from "../../deployed-scripts/mainnet/contract_blueprint";
import { createRewardAccount } from "../../cli/chain/transaction";
import type { Signer, Signers } from "../../cli/datum/signers";
import {
  authorityThreshold,
  witnessRequirements,
} from "../../cli/governance/threshold";
import {
  parseTxHash,
  parseTxIndex,
  type TxHash,
  type TxIndex,
} from "../../cli/input";
import { Either } from "effect";

export type BlazeOf = Parameters<Parameters<Emulator["as"]>[1]>[0];

export const signer = (seed: string): Signer => ({
  paymentHash: seed.repeat(28),
  sr25519Key: seed.repeat(32),
});
export const councilSigners: Signers = [
  signer("11"),
  signer("22"),
  signer("33"),
];
export const techAuthSigners: Signers = [
  signer("44"),
  signer("55"),
  signer("66"),
];

/** The serialized VersionedMultisig over the signers. */
export const multisigState = (signers: Signers, logicRound = 0n) =>
  serialize(Contracts.VersionedMultisig, [
    [
      BigInt(signers.length),
      Object.fromEntries(
        signers.map((s) => [`8200581c${s.paymentHash}`, s.sr25519Key]),
      ),
    ],
    logicRound,
  ]);

/** The serialized UpgradeState without mitigations. */
export const upgradeState = (logic: string, auth: string, logicRound = 0n) =>
  serialize(Contracts.UpgradeState, [logic, "", auth, "", 0n, logicRound]);

/** The forever datum of reserve and ICS: Constr 0 [0, 0]. */
export const zeroForeverDatum = PlutusData.fromCore({
  constructor: 0n,
  fields: {
    items: [
      PlutusData.newInteger(0n).toCore(),
      PlutusData.newInteger(0n).toCore(),
    ],
  },
});

/** The 2/3 tech-auth, 2/3 council threshold. */
export const THRESHOLD: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];

/** What a threshold datum (THRESHOLD by default) demands of these signers. */
export const requirementsOf = (
  signers: {
    readonly techAuthSigners: Signers;
    readonly councilSigners: Signers;
  },
  threshold: Contracts.MultisigThreshold = THRESHOLD,
) =>
  witnessRequirements(
    Either.getOrThrow(authorityThreshold(threshold)),
    signers,
  );

/** The enterprise address of a key hash. */
export const keyAddress = (hash: string, network = NetworkId.Testnet) =>
  addressFromCredential(
    network,
    Credential.fromCore({
      type: CredentialType.KeyHash,
      hash: Hash28ByteBase16(hash),
    }),
  );

/** The testnet address of a script. */
export const scriptAddress = (script: Script) =>
  PaymentAddress(addressFromValidator(NetworkId.Testnet, script).toBech32());

/** An output at the script's address holding its token named `assetName`. */
export const scriptOutput = (
  script: Script,
  assetName: string,
  datum: PlutusData,
  coins = 2_000_000n,
) =>
  TransactionOutput.fromCore({
    address: scriptAddress(script),
    value: {
      coins,
      assets: new Map([[AssetId(script.hash() + assetName), 1n]]),
    },
    datum: datum.toCore(),
  });

/** A UTxO at the script's address holding its token named `assetName`. */
export const scriptUtxo = (
  txId: string,
  script: Script,
  assetName: string,
  datum: PlutusData,
  coins = 2_000_000n,
) =>
  new TransactionUnspentOutput(
    new TransactionInput(TransactionId(txId), 0n),
    scriptOutput(script, assetName, datum, coins),
  );

/** A threshold NFT UTxO. */
export const thresholdUtxo = (
  txId: string,
  script: Script,
  threshold = THRESHOLD,
) =>
  scriptUtxo(
    txId,
    script,
    "",
    serialize(Contracts.MultisigThreshold, threshold),
  );

/** The council and tech-auth forever UTxOs over the fixture signer sets. */
export const authorityForevers = (council: Script, techAuth: Script) => ({
  councilForeverUtxo: scriptUtxo(
    "c5".repeat(32),
    council,
    "",
    multisigState(councilSigners),
  ),
  techAuthForeverUtxo: scriptUtxo(
    "7a".repeat(32),
    techAuth,
    "",
    multisigState(techAuthSigners),
  ),
});

/** An ADA-only UTxO at the address. */
export const feeUtxo = (
  addr: Address,
  txId: string,
  index = 0,
  coins = 1_000_000_000n,
) =>
  TransactionUnspentOutput.fromCore([
    { index, txId: TransactionId(txId) },
    { address: PaymentAddress(addr.toBech32()), value: { coins } },
  ]);

/** A transaction id from its hex, through the argument parser. */
export const txHashOf = (hex: string): TxHash =>
  Either.getOrThrow(parseTxHash(hex));

/** A TxIndex from a literal index. */
export const txIndexOf = (index: number): TxIndex =>
  Either.getOrThrow(parseTxIndex(String(index)));

/** The tx id of the fee UTxO that `asFunded` gives the wallet. */
export const FEE_TX = txHashOf("fe".repeat(32));

/** A 10 ADA collateral UTxO at the address, added to the emulator. */
export const addCollateral = (emulator: Emulator, addr: Address) => {
  const utxo = feeUtxo(addr, txHashOf("c0".repeat(32)), 0, 10_000_000n);
  emulator.addUtxo(utxo);
  return utxo;
};

/** The preview deployment transaction (deployments/preview/deployment-transactions.json), confirmed with 5 outputs. */
export const PREVIEW_DEPLOYMENT_TX =
  "61e4d39caefb83cc2971aeb0a7716066a11769652066dec87299eed6e8535271";

/** A random hash of `bytes` bytes, never seen on any chain. */
export const randomHash = (bytes: 28 | 32) =>
  randomBytes(bytes).toString("hex");

/** A fresh emulator; `body` runs as a wallet that holds one fee UTxO, and its value is returned. */
export const asFunded = <A>(
  body: (
    emulator: Emulator,
    blaze: BlazeOf,
    addr: Address,
    fee: TransactionUnspentOutput,
  ) => Promise<A>,
): Promise<A> => {
  const emulator = new Emulator([]);
  return emulator.as("wallet", async (blaze, addr) => {
    const fee = feeUtxo(addr, FEE_TX);
    emulator.addUtxo(fee);
    return body(emulator, blaze, addr, fee);
  });
};

/** Register the script's reward account on the emulator and return it. */
export const registerRewardAccount = (
  emulator: Emulator,
  scriptHash: string,
  networkId = NetworkId.Testnet,
) => {
  const account = createRewardAccount(scriptHash, networkId);
  emulator.accounts.set(account, { balance: 0n });
  return account;
};

export const findUtxoByToken = (
  utxos: TransactionUnspentOutput[],
  scriptHash: string,
  tokenHex: string,
) => {
  const target = AssetId(scriptHash + tokenHex);
  return utxos.find(
    (utxo) => utxo.output().amount().multiasset()?.get(target) === 1n,
  )!;
};
