import {
  Address,
  AssetId,
  AssetName,
  PolicyId,
  TransactionOutput,
  TransactionUnspentOutput,
  PaymentAddress,
  toHex,
  PlutusData,
  HexBlob,
} from "@blaze-cardano/core";
import { resolve } from "path";

import type { MintTcnightOptions } from "../lib/types";
import { createProvider } from "../lib/provider";
import { getContractInstances } from "../lib/contracts";
import {
  printSuccess,
  printError,
  printProgress,
  writeTransactionFile,
  ensureDirectory,
} from "../utils/output";
import { Blaze, ColdWallet } from "@blaze-cardano/sdk";
import { getNetworkId } from "../lib/types";

export async function mintTcnight(options: MintTcnightOptions): Promise<void> {
  const {
    network,
    output,
    userAddress,
    destinationAddress,
    amount,
    burn,
    outputFile,
  } = options;

  if (network === "mainnet") {
    throw new Error(
      "mint-tcnight is only available on preview and preprod networks",
    );
  }

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);
  const action = burn ? "Burning" : "Minting";
  const destination = destinationAddress || userAddress;

  console.log(`\n${action} TCnight tokens on ${network} network`);
  console.log(`Amount: ${amount}`);
  console.log(`User address: ${userAddress}`);
  if (!burn) {
    console.log(`Destination: ${destination}`);
  }

  const networkId = getNetworkId(network);
  const contracts = getContractInstances(network);

  const tcnightPolicy = contracts.tcnightMintInfinite;
  const policyId = PolicyId(tcnightPolicy.Script.hash());
  const assetName = AssetName(toHex(new TextEncoder().encode("NIGHT")));
  const assetId = AssetId.fromParts(policyId, assetName);

  console.log(`\nTCnight Policy ID: ${policyId}`);

  const provider = await createProvider(network, options.provider);
  const userAddr = Address.fromBech32(userAddress);
  const wallet = new ColdWallet(userAddr, networkId, provider);
  const blaze = await Blaze.from(provider, wallet);

  printProgress("Fetching UTxOs...");

  const userUtxos = await provider.getUnspentOutputs(userAddr);

  if (userUtxos.length === 0) {
    throw new Error(`No UTxOs found at user address: ${userAddress}`);
  }

  console.log(`Found ${userUtxos.length} UTxOs at user address`);

  try {
    let txBuilder = blaze.newTransaction();

    if (burn) {
      printProgress("Finding UTxOs with TCnight tokens to burn...");

      let totalTokensFound = 0n;
      const utxosWithTokens = userUtxos.filter((utxo: TransactionUnspentOutput) => {
        const value = utxo.output().amount();
        const tokenAmount = value.multiasset()?.get(assetId) ?? 0n;
        if (tokenAmount > 0n) {
          totalTokensFound += tokenAmount;
          return true;
        }
        return false;
      });

      if (utxosWithTokens.length === 0) {
        throw new Error(
          `No TCnight tokens found at user address: ${userAddress}`,
        );
      }

      if (totalTokensFound < amount) {
        throw new Error(
          `Insufficient TCnight tokens. Found: ${totalTokensFound}, Required: ${amount}`,
        );
      }

      console.log(
        `Found ${totalTokensFound} TCnight tokens across ${utxosWithTokens.length} UTxOs`,
      );

      let tokensCollected = 0n;
      for (const utxo of utxosWithTokens) {
        if (tokensCollected >= amount) break;
        txBuilder = txBuilder.addInput(utxo);
        const tokenAmount =
          utxo.output().amount().multiasset()?.get(assetId) ?? 0n;
        tokensCollected += tokenAmount;
      }

      const redeemer = PlutusData.fromCbor(HexBlob("00"));
      txBuilder = txBuilder
        .addMint(policyId, new Map([[assetName, -amount]]), redeemer)
        .provideScript(tcnightPolicy.Script);

      const remainder = tokensCollected - amount;
      if (remainder > 0n) {
        txBuilder = txBuilder.addOutput(
          TransactionOutput.fromCore({
            address: PaymentAddress(userAddress),
            value: {
              coins: 2_000_000n,
              assets: new Map([[assetId, remainder]]),
            },
          }),
        );
      }
    } else {
      printProgress("Building mint transaction...");

      const redeemer = PlutusData.fromCbor(HexBlob("00"));
      txBuilder = txBuilder
        .addMint(policyId, new Map([[assetName, amount]]), redeemer)
        .provideScript(tcnightPolicy.Script);

      const destinationAddr = Address.fromBech32(destination);
      txBuilder = txBuilder.addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(destinationAddr.toBech32()),
          value: {
            coins: 2_000_000n,
            assets: new Map([[assetId, amount]]),
          },
        }),
      );
    }

    printProgress("Completing transaction...");
    const tx = await txBuilder.complete();

    ensureDirectory(deploymentDir);
    writeTransactionFile(outputPath, tx.toCbor(), tx.getId(), false);

    printSuccess(`Transaction built successfully!`);
    console.log("Transaction ID:", tx.getId());
    console.log(`\nTransaction details:`);
    console.log(`  - Action: ${action}`);
    console.log(`  - Amount: ${amount} NIGHT`);
    if (!burn) {
      console.log(`  - Destination: ${destination}`);
    }
    console.log(`\nTransaction written to ${outputPath}`);
    console.log(
      `\nSign and submit with: bun cli sign-and-submit -n ${network} ${outputPath}`,
    );
  } catch (error) {
    printError(`Transaction build failed`);
    console.error(error);
    throw error;
  }
}
