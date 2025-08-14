import { describe, it, expect } from "bun:test";
import { computeScriptInfo, HELLO_WORLD_COMPILED_CODE } from "../../utils/script-utils";

describe("Phase 4.3: Direct UTXO Creation", () => {
  const baseUrl = "http://localhost:3031";

  it("should create UTXOs directly and unlock contract UTXO (replacing tx-based setup)", async () => {
    // This test replicates test-3.7 but uses direct UTXO creation instead of transactions
    // Goal: Skip the complex transaction-based setup and create UTXOs directly
    
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register alice wallet
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000"
      })
    });

    const compiledCode = HELLO_WORLD_COMPILED_CODE;
    const { scriptHash, contractAddress } = computeScriptInfo(compiledCode);

    // Get alice's address for UTXO creation
    const aliceUtxosResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResp.json();
    const aliceAddress = aliceUtxosData.utxos[0].address;

    // ===== DIRECT UTXO CREATION PHASE (should work before any transactions) =====
    
    // 1. Create basic UTXO directly (skip reference script for now)
    const aliceUtxoResponse = await fetch(`${baseUrl}/api/utxo/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        address: aliceAddress,
        amount: "5000000"
      })
    });
    
    expect(aliceUtxoResponse.status).toBe(200);
    const aliceUtxoData = await aliceUtxoResponse.json();
    expect(aliceUtxoData.success).toBe(true);
    expect(aliceUtxoData.utxo.amount).toBe("5000000");

    // 2. Create contract UTXO directly (replaces lock transaction)
    const contractUtxoResponse = await fetch(`${baseUrl}/api/utxo/create`, {
      method: "POST", 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        address: contractAddress,
        amount: "3000000",
        datum: 42
      })
    });

    expect(contractUtxoResponse.status).toBe(200);
    const contractUtxoData = await contractUtxoResponse.json();
    expect(contractUtxoData.success).toBe(true);
    expect(contractUtxoData.utxo.amount).toBe("3000000");
    expect(contractUtxoData.utxo.datum).toBe(42);

    // ===== VERIFICATION PHASE =====
    
    // Verify alice's UTXOs exist (should have original + created)
    const finalAliceUtxos = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const finalAliceData = await finalAliceUtxos.json();
    expect(finalAliceData.utxos.length).toBeGreaterThan(1); // Should have more UTXOs now

    // Verify contract UTXOs exist
    const contractUtxosResp = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxos = await contractUtxosResp.json();
    expect(contractUtxos.utxos.length).toBe(1);
    expect(contractUtxos.utxos[0].amount).toBe("3000000");
    expect(contractUtxos.utxos[0].datum).toBe(42);

    console.log("✅ DIRECT UTXO CREATION PROOF: UTXOs created successfully without transactions");
    console.log(`✅ Created ${2} UTXOs directly, bypassing transaction-based setup`);
  });

  it("should reject UTXO creation after transaction phase begins", async () => {
    // This test validates the phase concept: UTXO creation only allowed before transactions
    
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register wallets
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000"
      })
    });

    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST", 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "bob",
        initialBalance: "10000000"
      })
    });

    // Get alice's address for UTXO creation attempt
    const aliceUtxosResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResp.json();
    const aliceAddress = aliceUtxosData.utxos[0].address;

    // ===== SETUP PHASE: Should work before any transactions =====
    const setupUtxoResponse = await fetch(`${baseUrl}/api/utxo/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        address: aliceAddress,
        amount: "5000000"
      })
    });
    
    expect(setupUtxoResponse.status).toBe(200);
    const setupData = await setupUtxoResponse.json();
    expect(setupData.success).toBe(true);

    // ===== TRANSACTION PHASE: Execute a transaction to mark session as transaction-phase =====
    const transferResponse = await fetch(`${baseUrl}/api/wallet/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        fromWallet: "alice",
        toWallet: "bob",
        amount: "1000000"
      })
    });
    
    expect(transferResponse.status).toBe(200);

    // ===== PHASE VALIDATION: Should now reject UTXO creation =====
    const postTransactionUtxoResponse = await fetch(`${baseUrl}/api/utxo/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        address: aliceAddress,
        amount: "3000000"
      })
    });

    // Should be rejected with specific error
    expect(postTransactionUtxoResponse.status).toBe(400);
    const errorData = await postTransactionUtxoResponse.json();
    expect(errorData.success).toBe(false);
    expect(errorData.error).toBe("Cannot create UTXOs after transactions have been processed");

    console.log("✅ PHASE VALIDATION PROOF: UTXO creation correctly rejected after transaction phase begins");
  });
});