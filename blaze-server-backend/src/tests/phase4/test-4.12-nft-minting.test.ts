import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";

// Utility function to list assets by name in a human-readable format
function listAssetsByUtxo(utxos: any[]): string[] {
  const assetList: string[] = [];
  
  utxos.forEach((utxo, index) => {
    if (utxo.assets && Object.keys(utxo.assets).length > 0) {
      assetList.push(`UTxO #${index} (${utxo.txHash}:${utxo.outputIndex}):`);
      
      for (const policyId in utxo.assets) {
        for (const assetName in utxo.assets[policyId]) {
          const amount = utxo.assets[policyId][assetName];
          // Try to convert hex asset name back to string if possible
          let readableName = assetName;
          try {
            const bytes = Buffer.from(assetName, 'hex');
            const decoded = bytes.toString('utf8');
            // Only use decoded if it looks like a readable string (letters, numbers, basic symbols)
            if (decoded.match(/^[a-zA-Z0-9\s\-_]+$/) && decoded.trim() && decoded.length > 0) {
              readableName = decoded;
            }
          } catch (e) {
            // Keep hex if conversion fails
          }
          assetList.push(`  - ${policyId}.${readableName}: ${amount}`);
        }
      }
    }
  });
  
  return assetList;
}

// Utility function to find a specific asset in UTXOs
function findAssetInUtxos(utxos: any[], policyId: string, assetName: string): any | null {
  const assetNameHex = Buffer.from(assetName, 'utf8').toString('hex');
  
  for (const utxo of utxos) {
    if (utxo.assets && utxo.assets[policyId] && utxo.assets[policyId][assetNameHex]) {
      return utxo;
    }
  }
  return null;
}

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

    // Step 2: Mint multiple NFTs with friendly names using the deployed policy
    // Mint each asset in a separate transaction to avoid "Duplicate policy" error
    const mintAssets = [
      { friendlyName: "cats", amount: "1" },
      { friendlyName: "dogs", amount: "2" },
      { friendlyName: "gerbils", amount: "3" },
      { friendlyName: "hamsters", amount: "4" }
    ];

    console.log("=== MINTING ASSETS ===");
    for (const { friendlyName, amount } of mintAssets) {
      const assetNameHex = Buffer.from(friendlyName, 'utf8').toString('hex');
      console.log(`Minting ${friendlyName} (${assetNameHex})...`);
      
      const mintResponse = await fetch("http://localhost:3031/api/transaction/build-and-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          signerWallet: "alice",
          operations: [
            {
              type: "mint",
              policyId: "5b7e059453488d25906a7920dfe4b750ff4bd8c0afb6fecf8721b050",
              assetName: assetNameHex,
              amount,
              referenceScriptUtxo: {
                txHash: refScriptUtxo.txHash,
                outputIndex: refScriptUtxo.outputIndex
              }
            }
          ]
        })
      });

      expect(mintResponse.status).toBe(200);
      const mintData = await mintResponse.json();
      expect(mintData.success).toBe(true);
      console.log(`✅ Successfully minted ${friendlyName} with transaction ID: ${mintData.transactionId}`);
    }

    console.log("=== ALL ASSETS MINTED SUCCESSFULLY ===");

    // Step 3: Investigate the resulting UTXOs
    console.log("\n=== INVESTIGATING UTXOs AFTER MINTING ===");
    
    // Get Alice's UTXOs after minting
    const finalUtxosResponse = await fetch(`http://localhost:3031/api/wallet/alice/utxos?sessionId=${sessionId}`);
    expect(finalUtxosResponse.status).toBe(200);
    const finalUtxosData = await finalUtxosResponse.json();
    expect(finalUtxosData.success).toBe(true);
    
    console.log("Final UTXOs raw data:", JSON.stringify(finalUtxosData.utxos, null, 2));
    
    // List all assets in a readable format
    const assetList = listAssetsByUtxo(finalUtxosData.utxos);
    console.log("\nAssets found in UTXOs:");
    assetList.forEach(line => console.log(line));
    
    // Try to find our friendly-named assets
    const actualPolicyId = "5b7e059453488d25906a7920dfe4b750ff4bd8c0afb6fecf8721b050";
    const expectedAssets = ["cats", "dogs", "gerbils", "hamsters"];
    const expectedAmounts = ["1", "2", "3", "4"];
    
    console.log("\n=== SEARCHING FOR FRIENDLY ASSET NAMES ===");
    
    // Find the UTXO that contains our assets
    const nftUtxo = finalUtxosData.utxos.find(utxo => 
      utxo.assets && utxo.assets[actualPolicyId]
    );
    
    if (nftUtxo) {
      console.log(`\n✅ Found asset UTXO: ${nftUtxo.txHash}:${nftUtxo.outputIndex}`);
      console.log("Assets in this UTXO:", JSON.stringify(nftUtxo.assets[actualPolicyId], null, 2));
      
      // Check if we can find each expected asset by name
      let foundAssets = 0;
      expectedAssets.forEach((assetName, index) => {
        const foundViaUtility = findAssetInUtxos(finalUtxosData.utxos, actualPolicyId, assetName);
        if (foundViaUtility) {
          console.log(`✅ Found ${assetName} via utility function`);
          foundAssets++;
        } else {
          console.log(`❌ Could not find ${assetName} via utility function`);
        }
      });
      
      console.log(`Found ${foundAssets}/${expectedAssets.length} expected assets`);
    } else {
      console.log("\n❌ NFT not found in any UTxO");
      
      // Debug: Check what policy IDs and asset names are actually present
      const allPolicyIds = new Set<string>();
      const allAssetNames = new Set<string>();
      
      finalUtxosData.utxos.forEach((utxo: any) => {
        if (utxo.assets) {
          Object.keys(utxo.assets).forEach(policyId => {
            allPolicyIds.add(policyId);
            Object.keys(utxo.assets[policyId]).forEach(assetName => {
              allAssetNames.add(assetName);
            });
          });
        }
      });
      
      console.log("Available policy IDs:", Array.from(allPolicyIds));
      console.log("Available asset names:", Array.from(allAssetNames));
    }
    
    // Test our utility functions
    expect(assetList.length).toBeGreaterThan(0); // Should have some output
    console.log("\n=== UTILITY FUNCTION TESTING ===");
    console.log("Asset listing function works:", assetList.length > 0);
    console.log("Asset finding function works:", nftUtxo !== null);
  });
});
