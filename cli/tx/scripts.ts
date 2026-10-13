/**
 * Script building blocks shared by the commands: logic redeemers and
 * withdrawals, native multisig witnesses, reward accounts and CIP-20
 * metadata.
 */
import {
  addressFromCredential,
  AssetName,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  type NativeScript,
  NativeScripts,
  type NetworkId,
  PlutusData,
  RewardAccount,
  Script,
  Metadata,
  Metadatum,
  MetadatumMap,
  MetadatumList,
} from "@blaze-cardano/core";
import { Option } from "effect";
import type { Signers } from "../datum/signers";
import type { TxPlan } from "./plan";

function createNativeMultisigScript(
  requiredSigners: number,
  signers: Signers,
  networkId: NetworkId,
): NativeScript {
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

/** One witness token under each native multisig policy, as plan mints, and the signatures they demand together. */
export const planMintWitnesses = (
  witnesses: readonly {
    readonly required: number;
    readonly signers: Signers;
    readonly assetName: string;
  }[],
  networkId: NetworkId,
): Pick<TxPlan, "mints" | "requiredSignatures"> => ({
  mints: witnesses.map(({ required, signers, assetName }) => ({
    policy: Script.newNativeScript(
      createNativeMultisigScript(required, signers, networkId),
    ),
    assets: new Map([[AssetName(assetName), 1n]]),
    redeemer: Option.none(),
  })),
  requiredSignatures: witnesses.reduce((n, { required }) => n + required, 0),
});

/** The zero withdrawals through the logic and, when set, the mitigation logic, both with `redeemer`, as plan withdrawals. */
export const planWithdrawThroughLogic = (
  logic: Script,
  mitigationLogic: Option.Option<Script>,
  redeemer: PlutusData,
  networkId: NetworkId,
): TxPlan["withdrawals"] =>
  [logic, ...Option.toArray(mitigationLogic)].map((script) => ({
    rewardAccount: createRewardAccount(script.hash(), networkId),
    script,
    redeemer,
  }));

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
