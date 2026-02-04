import {
  addressFromCredential,
  AssetId,
  CborSet,
  Credential,
  CredentialType,
  derivePublicKey,
  Ed25519PrivateNormalKeyHex,
  Ed25519PublicKeyHex,
  Ed25519SignatureHex,
  Hash28ByteBase16,
  HexBlob,
  NativeScripts,
  NetworkId,
  PaymentAddress,
  PlutusData,
  RewardAccount,
  signMessage,
  toHex,
  Transaction,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
  TxCBOR,
  VkeyWitness,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type { Signer } from "../lib/types";
import * as Contracts from "../../contract_blueprint";

export function createOneShotUtxo(
  txHash: string,
  txIndex: number,
  address: string,
  amount: bigint,
): TransactionUnspentOutput {
  return TransactionUnspentOutput.fromCore([
    {
      index: txIndex,
      txId: TransactionId(txHash),
    },
    {
      address: PaymentAddress(address),
      value: {
        coins: amount,
      },
    },
  ]);
}

export function createUpgradeState(
  logicScriptHash: string,
  govAuthScriptHash: string,
): Contracts.UpgradeState {
  return [logicScriptHash, "", govAuthScriptHash, "", 0n, 0n];
}

export function createContractOutput(
  address: string,
  coins: bigint,
  assetId: string,
  datum: PlutusData,
): TransactionOutput {
  return TransactionOutput.fromCore({
    address: PaymentAddress(address),
    value: {
      coins,
      assets: new Map([[AssetId(assetId), 1n]]),
    },
    datum: datum.toCore(),
  });
}

export function createTwoStageOutputs(
  twoStageAddress: string,
  twoStageScriptHash: string,
  coins: bigint,
  upgradeState: Contracts.UpgradeState,
): TransactionOutput[] {
  const mainAssetName = toHex(new TextEncoder().encode("main"));
  const stagingAssetName = toHex(new TextEncoder().encode("staging"));
  const serializedState = serialize(Contracts.UpgradeState, upgradeState);

  return [
    TransactionOutput.fromCore({
      address: PaymentAddress(twoStageAddress),
      value: {
        coins,
        assets: new Map([[AssetId(twoStageScriptHash + mainAssetName), 1n]]),
      },
      datum: serializedState.toCore(),
    }),
    TransactionOutput.fromCore({
      address: PaymentAddress(twoStageAddress),
      value: {
        coins,
        assets: new Map([[AssetId(twoStageScriptHash + stagingAssetName), 1n]]),
      },
      datum: serializedState.toCore(),
    }),
  ];
}

export function createNativeMultisigScript(
  requiredSigners: number,
  signers: Signer[],
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

export function signTransaction(
  txId: string,
  privateKeys: string[],
): [Ed25519PublicKeyHex, Ed25519SignatureHex][] {
  const signatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];

  for (const privateKeyHex of privateKeys) {
    const privateKey = Ed25519PrivateNormalKeyHex(privateKeyHex);
    const publicKey = derivePublicKey(privateKey);
    const signature = signMessage(HexBlob(txId), privateKey);
    signatures.push([publicKey, signature]);
  }

  return signatures;
}

export function attachWitnesses(
  txCbor: string,
  signatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][],
): Transaction {
  const blazeTx = Transaction.fromCbor(TxCBOR(HexBlob(txCbor)));
  const witnessSet = blazeTx.witnessSet();

  // Get existing vkey witnesses and merge with new ones
  const existingVkeys = witnessSet.vkeys();
  const existingSignatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];

  if (existingVkeys) {
    for (const vkey of existingVkeys.values()) {
      existingSignatures.push([vkey.vkey(), vkey.signature()]);
    }
  }

  // Merge signatures, deduplicating by public key
  const signatureMap = new Map<string, Ed25519SignatureHex>();
  for (const [pubKey, sig] of existingSignatures) {
    signatureMap.set(pubKey, sig);
  }
  for (const [pubKey, sig] of signatures) {
    signatureMap.set(pubKey, sig);
  }

  const mergedSignatures: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];
  for (const [pubKey, sig] of signatureMap) {
    mergedSignatures.push([
      Ed25519PublicKeyHex(pubKey),
      Ed25519SignatureHex(sig),
    ]);
  }

  const cborSet = CborSet.fromCore(
    mergedSignatures,
    (i: ReturnType<VkeyWitness["toCore"]>) => VkeyWitness.fromCore(i),
  );

  witnessSet.setVkeys(cborSet);
  blazeTx.setWitnessSet(witnessSet);

  return blazeTx;
}

export function findUtxoWithMainAsset(
  utxos: TransactionUnspentOutput[],
): TransactionUnspentOutput | undefined {
  const mainAssetName = Buffer.from("main").toString("hex");

  return utxos.find((utxo) => {
    const assets = utxo.output().amount().multiasset();
    if (!assets) return false;

    for (const [assetId] of assets) {
      if (assetId.endsWith(mainAssetName)) {
        return true;
      }
    }
    return false;
  });
}

export function findUtxoByTxRef(
  utxos: TransactionUnspentOutput[],
  txHash: string,
  txIndex: number,
): TransactionUnspentOutput | undefined {
  return utxos.find(
    (utxo) =>
      utxo.input().transactionId() === txHash &&
      utxo.input().index() === BigInt(txIndex),
  );
}

export function findUtxoWithStagingAsset(
  utxos: TransactionUnspentOutput[],
): TransactionUnspentOutput | undefined {
  const stagingAssetName = Buffer.from("staging").toString("hex");

  return utxos.find((utxo) => {
    const assets = utxo.output().amount().multiasset();
    if (!assets) return false;

    for (const [assetId] of assets) {
      if (assetId.endsWith(stagingAssetName)) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Find a UTxO containing a specific NFT by policy hash and asset name
 *
 * @param utxos Array of UTxOs to search
 * @param policyHash Policy ID of the NFT (hex string)
 * @param assetNameText Asset name as plain text (will be encoded to hex)
 * @returns The UTxO containing the NFT, or undefined if not found
 *
 * @example
 * const mainUtxo = findUtxoWithNft(twoStageUtxos, twoStageScript.hash(), "main");
 * const stagingUtxo = findUtxoWithNft(twoStageUtxos, twoStageScript.hash(), "staging");
 */
export function findUtxoWithNft(
  utxos: TransactionUnspentOutput[],
  policyHash: string,
  assetNameText: string,
): TransactionUnspentOutput | undefined {
  const assetNameHex = toHex(new TextEncoder().encode(assetNameText));
  const targetAssetId = AssetId(policyHash + assetNameHex);

  return utxos.find((utxo) => {
    const assets = utxo.output().amount().multiasset();
    return assets && (assets.get(targetAssetId) ?? 0n) === 1n;
  });
}

/**
 * Extract and parse an inline datum from a UTxO with type safety
 *
 * @param utxo UTxO to extract datum from
 * @param contractType Schema type from contract_blueprint (e.g., Contracts.VersionedMultisig)
 * @param parseFn The parse function from @blaze-cardano/data
 * @returns Parsed datum with the correct type
 * @throws Error if UTxO is missing inline datum
 *
 * @example
 * import { parse } from "@blaze-cardano/data";
 * import * as Contracts from "../../contract_blueprint";
 *
 * const techAuthState = parseInlineDatum(
 *   techAuthForeverUtxo,
 *   Contracts.VersionedMultisig,
 *   parse
 * );
 */
export function parseInlineDatum<T>(
  utxo: TransactionUnspentOutput,
  contractType: any,
  parseFn: (type: any, data: any) => T,
): T {
  const datum = utxo.output().datum();
  if (!datum || datum.asInlineData() === undefined) {
    throw new Error("UTxO missing inline datum");
  }
  return parseFn(contractType, datum.asInlineData()!);
}
