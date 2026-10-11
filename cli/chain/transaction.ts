/**
 * Transaction building blocks shared by the commands: UTxO and datum
 * constructors, logic redeemers and withdrawals, native multisig witnesses,
 * stake registration, inline datum decoding and CIP-20 metadata.
 * inlineDatum and decodeInlineDatum return Either.
 */
import {
  addressFromCredential,
  AssetName,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  NativeScripts,
  type NetworkId,
  PlutusData,
  PolicyId,
  RewardAccount,
  Script,
  type TransactionInput,
  TransactionUnspentOutput,
  Metadata,
  Metadatum,
  MetadatumMap,
  MetadatumList,
} from "@blaze-cardano/core";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Either, Option } from "effect";
import type { Signers } from "../datum/signers";
import type { TxHash, TxIndex } from "../input";
import { DatumParseError } from "../errors";
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
