import type { Argv, CommandModule } from "yargs";
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
import { Blaze, ColdWallet } from "@blaze-cardano/sdk";
import { resolve } from "path";
import type { GlobalOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";
import { createProvider } from "../../lib/provider";
import { getContractInstances } from "../../lib/contracts";
import { getProtocolParameters, calculateMinUtxo } from "../../lib/protocol";
import { ensureDirectory, writeTransactionFile } from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";

interface MintTcnightOptions extends GlobalOptions {
  "user-address": string;
  destination?: string;
  burn: boolean;
  amount: string;
  "output-file": string;
  "use-build": boolean;
}

export const command = "mint-tcnight <amount>";
export const describe = "Mint or burn TCnight tokens (preview/preprod only)";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .positional("amount", {
      type: "string",
      description: "Amount of NIGHT tokens to mint or burn",
      demandOption: true,
    })
    .option("user-address", {
      alias: "u",
      type: "string",
      demandOption: true,
      description: "User address (wallet for signing and burn source)",
    })
    .option("destination", {
      alias: "d",
      type: "string",
      description:
        "Destination address for minted tokens (default: user address)",
    })
    .option("burn", {
      alias: "b",
      type: "boolean",
      default: false,
      description: "Burn tokens instead of minting",
    })
    .option("output-file", {
      type: "string",
      default: "mint-tcnight-tx.json",
      description: "Output filename",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use freshly built blueprint instead of deployed scripts",
    });
}

export async function handler(argv: MintTcnightOptions) {
  const { network, output, burn } = argv;
  const userAddress = argv["user-address"];
  const destination = argv.destination || userAddress;
  const outputFile = argv["output-file"];
  const useBuild = argv["use-build"];

  const amount = BigInt(argv.amount);
  if (amount <= 0n) {
    throw new Error(`Amount must be positive, got ${amount}`);
  }

  if (network === "mainnet") {
    throw new Error(
      "mint-tcnight is only available on test networks (preview, preprod, qanet, devnet-*, node-dev-*)",
    );
  }

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);
  const action = burn ? "Burning" : "Minting";

  console.log(`\n${action} TCnight tokens on ${network} network`);
  console.log(`Amount: ${amount}`);
  console.log(`User address: ${userAddress}`);
  if (!burn) {
    console.log(`Destination: ${destination}`);
  }

  const networkId = getNetworkId(network);
  const contracts = getContractInstances(network, useBuild);

  const tcnightPolicy = contracts.tcnightMintInfinite;
  if (!tcnightPolicy) {
    throw new Error(
      "TCnight minting is only available on testnet networks (preview/preprod).",
    );
  }
  const policyId = PolicyId(tcnightPolicy.Script.hash());
  const assetName = AssetName(toHex(new TextEncoder().encode("NIGHT")));
  const assetId = AssetId.fromParts(policyId, assetName);

  console.log(`\nTCnight Policy ID: ${policyId}`);

  const providerType = argv.provider;
  const provider = await createProvider(network, providerType);
  const userAddr = Address.fromBech32(userAddress);
  const wallet = new ColdWallet(userAddr, networkId, provider);
  const blaze = await Blaze.from(provider, wallet);
  const protocolParams = await getProtocolParameters(provider);

  const userUtxos = await provider.getUnspentOutputs(userAddr);

  if (userUtxos.length === 0) {
    throw new Error(`No UTxOs found at user address: ${userAddress}`);
  }

  console.log(`Found ${userUtxos.length} UTxOs at user address`);

  let txBuilder = blaze.newTransaction();

  if (burn) {
    let totalTokensFound = 0n;
    const utxosWithTokens = userUtxos.filter(
      (utxo: TransactionUnspentOutput) => {
        const value = utxo.output().amount();
        const tokenAmount = value.multiasset()?.get(assetId) ?? 0n;
        if (tokenAmount > 0n) {
          totalTokensFound += tokenAmount;
          return true;
        }
        return false;
      },
    );

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
      const remainderOutput = TransactionOutput.fromCore({
        address: PaymentAddress(userAddress),
        value: {
          coins: 0n,
          assets: new Map([[assetId, remainder]]),
        },
      });
      remainderOutput
        .amount()
        .setCoin(calculateMinUtxo(protocolParams, remainderOutput));
      txBuilder = txBuilder.addOutput(remainderOutput);
    }
  } else {
    const redeemer = PlutusData.fromCbor(HexBlob("00"));
    txBuilder = txBuilder
      .addMint(policyId, new Map([[assetName, amount]]), redeemer)
      .provideScript(tcnightPolicy.Script);

    const destinationAddr = Address.fromBech32(destination);
    const destinationOutput = TransactionOutput.fromCore({
      address: PaymentAddress(destinationAddr.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([[assetId, amount]]),
      },
    });
    destinationOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, destinationOutput));
    txBuilder = txBuilder.addOutput(destinationOutput);
  }

  const { tx } = await completeTx(txBuilder, {
    commandName: "mint-tcnight",
    provider,
    networkId,
    environment: network,
    knownUtxos: userUtxos,
  });

  ensureDirectory(deploymentDir);
  writeTransactionFile(
    outputPath,
    tx.toCbor(),
    tx.getId(),
    false,
    `${action} TCNight Transaction`,
  );

  console.log("\nTransaction details:");
  console.log(`  - Action: ${action}`);
  console.log(`  - Amount: ${amount} NIGHT`);
  if (!burn) {
    console.log(`  - Destination: ${destination}`);
  }
  console.log(`\nTransaction written to ${outputPath}`);
  console.log(
    `\nSign and submit with: bun cli sign-and-submit -n ${network} ${outputPath}`,
  );
}

const commandModule: CommandModule<GlobalOptions, MintTcnightOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
