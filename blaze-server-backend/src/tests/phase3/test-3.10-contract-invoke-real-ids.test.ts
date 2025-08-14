import { describe, it, expect } from "bun:test";
import { computeScriptInfo } from "../../utils/script-utils";

describe("Phase 3.10: Contract Invoke Real Transaction IDs - Two Approaches", () => {
  const baseUrl = "http://localhost:3031";

  // Note: Using shared server and SessionManager from global test setup
  // No beforeAll/afterAll needed - handled by test-setup.ts

  // Note: No shared beforeEach - each test creates its own isolated session
  // This follows the pattern where each approach is completely independent


  it("should prove contract invoke transaction IDs are real and unfakeable (Babbage reference scripts)", async () => {
    // Babbage-era approach: reference scripts stored once, reused multiple times
    // Most efficient for repeated contract interactions
    
    // Create fresh session for this test
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet in new session
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA - following SundaeSwap pattern of sufficient funds
      })
    });
    
    const compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";
    
    // Compute contract info directly (no deployment needed for pay-to-contract)
    const { scriptHash: contractScriptHash, contractAddress } = computeScriptInfo(compiledCode);
    
    // Modern approach: No deployment needed - using compiledCode for unlock operations
    const refContractAddress = contractAddress;
    const refContractScriptHash = contractScriptHash;
    
    // Step 1: Create reference script UTXO and ensure we have multiple UTXOs for coin selection
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
          amount: "8000000" // 8 ADA - substantial UTXO for spending/collateral (following SundaeSwap pattern)
        }]
      })
    });
    
    expect(refScriptResp.status).toBe(200);
    const refScriptTx = await refScriptResp.json();
    expect(refScriptTx.success).toBe(true);
    expect(refScriptTx.createdUtxos).toBeDefined();
    expect(refScriptTx.createdUtxos.length).toBeGreaterThan(0);
    
    // Get the reference script UTXO directly from the response (the 2 ADA one with the script)
    const refScriptUtxo = refScriptTx.createdUtxos.find((utxo: any) => utxo.amount === "2000000");
    expect(refScriptUtxo).toBeDefined();
    
    console.log("=== REFERENCE SCRIPT UTXO ===");
    console.log("Reference script UTXO:", refScriptUtxo);
    console.log("=== END REFERENCE SCRIPT DEBUG ===");
    
    // Step 2: Lock funds to contract using manual UTXO selection (following SundaeSwap pattern)
    // Get the 8 ADA UTXO for spending, avoiding the 2 ADA reference script UTXO
    const bigUtxo = refScriptTx.createdUtxos.find((utxo: any) => utxo.amount === "8000000");
    expect(bigUtxo).toBeDefined();
    
    const lockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId: sessionId,
        signerWallet: "alice",
        operations: [{
          type: "spend-specific-utxos",
          utxos: [{ txHash: bigUtxo.txHash, outputIndex: bigUtxo.outputIndex }]
        }, {
          type: "pay-to-contract",
          contractAddress: refContractScriptHash, // Use script hash from fresh session
          compiledCode: compiledCode,
          amount: "3000000", // 3 ADA
          datum: 42
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockTx = await lockResp.json();
    expect(lockTx.success).toBe(true);
    
    // Step 3: Get contract UTXOs to find what we need to unlock
    const contractUtxosResp = await fetch(`${baseUrl}/api/contract/${refContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosData = await contractUtxosResp.json();
    expect(contractUtxosData.utxos.length).toBeGreaterThan(0);
    
    // Find the UTXO we just locked - it should have the transaction ID from our lock operation
    const lockedUtxo = contractUtxosData.utxos.find((u: any) => u.txHash === lockTx.transactionId);
    expect(lockedUtxo).toBeDefined();
    expect(lockedUtxo.amount).toBe("3000000");
    
    // Step 4: Get Alice's balance before unlock
    const aliceBalanceBeforeResp = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResp.json();
    const balanceBefore = BigInt(aliceBalanceBefore.balance);
    
    // Step 5: Verify reference script UTXO still exists before unlock
    const aliceUtxosBeforeUnlockResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosBeforeUnlock = await aliceUtxosBeforeUnlockResp.json();
    console.log("=== PRE-UNLOCK VERIFICATION ===");
    console.log("Alice UTXOs before unlock:", aliceUtxosBeforeUnlock.utxos.length);
    aliceUtxosBeforeUnlock.utxos.forEach((u: any, i: number) => {
      console.log(`UTXO ${i}: ${u.txHash}:${u.outputIndex} = ${u.amount} lovelace`);
    });
    const stillExists = aliceUtxosBeforeUnlock.utxos.find((u: any) => 
      u.txHash === refScriptUtxo.txHash && u.outputIndex === refScriptUtxo.outputIndex
    );
    console.log("Reference script UTXO still exists:", stillExists ? "YES" : "NO");
    console.log("=== END PRE-UNLOCK VERIFICATION ===");
    
    // Step 5: Unlock using reference script (following SundaeSwap pattern)
    // Let Blaze automatically handle collateral selection from available UTXOs
    const unlockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "unlock-utxo",
          txHash: lockedUtxo.txHash,
          outputIndex: lockedUtxo.outputIndex,
          redeemer: 42,
          compiledCode: compiledCode, // Needed for UTXO discovery
          referenceScriptUtxo: {
            txHash: refScriptUtxo.txHash,
            outputIndex: refScriptUtxo.outputIndex
          }
        }]
      })
    });
    
    expect(unlockResp.status).toBe(200);
    const unlockResult = await unlockResp.json();
    expect(unlockResult.success).toBe(true);
    
    const claimedTransactionId = unlockResult.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/); // Should be real 64-char hex
    
    // Step 6: Verify contract UTXO was consumed
    const contractUtxosAfterResp = await fetch(`${baseUrl}/api/contract/${refContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResp.json();
    expect(contractUtxosAfter.success).toBe(true);
    
    // The contract should have one less UTXO (the one we unlocked)
    const remainingUtxos = contractUtxosAfter.utxos.filter((u: any) => u.amount === "3000000");
    expect(remainingUtxos.length).toBe(0); // Our 3 ADA UTXO should be consumed
    
    // Step 7: Verify Alice received the unlocked funds
    const aliceUtxosAfterResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosAfter = await aliceUtxosAfterResp.json();
    expect(aliceUtxosAfter.success).toBe(true);
    
    // Find the UTXO created by our unlock transaction
    const utxoFromOurTransaction = aliceUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId
    );
    
    // CRITICAL TEST - If server lied about transaction ID, this would fail
    expect(utxoFromOurTransaction).toBeDefined();
    expect(utxoFromOurTransaction.txHash).toBe(claimedTransactionId);
    
    // Step 8: Verify Alice's balance increased
    const aliceBalanceAfterResp = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceAfter = await aliceBalanceAfterResp.json();
    const balanceAfter = BigInt(aliceBalanceAfter.balance);
    
    // Alice should have received back the 3 ADA minus fees
    const balanceIncrease = balanceAfter - balanceBefore;
    expect(balanceIncrease).toBeGreaterThan(2800000n); // At least 2.8 ADA back (accounting for fees)
    expect(balanceIncrease).toBeLessThanOrEqual(3000000n); // At most 3 ADA back
    
    console.log(`✅ REFERENCE SCRIPT PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ REFERENCE SCRIPT PROOF: Contract UTXO was consumed via reference script`);
    console.log(`✅ REFERENCE SCRIPT PROOF: Found Alice's UTXO with matching txHash`);
    console.log(`✅ REFERENCE SCRIPT PROOF: Alice received back ~${balanceIncrease} lovelace from reference script unlock`);
    console.log(`✅ BABBAGE REFERENCE SCRIPT PROOF: Modern CIP-33 approach produces real transaction IDs`);
  });

  it("should prove contract invoke transaction IDs are real and unfakeable (Alonzo inline scripts)", async () => {
    // Alonzo-era approach: inline scripts provided with each transaction
    // Backward compatible and simpler for one-off contract interactions
    
    // Create fresh session for this test
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet in new session  
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA - following SundaeSwap pattern of sufficient funds
      })
    });
    
    const compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";
    
    // Compute contract info directly (no deployment needed for pay-to-contract)
    const { scriptHash: inlineContractScriptHash, contractAddress: inlineContractAddress } = computeScriptInfo(compiledCode);
    
    // Modern approach: No deployment needed - using compiledCode for unlock operations
    
    // Step 1: Create substantial UTXOs for spending (no reference scripts needed)
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
          amount: "10000000" // 10 ADA - substantial UTXO for spending/collateral
        }]
      })
    });
    
    expect(setupResp.status).toBe(200);
    const setupTx = await setupResp.json();
    expect(setupTx.success).toBe(true);
    expect(setupTx.createdUtxos).toBeDefined();
    
    // Get the spending UTXO
    const spendingUtxo = setupTx.createdUtxos.find((utxo: any) => utxo.amount === "10000000");
    expect(spendingUtxo).toBeDefined();
    
    console.log("=== ALONZO INLINE SCRIPT SETUP ===");
    console.log("Spending UTXO:", spendingUtxo);
    console.log("=== END ALONZO SETUP DEBUG ===");
    
    // Step 2: Lock funds to contract using manual UTXO selection
    const lockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId: sessionId,
        signerWallet: "alice",
        operations: [{
          type: "spend-specific-utxos",
          utxos: [{ txHash: spendingUtxo.txHash, outputIndex: spendingUtxo.outputIndex }]
        }, {
          type: "pay-to-contract",
          contractAddress: inlineContractScriptHash, // Use computed script hash
          compiledCode: compiledCode,
          amount: "3000000", // 3 ADA
          datum: 42
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockTx = await lockResp.json();
    expect(lockTx.success).toBe(true);
    
    // Step 3: Get contract UTXOs to find what we need to unlock
    const contractUtxosResp = await fetch(`${baseUrl}/api/contract/${inlineContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosData = await contractUtxosResp.json();
    expect(contractUtxosData.utxos.length).toBeGreaterThan(0);
    
    // Find the UTXO we just locked
    const lockedUtxo = contractUtxosData.utxos.find((u: any) => u.txHash === lockTx.transactionId);
    expect(lockedUtxo).toBeDefined();
    expect(lockedUtxo.amount).toBe("3000000");
    
    // Step 4: Get Alice's balance before unlock
    const aliceBalanceBeforeResp = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResp.json();
    const balanceBefore = BigInt(aliceBalanceBefore.balance);
    
    // Step 5: Unlock using inline script (Alonzo-era approach)
    const unlockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "unlock-utxo",
          txHash: lockedUtxo.txHash,
          outputIndex: lockedUtxo.outputIndex,
          redeemer: 42,
          compiledCode: compiledCode // Modern approach - script provided directly
        }]
      })
    });
    
    expect(unlockResp.status).toBe(200);
    const unlockResult = await unlockResp.json();
    expect(unlockResult.success).toBe(true);
    
    const claimedTransactionId = unlockResult.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/); // Should be real 64-char hex
    
    // Step 6: Verify contract UTXO was consumed
    const contractUtxosAfterResp = await fetch(`${baseUrl}/api/contract/${inlineContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResp.json();
    expect(contractUtxosAfter.success).toBe(true);
    
    // The contract should have one less UTXO (the one we unlocked)
    const remainingUtxos = contractUtxosAfter.utxos.filter((u: any) => u.amount === "3000000");
    expect(remainingUtxos.length).toBe(0); // Our 3 ADA UTXO should be consumed
    
    // Step 7: Verify Alice received the unlocked funds
    const aliceUtxosAfterResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosAfter = await aliceUtxosAfterResp.json();
    expect(aliceUtxosAfter.success).toBe(true);
    
    // Find the UTXO created by our unlock transaction
    const utxoFromOurTransaction = aliceUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId
    );
    
    // CRITICAL TEST - If server lied about transaction ID, this would fail
    expect(utxoFromOurTransaction).toBeDefined();
    expect(utxoFromOurTransaction.txHash).toBe(claimedTransactionId);
    
    // Step 8: Verify Alice's balance increased
    const aliceBalanceAfterResp = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceAfter = await aliceBalanceAfterResp.json();
    const balanceAfter = BigInt(aliceBalanceAfter.balance);
    
    // Alice should have received back the 3 ADA minus fees
    const balanceIncrease = balanceAfter - balanceBefore;
    expect(balanceIncrease).toBeGreaterThan(2800000n); // At least 2.8 ADA back (accounting for fees)
    expect(balanceIncrease).toBeLessThanOrEqual(3000000n); // At most 3 ADA back
    
    console.log(`✅ ALONZO INLINE SCRIPT PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ ALONZO INLINE SCRIPT PROOF: Contract UTXO was consumed via inline script`);
    console.log(`✅ ALONZO INLINE SCRIPT PROOF: Found Alice's UTXO with matching txHash`);
    console.log(`✅ ALONZO INLINE SCRIPT PROOF: Alice received back ~${balanceIncrease} lovelace from inline script unlock`);
    console.log(`✅ ALONZO INLINE SCRIPT PROOF: Backward-compatible inline script approach produces real transaction IDs`);
  });
});