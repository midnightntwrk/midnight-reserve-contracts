import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";

describe("Phase 4.12: NFT Minting Tests", () => {
  // Note: Using shared server and SessionManager from global test setup

  test("should deploy NFT policy and mint NFT using build-and-submit", async () => {
    // Create session for testing
    const sessionResponse = await fetch("http://localhost:3031/api/session/new", {
      method: "POST"
    });
    expect(sessionResponse.status).toBe(200);
    const sessionData = await sessionResponse.json();
    expect(sessionData.success).toBe(true);
    const sessionId = sessionData.sessionId;

    // Register a wallet with funds
    const walletResponse = await fetch("http://localhost:3031/api/wallet/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "10000000" // 10 ADA
      })
    });
    expect(walletResponse.status).toBe(200);
    const walletData = await walletResponse.json();
    expect(walletData.success).toBe(true);
    console.log("Wallet data:", JSON.stringify(walletData, null, 2));

    // Get Alice's address from her UTXOs
    const aliceUtxosResponse = await fetch(`http://localhost:3031/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResponse.json();
    const aliceAddress = aliceUtxosData.utxos[0].address;
    console.log("Alice's address:", aliceAddress);

    // Load the hello_world contract as a placeholder for our NFT policy
    const plutusJsonPath = path.join(process.cwd(), "plutus.json");
    const plutusJson = JSON.parse(fs.readFileSync(plutusJsonPath, "utf-8"));
    const helloWorldValidator = plutusJson.validators.find(
      (v: any) => v.title.includes("hello_world") && v.title.includes("spend")
    );
    const policyScriptCbor = helloWorldValidator.compiledCode;

    // Step 1: Deploy the NFT policy using pay-to-address with referenceScript
    // This will create a reference script UTXO that can be used for minting
    const deployResponse = await fetch("http://localhost:3031/api/transaction/build-and-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [
          {
            type: "pay-to-address",
            address: aliceAddress, // Pay back to alice
            amount: "2000000", // 2 ADA for reference script
            referenceScript: policyScriptCbor // Use real compiled script as placeholder policy
          }
        ]
      })
    });

    // This test will fail initially (red phase) - we need to implement the mint operation type
    expect(deployResponse.status).toBe(200);
    const deployData = await deployResponse.json();
    expect(deployData.success).toBe(true);
    expect(deployData.transactionId).toBeDefined();
    
    console.log("Deploy response:", JSON.stringify(deployData, null, 2));
    
    // Extract the reference script UTXO from the created UTXOs
    // Note: The server doesn't currently include scriptRef in the response, so we identify by amount
    const refScriptUtxo = deployData.createdUtxos.find((utxo: any) => 
      utxo.amount === "2000000" // 2 ADA reference script UTXO
    );
    expect(refScriptUtxo).toBeDefined();
    
    console.log(`✅ NFT policy deployed with reference script UTXO: ${refScriptUtxo.txHash}:${refScriptUtxo.outputIndex}`);

    // Step 2: Mint an NFT using the deployed policy
    const mintResponse = await fetch("http://localhost:3031/api/transaction/build-and-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [
          {
            type: "mint", // This operation type doesn't exist yet - will cause test to fail
            policyId: "5b7e059453488d25906a7920dfe4b750ff4bd8c0afb6fecf8721b050", // Example policy ID
            assetName: "001", // Simple numeric asset name
            amount: "1",
            referenceScriptUtxo: {
              txHash: refScriptUtxo.txHash,
              outputIndex: refScriptUtxo.outputIndex
            }
          },
          {
            type: "pay-to-address",
            address: aliceAddress,
            amount: "1000000" // 1 ADA for the NFT
          }
        ]
      })
    });

    // This should now succeed because the "mint" operation type is implemented
    expect(mintResponse.status).toBe(200);
    const mintData = await mintResponse.json();
    expect(mintData.success).toBe(true);
    expect(mintData.transactionId).toBeDefined();
    
    console.log(`✅ Successfully minted NFT with transaction ID: ${mintData.transactionId}`);
  });
});
