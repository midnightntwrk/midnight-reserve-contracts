import {
  addressFromCredential,
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
  Transaction,
  TransactionId,
  TransactionUnspentOutput,
  TxCBOR,
  VkeyWitness,
} from "@blaze-cardano/core";
import type { Signer } from "./types";
import { parsePrivateKeys } from "./signers";
import { writeTransactionFile } from "./output";
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

export function parseInlineDatum<T, CT>(
  utxo: TransactionUnspentOutput,
  contractType: CT,
  parseFn: (type: CT, data: PlutusData) => T,
): T {
  const datum = utxo.output().datum();
  if (!datum || datum.asInlineData() === undefined) {
    throw new Error("UTxO missing inline datum");
  }
  return parseFn(contractType, datum.asInlineData()!);
}

/**
 * Signs a governance transaction with tech-auth and council keys, then writes
 * the result to a JSON file. Used by all 4 change-* commands.
 */
export function signAndWriteTx(
  tx: Transaction,
  outputPath: string,
  sign: boolean,
  description: string,
): void {
  if (sign) {
    const signerKeyGroups = [
      {
        label: "tech auth",
        keys: parsePrivateKeys("TECH_AUTH_PRIVATE_KEYS"),
      },
      { label: "council", keys: parsePrivateKeys("COUNCIL_PRIVATE_KEYS") },
    ];

    const allSignatures: ReturnType<typeof signTransaction> = [];

    for (const { label, keys } of signerKeyGroups) {
      console.log(`\nSigning with ${keys.length} ${label} private keys...`);
      const signatures = signTransaction(tx.getId(), keys);
      allSignatures.push(...signatures);
      console.log(`  Created ${signatures.length} signatures`);
    }

    const signedTx = attachWitnesses(tx.toCbor(), allSignatures);
    writeTransactionFile(
      outputPath,
      signedTx.toCbor(),
      tx.getId(),
      true,
      description,
    );
  } else {
    writeTransactionFile(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      description,
    );
  }

  console.log("\nTransaction ID:", tx.getId());
}
