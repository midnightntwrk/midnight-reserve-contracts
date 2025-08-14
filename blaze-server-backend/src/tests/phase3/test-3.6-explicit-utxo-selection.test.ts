import { describe, it, expect, beforeEach } from "bun:test";

describe("Phase 3.6: Explicit UTXO Selection", () => {
  // Note: Using shared server and SessionManager from global test setup

  const baseUrl = "http://localhost:3031";
  let sessionId: string;


  beforeEach(async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    sessionId = sessionData.sessionId;

    // Register test wallet with funding
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "10000000" // 10 ADA
      })
    });
  });

  it("should build transaction with explicit spend-utxo operation", async () => {
    // TDD Red Phase: Test explicit UTXO selection using discovered UTXOs
    
    // Step 1: Discover alice's UTXOs
    const utxosResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    expect(utxosResponse.status).toBe(200);
    const utxosData = await utxosResponse.json();
    expect(utxosData.utxos.length).toBeGreaterThan(0);
    
    const targetUtxo = utxosData.utxos[0]; // Pick the first UTXO
    
    // Step 2: Build transaction with explicit UTXO selection
    const response = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [
          {
            type: "spend-utxo",
            txHash: targetUtxo.txHash,
            outputIndex: targetUtxo.outputIndex
          },
          {
            type: "pay-to-address",
            address: targetUtxo.address, // Pay back to alice
            amount: "1000000" // 1 ADA
          }
        ]
      })
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.transactionId).toMatch(/^[a-f0-9]{64}$/); // Real transaction ID
    expect(data.operationsExecuted).toBe(2);
  });
});