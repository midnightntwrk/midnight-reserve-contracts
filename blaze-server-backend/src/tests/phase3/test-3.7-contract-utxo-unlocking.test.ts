import { describe, it, expect } from "bun:test";

describe("Phase 3.7: Contract UTXO Unlocking - Two Approaches", () => {
  const baseUrl = "http://localhost:3001";

  // Note: Using shared server and SessionManager from global test setup
  // No beforeAll/afterAll needed - handled by test-setup.ts

  // Note: No shared beforeEach - each test creates its own isolated session
  // This follows the pattern where each approach is completely independent


  it("should unlock contract UTXOs successfully (Babbage reference scripts)", async () => {
    // Babbage-era approach: reference scripts stored once, reused for unlocking
    // Most efficient for repeated contract unlock operations
    
    // Create fresh session for this test
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet with funding
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA - following SundaeSwap pattern
      })
    });
    
    const compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";
    
    // Deploy contract for script hash
    const deployResp = await fetch(`${baseUrl}/api/contract/deploy`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId,
        deployerWallet: "alice",
        compiledCode
      })
    });
    
    const deployData = await deployResp.json();
    const refContractAddress = deployData.contractAddress;
    const refContractScriptHash = deployData.contractId;
    
    // Create reference script UTXO and setup UTXOs
    const aliceUtxosResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResp.json();
    const aliceAddress = aliceUtxosData.utxos[0].address;
    
    const refScriptResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId: sessionId,
        signerWallet: "alice",
        operations: [{
          type: "pay-to-address",
          address: aliceAddress,
          amount: "2000000", // 2 ADA for reference script
          referenceScript: compiledCode
        }, {
          type: "pay-to-address", 
          address: aliceAddress,
          amount: "8000000" // 8 ADA for spending
        }]
      })
    });
    
    const refScriptTx = await refScriptResp.json();
    const refScriptUtxo = refScriptTx.createdUtxos.find((utxo: any) => utxo.amount === "2000000");
    const bigUtxo = refScriptTx.createdUtxos.find((utxo: any) => utxo.amount === "8000000");
    
    // Lock funds to create a contract UTXO that can be unlocked
    const lockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "spend-specific-utxos",
          utxos: [{ txHash: bigUtxo.txHash, outputIndex: bigUtxo.outputIndex }]
        }, {
          type: "pay-to-contract",
          contractAddress: refContractScriptHash,
          amount: "3000000", // 3 ADA
          datum: 42 // Redeemer that unlocks this UTXO
        }]
      })
    });
    
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);

    // Wait for lock transaction

    // Get the locked UTXO details
    const contractUtxosResp = await fetch(`${baseUrl}/api/contract/${refContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxos = await contractUtxosResp.json();
    const lockedUtxo = contractUtxos.utxos.find((u: any) => u.txHash === lockData.transactionId);
    expect(lockedUtxo).toBeDefined();
    expect(lockedUtxo.amount).toBe("3000000");
    expect(lockedUtxo.datum).toBe(42);
    
    // Get Alice's balance before unlock
    const aliceBalanceBeforeResp = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResp.json();
    const balanceBefore = BigInt(aliceBalanceBefore.balance);
    
    // Unlock the contract UTXO using reference script
    const unlockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "unlock-utxo",
          txHash: lockedUtxo.txHash,
          outputIndex: lockedUtxo.outputIndex,
          redeemer: 42, // This should match the datum locked in the contract
          referenceScriptUtxo: {
            txHash: refScriptUtxo.txHash,
            outputIndex: refScriptUtxo.outputIndex
          }
        }, {
          type: "pay-to-address",
          address: aliceAddress, // Alice's actual address
          amount: "2000000" // Return 2 ADA to alice (minus fees)
        }]
      })
    });

    expect(unlockResp.status).toBe(200);
    const unlockResult = await unlockResp.json();
    expect(unlockResult.success).toBe(true);

    const claimedTransactionId = unlockResult.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/);
    expect(unlockResult.operationsExecuted).toBe(2);


    // Verify contract UTXO was consumed
    const contractUtxosAfterResp = await fetch(`${baseUrl}/api/contract/${refContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResp.json();
    const remainingUtxos = contractUtxosAfter.utxos.filter((u: any) => u.amount === "3000000");
    expect(remainingUtxos.length).toBe(0);

    // Verify Alice received the unlocked funds
    const aliceUtxosAfterResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosAfter = await aliceUtxosAfterResp.json();
    const utxoFromOurTransaction = aliceUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId && utxo.amount === "2000000"
    );
    expect(utxoFromOurTransaction).toBeDefined();
    expect(utxoFromOurTransaction.txHash).toBe(claimedTransactionId);

    console.log(`✅ BABBAGE UNLOCK PROOF: Successfully unlocked contract UTXO using reference script`);
    console.log(`✅ Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ BABBAGE REFERENCE SCRIPT PROOF: Contract UTXO unlocking produces real transaction IDs`);
  });

  it("should unlock contract UTXOs successfully (Alonzo inline scripts)", async () => {
    // Alonzo-era approach: inline scripts provided with each transaction
    // Backward compatible and simpler for one-off unlock operations
    
    // Create fresh session for this test
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet with funding  
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA - following SundaeSwap pattern
      })
    });
    
    const compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";
    
    // Deploy contract for script hash
    const deployResp = await fetch(`${baseUrl}/api/contract/deploy`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId,
        deployerWallet: "alice",
        compiledCode
      })
    });
    
    const deployData = await deployResp.json();
    const inlineContractAddress = deployData.contractAddress;
    const inlineContractScriptHash = deployData.contractId;
    
    // Create substantial UTXO for spending
    const aliceUtxosResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResp.json();
    const aliceAddress = aliceUtxosData.utxos[0].address;
    
    const setupResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId: sessionId,
        signerWallet: "alice",
        operations: [{
          type: "pay-to-address", 
          address: aliceAddress,
          amount: "10000000" // 10 ADA for spending
        }]
      })
    });
    
    const setupTx = await setupResp.json();
    const spendingUtxo = setupTx.createdUtxos.find((utxo: any) => utxo.amount === "10000000");
    
    // Lock funds to create a contract UTXO that can be unlocked
    const lockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "spend-specific-utxos",
          utxos: [{ txHash: spendingUtxo.txHash, outputIndex: spendingUtxo.outputIndex }]
        }, {
          type: "pay-to-contract",
          contractAddress: inlineContractScriptHash,
          amount: "3000000", // 3 ADA
          datum: 42 // Redeemer that unlocks this UTXO
        }]
      })
    });
    
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);

    // Wait for lock transaction

    // Get the locked UTXO details
    const contractUtxosResp = await fetch(`${baseUrl}/api/contract/${inlineContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxos = await contractUtxosResp.json();
    const lockedUtxo = contractUtxos.utxos.find((u: any) => u.txHash === lockData.transactionId);
    expect(lockedUtxo).toBeDefined();
    expect(lockedUtxo.amount).toBe("3000000");
    expect(lockedUtxo.datum).toBe(42);
    
    // Unlock the contract UTXO using inline script
    const unlockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "unlock-utxo",
          txHash: lockedUtxo.txHash,
          outputIndex: lockedUtxo.outputIndex,
          redeemer: 42, // This should match the datum locked in the contract
          script: compiledCode // Inline script - Alonzo approach
        }, {
          type: "pay-to-address",
          address: aliceAddress, // Alice's actual address
          amount: "2000000" // Return 2 ADA to alice (minus fees)
        }]
      })
    });

    expect(unlockResp.status).toBe(200);
    const unlockResult = await unlockResp.json();
    expect(unlockResult.success).toBe(true);

    const claimedTransactionId = unlockResult.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/);
    expect(unlockResult.operationsExecuted).toBe(2);


    // Verify contract UTXO was consumed
    const contractUtxosAfterResp = await fetch(`${baseUrl}/api/contract/${inlineContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResp.json();
    const remainingUtxos = contractUtxosAfter.utxos.filter((u: any) => u.amount === "3000000");
    expect(remainingUtxos.length).toBe(0);

    // Verify Alice received the unlocked funds
    const aliceUtxosAfterResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosAfter = await aliceUtxosAfterResp.json();
    const utxoFromOurTransaction = aliceUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId && utxo.amount === "2000000"
    );
    expect(utxoFromOurTransaction).toBeDefined();
    expect(utxoFromOurTransaction.txHash).toBe(claimedTransactionId);

    console.log(`✅ ALONZO UNLOCK PROOF: Successfully unlocked contract UTXO using inline script`);
    console.log(`✅ Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ ALONZO INLINE SCRIPT PROOF: Backward-compatible inline script approach produces real transaction IDs for unlocks`);
  });
});