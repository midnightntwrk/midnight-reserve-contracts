import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createServer } from "../../server";
import { SessionManager } from "../../utils/session-manager";

describe("Phase 3.11: Build-and-Submit Real Transaction IDs", () => {
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

    // Register test wallets
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "10000000" // 10 ADA
      })
    });

    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "bob",
        initialBalance: "5000000" // 5 ADA
      })
    });

    // Deploy contract
    const deployResponse = await fetch(`${baseUrl}/api/contract/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        deployerWallet: "alice",
        contractName: "test_contract",
        compiledCode: "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009"
      })
    });
    const deployData = await deployResponse.json();
    contractAddress = deployData.contractAddress;
  });

  it("should prove build-and-submit transaction IDs are real and unfakeable", async () => {
    // COMPREHENSIVE TEST: Complex transaction with multiple operations
    
    // Step 1: Get initial state for all parties
    const aliceBalanceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResponse.json();
    const aliceBalanceBeforeAmount = BigInt(aliceBalanceBefore.balance);
    
    const aliceUtxosBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosBefore = await aliceUtxosBeforeResponse.json();
    const aliceUtxosBeforeTxHashes = aliceUtxosBefore.utxos.map((u: any) => u.txHash);
    
    const bobBalanceBeforeResponse = await fetch(`${baseUrl}/api/wallet/bob/balance?sessionId=${sessionId}`);
    const bobBalanceBefore = await bobBalanceBeforeResponse.json();
    const bobBalanceBeforeAmount = BigInt(bobBalanceBefore.balance);
    
    const contractBalanceBeforeResponse = await fetch(`${baseUrl}/api/contract/test_contract/balance?sessionId=${sessionId}`);
    const contractBalanceBefore = await contractBalanceBeforeResponse.json();
    const contractBalanceBeforeAmount = BigInt(contractBalanceBefore.balance);
    
    // Step 2: Build and submit a complex transaction with multiple operations
    const buildSubmitResponse = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [
          {
            type: "pay-to-address",
            address: (await fetch(`${baseUrl}/api/wallet/bob/utxos?sessionId=${sessionId}`)
              .then(r => r.json())
              .then(data => data.utxos[0].address)), // Bob's address
            amount: "1500000" // 1.5 ADA to Bob
          },
          {
            type: "pay-to-contract",
            contractAddress: "test_contract",
            amount: "2000000", // 2 ADA to contract
            datum: 77 // Simple integer datum
          }
        ]
      })
    });

    expect(buildSubmitResponse.status).toBe(200);
    const buildSubmitData = await buildSubmitResponse.json();
    expect(buildSubmitData.success).toBe(true);
    
    const claimedTransactionId = buildSubmitData.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/);
    expect(buildSubmitData.operationsExecuted).toBe(2);

    // Step 3: Wait for transaction processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Step 4: Verify Alice's state changed correctly
    const aliceBalanceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceAfter = await aliceBalanceAfterResponse.json();
    const aliceBalanceAfterAmount = BigInt(aliceBalanceAfter.balance);
    
    // Alice should have spent 1.5 + 2 = 3.5 ADA plus fees
    const aliceBalanceDecrease = aliceBalanceBeforeAmount - aliceBalanceAfterAmount;
    expect(aliceBalanceDecrease).toBeGreaterThan(3500000n); // More than 3.5 ADA (includes fees)
    expect(aliceBalanceDecrease).toBeLessThan(3700000n); // Less than 3.7 ADA (reasonable fee limit)
    
    // Alice's old UTXOs should be consumed
    const aliceUtxosAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosAfter = await aliceUtxosAfterResponse.json();
    const oldUtxosStillPresent = aliceUtxosAfter.utxos.filter((u: any) => 
      aliceUtxosBeforeTxHashes.includes(u.txHash)
    );
    expect(oldUtxosStillPresent.length).toBe(0);
    
    // Alice should have a change UTXO from our transaction
    const aliceChangeUtxo = aliceUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId
    );
    expect(aliceChangeUtxo).toBeDefined();
    
    // Step 5: Verify Bob received his payment
    const bobBalanceAfterResponse = await fetch(`${baseUrl}/api/wallet/bob/balance?sessionId=${sessionId}`);
    const bobBalanceAfter = await bobBalanceAfterResponse.json();
    const bobBalanceAfterAmount = BigInt(bobBalanceAfter.balance);
    
    // Bob's balance should have increased by exactly 1.5 ADA
    const bobBalanceIncrease = bobBalanceAfterAmount - bobBalanceBeforeAmount;
    expect(bobBalanceIncrease).toBe(1500000n);
    
    // Bob should have a new UTXO from our transaction
    const bobUtxosAfterResponse = await fetch(`${baseUrl}/api/wallet/bob/utxos?sessionId=${sessionId}`);
    const bobUtxosAfter = await bobUtxosAfterResponse.json();
    const bobReceivedUtxo = bobUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId && utxo.amount === "1500000"
    );
    expect(bobReceivedUtxo).toBeDefined();
    expect(bobReceivedUtxo.txHash).toBe(claimedTransactionId);
    
    // Step 6: Verify contract received its funds
    const contractBalanceAfterResponse = await fetch(`${baseUrl}/api/contract/test_contract/balance?sessionId=${sessionId}`);
    const contractBalanceAfter = await contractBalanceAfterResponse.json();
    const contractBalanceAfterAmount = BigInt(contractBalanceAfter.balance);
    
    // Contract balance should have increased by exactly 2 ADA
    const contractBalanceIncrease = contractBalanceAfterAmount - contractBalanceBeforeAmount;
    expect(contractBalanceIncrease).toBe(2000000n);
    
    // Contract should have a new UTXO from our transaction
    const contractUtxosAfterResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResponse.json();
    const contractReceivedUtxo = contractUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId && utxo.amount === "2000000"
    );
    expect(contractReceivedUtxo).toBeDefined();
    expect(contractReceivedUtxo.txHash).toBe(claimedTransactionId);
    
    // Step 7: CRITICAL VERIFICATION - All UTXOs with the claimed transaction ID
    // prove this is the real transaction that performed ALL these operations
    console.log(`✅ BUILD-SUBMIT PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ Alice spent ${aliceBalanceDecrease} lovelace (3.5 ADA + fees)`);
    console.log(`✅ Alice's old UTXOs were consumed and she got change UTXO`);
    console.log(`✅ Bob received exactly ${bobBalanceIncrease} lovelace via UTXO with matching txHash`);
    console.log(`✅ Contract received exactly ${contractBalanceIncrease} lovelace via UTXO with matching txHash`);
    console.log(`✅ ALL outputs have the same transaction ID - proving it's ONE real transaction`);
    console.log(`✅ Server CANNOT fake build-and-submit transaction IDs`);
  });

  it("should handle complex transaction with UTXO unlocking", async () => {
    // First, lock funds to the contract
    await fetch(`${baseUrl}/api/contract/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        fromWallet: "alice",
        contractAddress,
        amount: "3000000", // 3 ADA
        datum: 99
      })
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Get the locked UTXO details
    const contractUtxosResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxos = await contractUtxosResponse.json();
    const lockedUtxo = contractUtxos.utxos[0];
    
    // Get initial balances
    const aliceBalanceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResponse.json();
    const aliceBalanceBeforeAmount = BigInt(aliceBalanceBefore.balance);
    
    // Build and submit transaction that unlocks the contract UTXO
    const buildSubmitResponse = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [
          {
            type: "unlock-utxo",
            txHash: lockedUtxo.txHash,
            outputIndex: lockedUtxo.outputIndex,
            redeemer: 99 // Matching redeemer to unlock
          },
          {
            type: "pay-to-address",
            address: (await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`)
              .then(r => r.json())
              .then(data => data.utxos[0].address)), // Pay back to Alice
            amount: "2500000" // 2.5 ADA back to Alice (keeping some for fees)
          }
        ]
      })
    });

    expect(buildSubmitResponse.status).toBe(200);
    const buildSubmitData = await buildSubmitResponse.json();
    expect(buildSubmitData.success).toBe(true);
    
    const claimedTransactionId = buildSubmitData.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify the contract UTXO was consumed
    const contractUtxosAfterResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResponse.json();
    expect(contractUtxosAfter.utxos.length).toBe(0); // Contract UTXO should be consumed
    
    // Verify Alice received funds back
    const aliceBalanceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceAfter = await aliceBalanceAfterResponse.json();
    const aliceBalanceAfterAmount = BigInt(aliceBalanceAfter.balance);
    
    // Alice should have received back most of the 3 ADA (minus fees)
    const aliceBalanceIncrease = aliceBalanceAfterAmount - aliceBalanceBeforeAmount;
    expect(aliceBalanceIncrease).toBeGreaterThan(2300000n); // Got back at least 2.3 ADA
    expect(aliceBalanceIncrease).toBeLessThan(2900000n); // But not more than 2.9 ADA (accounting for lower fees)
    
    // Verify Alice has a UTXO from this transaction
    const aliceUtxosResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxos = await aliceUtxosResponse.json();
    const aliceReceivedUtxo = aliceUtxos.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId && utxo.amount === "2500000"
    );
    expect(aliceReceivedUtxo).toBeDefined();
    
    console.log(`✅ UNLOCK PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ Contract UTXO was successfully unlocked and consumed`);
    console.log(`✅ Alice received back ${aliceBalanceIncrease} lovelace from unlocked funds`);
    console.log(`✅ Transaction ID matches the UTXO that contains the unlocked funds`);
  });
});