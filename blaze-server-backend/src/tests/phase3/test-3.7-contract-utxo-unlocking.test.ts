import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createServer } from "../../server";
import { SessionManager } from "../../utils/session-manager";

describe("Phase 3.7: Contract UTXO Unlocking", () => {
  const baseUrl = "http://localhost:3001";
  let server: any;
  let sessionManager: SessionManager;
  let sessionId: string;
  let contractAddress: string;

  beforeAll(async () => {
    sessionManager = new SessionManager();
    server = await createServer(sessionManager);
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

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

    // Deploy contract
    const deployResponse = await fetch(`${baseUrl}/api/contract/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        deployerWallet: "alice",
        contractName: "hello_world",
        compiledCode: "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009"
      })
    });
    const deployData = await deployResponse.json();
    contractAddress = deployData.contractAddress;

    // Lock funds to create a contract UTXO that can be unlocked
    await fetch(`${baseUrl}/api/contract/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        fromWallet: "alice",
        contractAddress,
        amount: "3000000", // 3 ADA
        datum: 42 // Redeemer that unlocks this UTXO
      })
    });
  });

  it("should unlock contract UTXO with explicit unlock-utxo operation", async () => {
    // TDD Red Phase: Test explicit contract UTXO unlocking
    
    // Step 1: Discover contract UTXOs
    const utxosResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    expect(utxosResponse.status).toBe(200);
    const utxosData = await utxosResponse.json();
    expect(utxosData.utxos.length).toBeGreaterThan(0);
    
    const contractUtxo = utxosData.utxos[0]; // Pick the first contract UTXO
    
    // Step 1.5: Get Alice's wallet UTXOs to find her address
    const aliceUtxosResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResponse.json();
    const aliceAddress = aliceUtxosData.utxos[0].address; // Get Alice's address from her UTXOs
    
    // Step 2: Unlock contract UTXO and send funds back to alice
    const response = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [
          {
            type: "unlock-utxo",
            txHash: contractUtxo.txHash,
            outputIndex: contractUtxo.outputIndex,
            redeemer: 42 // This should match the datum locked in the contract
          },
          {
            type: "pay-to-address",
            address: aliceAddress, // Alice's actual address
            amount: "2000000" // Return 2 ADA to alice (minus fees)
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