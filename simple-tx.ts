#!/usr/bin/env bun
import {
  Address,
  Credential,
  CredentialType,
  NetworkId,
} from "@blaze-cardano/core";
import { Blaze, ColdWallet } from "@blaze-cardano/sdk";
import { Blockfrost } from "@blaze-cardano/query";
import * as Contracts from "./contract_blueprint";
import { writeFileSync } from "fs";

async function main() {
  const councilLogic = new Contracts.PermissionedCouncilLogicElse();

  const args = process.argv.slice(1);
  if (args.length !== 1) {
    console.error("Usage: bun run simple-tx.ts <network> <deployer_address>");
    console.error("Example: bun run simple-tx.ts preview addr_test1...");
    process.exit(1);
  }

  const deployerAddress = process.env["DEPLOYER_ADDRESS"]!;

  const [network] = args;

  if (network !== "preview" && network !== "preprod" && network !== "mainnet") {
    console.error("Invalid network. Must be preview, preprod, or mainnet");
    process.exit(1);
  }

  const apiKeyVar = `BLOCKFROST_${network.toUpperCase()}_API_KEY`;
  const apiKey = process.env[apiKeyVar];

  if (!apiKey) {
    console.error(`Missing ${apiKeyVar} in .env`);
    process.exit(1);
  }

  const networkMap: Record<string, string> = {
    preview: "cardano-preview",
    preprod: "cardano-preprod",
    mainnet: "cardano-mainnet",
  };

  console.log(`Using Blockfrost provider for ${network}`);

  const provider = new Blockfrost({
    network: networkMap[network] as any,
    projectId: apiKey,
  });

  const networkId =
    network === "mainnet" ? NetworkId.Mainnet : NetworkId.Testnet;
  const address = Address.fromBech32(deployerAddress);
  const wallet = new ColdWallet(address, networkId, provider);
  const blaze = await Blaze.from(provider, wallet);

  console.log("\nBuilding transaction with 10 outputs of 100 ADA each...");

  try {
    const txBuilder = blaze.newTransaction();

    // Add 10 outputs of 100 ADA each to the same address
    const outputAmount = 100_000_000n; // 100 ADA in lovelace
    for (let i = 0; i < 10; i++) {
      txBuilder.payLovelace(address, outputAmount);
    }
    // txBuilder.addRegisterStake(
    //   Credential.fromCore({
    //     hash: councilLogic.Script.hash(),
    //     type: CredentialType.ScriptHash,
    //   }),
    // );

    console.log("\n⏳ Completing transaction (with evaluation)...");
    const tx = await txBuilder.complete();

    // Write transaction CBOR to file
    const txCbor = tx.toCbor();
    writeFileSync("simple-tx.cbor", txCbor, "utf-8");
    console.log("📝 Transaction CBOR written to simple-tx.cbor");

    console.log("\n✅ Transaction built successfully!");
    console.log("Transaction ID:", tx.getId());
    console.log("Transaction CBOR:", txCbor);
    console.log("\nTransaction details:");
    console.log("  - Outputs: 10");
    console.log("  - Amount per output: 100 ADA");
    console.log("  - Total sent: 1000 ADA");
  } catch (error) {
    console.error("\n❌ Transaction build failed:");
    console.error(error);
    if (error instanceof Error) {
      console.error("\nError message:", error.message);
      console.error("\nError stack:", error.stack);
    }
    throw error;
  }
}

main().catch(console.error);
