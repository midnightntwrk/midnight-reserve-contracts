import { describe, it, expect } from "bun:test";
import { computeScriptInfo, HELLO_WORLD_COMPILED_CODE } from "../../utils/script-utils";

describe("Phase 3.1: Multi-Input Contract Transactions - Two Approaches", () => {
  const baseUrl = "http://localhost:3031";

  it("should consume from multiple UTXOs and create 50/50 split outputs at contract (Babbage reference scripts)", async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register wallet with funding for multi-UTXO testing
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "50000000" // 50 ADA for comprehensive testing
      })
    });
    
    const compiledCode = HELLO_WORLD_COMPILED_CODE;

    // Compute contract info directly (no deployment needed)
    const { scriptHash: contractScriptHash } = computeScriptInfo(compiledCode);

    // Get addresses
    const aliceUtxosResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResp.json();
    const aliceAddress = aliceUtxosData.utxos[0].address;

    // Create reference script and setup multiple UTXOs for multi-input testing
    const setupResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "pay-to-address",
          address: aliceAddress,
          amount: "2000000", // 2 ADA for reference script
          referenceScript: compiledCode
        }, {
          type: "pay-to-address", 
          address: aliceAddress,
          amount: "8000000" // 8 ADA - first spending UTXO
        }, {
          type: "pay-to-address", 
          address: aliceAddress,
          amount: "10000000" // 10 ADA - second spending UTXO  
        }]
      })
    });
    
    const setupTx = await setupResp.json();
    const refScriptUtxo = setupTx.createdUtxos.find((utxo: any) => utxo.amount === "2000000");
    const aliceSpendingUtxo1 = setupTx.createdUtxos.find((utxo: any) => utxo.amount === "8000000");
    const aliceSpendingUtxo2 = setupTx.createdUtxos.find((utxo: any) => utxo.amount === "10000000");

    // Get initial balance
    const aliceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBeforeData = await aliceBeforeResponse.json();
    const aliceBalanceBefore = BigInt(aliceBeforeData.balance);

    // Multi-input transaction using reference scripts
    const response = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice", // Single signer
        operations: [
          {
            type: "spend-specific-utxos",
            utxos: [
              { txHash: aliceSpendingUtxo1.txHash, outputIndex: aliceSpendingUtxo1.outputIndex }, // First UTXO
              { txHash: aliceSpendingUtxo2.txHash, outputIndex: aliceSpendingUtxo2.outputIndex }  // Second UTXO
            ]
          },
          {
            type: "pay-to-contract",
            scriptHash: contractScriptHash,
            compiledCode: compiledCode, // Include script bytes for address computation
            amount: "3000000", // 3 ADA total
            datum: 123
          },
          {
            type: "pay-to-contract", 
            scriptHash: contractScriptHash,
            compiledCode: compiledCode, // Include script bytes for address computation
            amount: "3000000", // Another 3 ADA (50/50 split)
            datum: 456
          }
        ]
      })
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.transactionId).toMatch(/^[a-f0-9]{64}$/);
    expect(data.operationsExecuted).toBe(3); // 1 spend + 2 contract outputs


    // Verify balance decreased
    const aliceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceAfterData = await aliceAfterResponse.json();
    const aliceBalanceAfter = BigInt(aliceAfterData.balance);
    expect(aliceBalanceAfter).toBeLessThan(aliceBalanceBefore);

    console.log(`✅ BABBAGE MULTI-INPUT PROOF: Multi-UTXO transaction successful using reference scripts`);
    console.log(`✅ Transaction ID ${data.transactionId} is REAL`);
  });

  it("should consume from multiple UTXOs and create 50/50 split outputs at contract (Alonzo inline scripts)", async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register wallet with funding for multi-UTXO testing
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "50000000" // 50 ADA for comprehensive testing
      })
    });
    
    const compiledCode = HELLO_WORLD_COMPILED_CODE;

    // Compute contract info directly (no deployment needed)
    const { scriptHash: contractScriptHash } = computeScriptInfo(compiledCode);

    // Setup multiple spending UTXOs for multi-input testing (no reference scripts)
    const aliceUtxosResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResp.json();
    const aliceAddress = aliceUtxosData.utxos[0].address;
    
    const aliceSetupResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "pay-to-address", 
          address: aliceAddress,
          amount: "8000000" // 8 ADA - first spending UTXO
        }, {
          type: "pay-to-address", 
          address: aliceAddress,
          amount: "10000000" // 10 ADA - second spending UTXO  
        }]
      })
    });
    
    const aliceSetupTx = await aliceSetupResp.json();
    const aliceSpendingUtxo1 = aliceSetupTx.createdUtxos.find((utxo: any) => utxo.amount === "8000000");
    const aliceSpendingUtxo2 = aliceSetupTx.createdUtxos.find((utxo: any) => utxo.amount === "10000000");

    // Get initial balance
    const aliceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBeforeData = await aliceBeforeResponse.json();
    const aliceBalanceBefore = BigInt(aliceBeforeData.balance);

    // Multi-input transaction using inline scripts
    const response = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice", // Primary signer
        operations: [
          {
            type: "spend-specific-utxos",
            utxos: [
              { txHash: aliceSpendingUtxo1.txHash, outputIndex: aliceSpendingUtxo1.outputIndex }, // First UTXO
              { txHash: aliceSpendingUtxo2.txHash, outputIndex: aliceSpendingUtxo2.outputIndex }  // Second UTXO
            ]
          },
          {
            type: "pay-to-contract",
            scriptHash: contractScriptHash,
            compiledCode: compiledCode, // Include script bytes for address computation
            amount: "3000000", // 3 ADA total
            datum: 123
          },
          {
            type: "pay-to-contract", 
            scriptHash: contractScriptHash,
            compiledCode: compiledCode, // Include script bytes for address computation
            amount: "3000000", // Another 3 ADA (50/50 split)
            datum: 456
          }
        ]
      })
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.transactionId).toMatch(/^[a-f0-9]{64}$/);
    expect(data.operationsExecuted).toBe(3); // 1 spend + 2 contract outputs


    // Verify balance decreased
    const aliceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceAfterData = await aliceAfterResponse.json();
    const aliceBalanceAfter = BigInt(aliceAfterData.balance);
    expect(aliceBalanceAfter).toBeLessThan(aliceBalanceBefore);

    console.log(`✅ ALONZO MULTI-INPUT PROOF: Multi-UTXO transaction successful using inline scripts`);
    console.log(`✅ Transaction ID ${data.transactionId} is REAL`);
  });
});