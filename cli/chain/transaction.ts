/**
 * Transaction building blocks shared by the commands: UTxO and datum
 * constructors, logic redeemers and withdrawals, native multisig witnesses,
 * stake registration, inline datum decoding, CIP-20 metadata, signing and
 * witness merging. signAndWrite is the one Effect; inlineDatum and
 * decodeInlineDatum return Either.
 */
import {
  addressFromCredential,
  AssetName,
  CborSet,
  Credential,
  CredentialType,
  derivePublicKey,
  Ed25519PrivateKey,
  Ed25519PublicKeyHex,
  Ed25519SignatureHex,
  Hash28ByteBase16,
  HexBlob,
  NativeScripts,
  type NetworkId,
  PlutusData,
  PolicyId,
  RewardAccount,
  Script,
  signMessage,
  Transaction,
  type TransactionInput,
  TransactionUnspentOutput,
  TxCBOR,
  VkeyWitness,
  Metadata,
  Metadatum,
  MetadatumMap,
  MetadatumList,
} from "@blaze-cardano/core";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Either, Option } from "effect";
import type { PrivateKey, Signers } from "../datum/signers";
import type { TxHash, TxIndex } from "../input";
import { writeTransaction } from "./tx-file";
import { Output } from "../output";
import { type KeyGroup, Settings } from "../config/settings";
import {
  type ConfigError,
  DatumParseError,
  type FileWriteError,
} from "../errors";
import type * as Contracts from "../../contract_blueprint";

export function createUpgradeState(
  logicScriptHash: string,
  govAuthScriptHash: string,
): Contracts.UpgradeState {
  return [logicScriptHash, "", govAuthScriptHash, "", 0n, 0n];
}

function createNativeMultisigScript(
  requiredSigners: number,
  signers: Signers,
  networkId: NetworkId,
): ReturnType<typeof NativeScripts.atLeastNOfK> {
  return NativeScripts.atLeastNOfK(
    requiredSigners,
    ...signers.map((s) => {
      const bech32 = addressFromCredential(
        networkId,
        Credential.fromCore({
          type: CredentialType.KeyHash,
          hash: Hash28ByteBase16(s.paymentHash),
        }),
      ).toBech32();
      return NativeScripts.justAddress(bech32, networkId);
    }),
  );
}

/** LogicRedeemer::Normal(inner) for a v2 logic (logic_round >= 1); the bare inner redeemer for v1. */
export const logicRedeemer = (
  inner: PlutusData,
  logicRound: number,
): PlutusData =>
  logicRound >= 1
    ? PlutusData.fromCore({
        constructor: 0n,
        fields: { items: [inner.toCore()] },
      })
    : inner;

/** One witness token minted under each native multisig policy, with the policy script attached. */
export const mintWitnesses = (
  txBuilder: TxBuilder,
  witnesses: readonly {
    readonly required: number;
    readonly signers: Signers;
    readonly assetName: string;
  }[],
  networkId: NetworkId,
): TxBuilder =>
  witnesses.reduce((tx, { required, signers, assetName }) => {
    const native = createNativeMultisigScript(required, signers, networkId);
    return tx
      .addMint(PolicyId(native.hash()), new Map([[AssetName(assetName), 1n]]))
      .provideScript(Script.newNativeScript(native));
  }, txBuilder);

/** Zero withdrawals through the logic and, when set, the mitigation logic, both with `redeemer`. */
export const withdrawThroughLogic = (
  txBuilder: TxBuilder,
  logic: Script,
  mitigationLogic: Option.Option<Script>,
  redeemer: PlutusData,
  networkId: NetworkId,
): TxBuilder =>
  [logic, ...Option.toArray(mitigationLogic)].reduce(
    (tx, script) =>
      tx
        .addWithdrawal(
          createRewardAccount(script.hash(), networkId),
          0n,
          redeemer,
        )
        .provideScript(script),
    txBuilder,
  );

/** Register a script's stake credential; the Conway reg_cert needs the script witness and a cert redeemer. */
export function registerScriptStake(
  txBuilder: TxBuilder,
  script: Script,
): TxBuilder {
  return txBuilder.provideScript(script).addRegisterStake(
    Credential.fromCore({
      hash: script.hash(),
      type: CredentialType.ScriptHash,
    }),
    PlutusData.newInteger(0n),
  );
}

export function createRewardAccount(
  scriptHash: string,
  networkId: NetworkId,
): RewardAccount {
  return RewardAccount.fromCredential(
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(scriptHash),
    }).toCore(),
    networkId,
  );
}

/** The public key of a private key. Blaze's helpers take a key as a seed, so an extended key, whose first half is already the scalar, goes through the SDK. */
export const publicKeyOf = (key: PrivateKey): Ed25519PublicKeyHex =>
  key.length === 128
    ? Ed25519PrivateKey.fromExtendedHex(key).toPublic().hex()
    : derivePublicKey(key);

/** Each key's public key and signature of the transaction id. */
export const signTransaction = (
  txId: string,
  privateKeys: readonly PrivateKey[],
): [Ed25519PublicKeyHex, Ed25519SignatureHex][] =>
  privateKeys.map((key) => [
    publicKeyOf(key),
    key.length === 128
      ? Ed25519PrivateKey.fromExtendedHex(key).sign(HexBlob(txId)).hex()
      : signMessage(HexBlob(txId), key),
  ]);

/** A copy of the transaction with the signatures merged into its vkey witnesses; a key it has takes the new signature. */
export const attachWitnesses = (
  txCbor: string,
  signatures: readonly [Ed25519PublicKeyHex, Ed25519SignatureHex][],
): Transaction => {
  const tx = Transaction.fromCbor(TxCBOR(HexBlob(txCbor)));
  const witnessSet = tx.witnessSet();
  const merged = new Map([
    ...(witnessSet.vkeys()?.values() ?? []).map(
      (v): [Ed25519PublicKeyHex, Ed25519SignatureHex] => [
        v.vkey(),
        v.signature(),
      ],
    ),
    ...signatures,
  ]);
  witnessSet.setVkeys(CborSet.fromCore([...merged], VkeyWitness.fromCore));
  tx.setWitnessSet(witnessSet);
  return tx;
};

/** A UTxO reference as `txId#index`. */
export const refOf = (input: TransactionInput): string =>
  `${input.transactionId()}#${input.index()}`;

/** The UTxO with this reference among `utxos`. */
export function findUtxoByTxRef(
  utxos: readonly TransactionUnspentOutput[],
  txHash: TxHash,
  txIndex: TxIndex,
): TransactionUnspentOutput | undefined {
  return utxos.find(
    (utxo) =>
      utxo.input().transactionId() === txHash &&
      utxo.input().index() === BigInt(txIndex),
  );
}

/** The inline datum of a UTxO; a missing one is a DatumParseError for `what`. */
export const inlineDatum = (
  utxo: TransactionUnspentOutput,
  what: string,
): Either.Either<PlutusData, DatumParseError> =>
  Either.fromNullable(
    utxo.output().datum()?.asInlineData(),
    () =>
      new DatumParseError({
        what,
        cbor: "",
        reason: "UTxO has no inline datum",
      }),
  );

/** Decode a datum; a throwing decoder is a DatumParseError for `what`. */
export const decodeDatum = <T>(
  data: PlutusData,
  what: string,
  decode: (data: PlutusData) => T,
): Either.Either<T, DatumParseError> =>
  Either.try({
    try: () => decode(data),
    catch: (cause) =>
      new DatumParseError({
        what,
        cbor: data.toCbor(),
        reason: cause instanceof Error ? cause.message : String(cause),
      }),
  });

/** Decode the inline datum of a UTxO; a missing datum or a throwing decoder is a DatumParseError. */
export const decodeInlineDatum = <T>(
  utxo: TransactionUnspentOutput,
  what: string,
  decode: (data: PlutusData) => T,
): Either.Either<T, DatumParseError> =>
  Either.flatMap(inlineDatum(utxo, what), (data) =>
    decodeDatum(data, what, decode),
  );

const KEY_GROUP_LABELS: Record<KeyGroup, string> = {
  techAuth: "tech auth",
  council: "council",
};

/** Who signs a governance transaction: both authorities, or the tech authority alone. */
type Signing = "both" | "tech-auth";

const SIGNING_GROUPS: Record<Signing, readonly KeyGroup[]> = {
  both: ["techAuth", "council"],
  "tech-auth": ["techAuth"],
};

/** The keys of each group that signs a transaction, or no signing. */
export type Signer =
  | { readonly _tag: "Unsigned" }
  | {
      readonly _tag: "Signed";
      readonly groups: readonly {
        readonly group: KeyGroup;
        readonly keys: readonly PrivateKey[];
      }[];
    };

/** A transaction written without witnesses. */
export const UNSIGNED: Signer = { _tag: "Unsigned" };

/** The signer for `--sign`: every key of `signing`'s groups, resolved at once so a missing key fails before any chain access. */
export const signerFor = (
  sign: boolean,
  signing: Signing,
): Effect.Effect<Signer, ConfigError, Settings> =>
  sign
    ? Effect.flatMap(Settings, (settings) =>
        Effect.map(
          Effect.forEach(SIGNING_GROUPS[signing], (group) =>
            Effect.map(settings.privateKeys(group), (keys) => ({
              group,
              keys,
            })),
          ),
          (groups): Signer => ({ _tag: "Signed", groups }),
        ),
      )
    : Effect.succeed(UNSIGNED);

/** A transaction only the deployer signs, at sign-and-submit. */
export const DEPLOYER_ONLY = 1;

/** The vkey witnesses a transaction carries at submit: every key of a Signed signer or, for an unsigned file, the `required` signatures its multisig witnesses need; and the deployer's, which sign-and-submit adds. */
export const witnessCount = (signer: Signer, required: number): number =>
  DEPLOYER_ONLY +
  (signer._tag === "Signed"
    ? signer.groups.reduce((n, { keys }) => n + keys.length, 0)
    : required);

/** Write a transaction file with a witness from every key of `signer`. */
export const signAndWrite = (
  tx: Transaction,
  outputPath: string,
  signer: Signer,
  description: string,
): Effect.Effect<void, FileWriteError, Output> =>
  Effect.gen(function* () {
    const output = yield* Output;
    const txId = tx.getId();
    const signatures: ReturnType<typeof signTransaction> = [];
    if (signer._tag === "Signed") {
      for (const { group, keys } of signer.groups) {
        yield* output.log(
          `\nSigning with ${keys.length} ${KEY_GROUP_LABELS[group]} private keys...`,
        );
        const created = signTransaction(txId, keys);
        signatures.push(...created);
        yield* output.log(`  Created ${created.length} signatures`);
      }
    }
    const signed = signer._tag === "Signed";
    yield* writeTransaction(
      outputPath,
      (signed ? attachWitnesses(tx.toCbor(), signatures) : tx).toCbor(),
      txId,
      signed,
      description,
    );
    yield* output.log(`\nTransaction ID: ${txId}`);
  });

const CIP20_LABEL = 674n;

/** CIP-20 metadata naming the transaction type. */
export function createTxMetadata(txType: string): Metadata {
  const msgList = new MetadatumList();
  msgList.add(Metadatum.newText(`midnight-reserve:${txType}`));

  const msgMap = new MetadatumMap();
  msgMap.insert(Metadatum.newText("msg"), Metadatum.newList(msgList));

  const metadata = new Map<bigint, Metadatum>();
  metadata.set(CIP20_LABEL, Metadatum.newMap(msgMap));

  return new Metadata(metadata);
}
