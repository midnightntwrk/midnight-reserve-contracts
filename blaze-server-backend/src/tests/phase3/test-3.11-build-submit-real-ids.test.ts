import { describe, it, expect, beforeEach } from "bun:test";
import { computeScriptInfo } from "../../utils/script-utils";

describe("Phase 3.11: Build-and-Submit Real Transaction IDs", () => {
  // Note: Using shared server and SessionManager from global test setup

  const baseUrl = "http://localhost:3031";
  let sessionId: string;
  let contractAddress: string;
  let contractScriptHash: string;
  let compiledCode: string;


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

    compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";
    
    // Compute contract info directly
    const contractInfo = computeScriptInfo(compiledCode);
    contractAddress = contractInfo.contractAddress;
    contractScriptHash = contractInfo.scriptHash;
    
    // Modern approach: No deployment needed - using computeScriptInfo for contract addresses
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
    
    // Get contract balance by fetching UTXOs and calculating total
    const contractUtxosBeforeResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosBefore = await contractUtxosBeforeResponse.json();
    const contractBalanceBeforeAmount = BigInt(contractUtxosBefore.utxos.reduce((sum: number, utxo: any) => sum + parseInt(utxo.amount), 0));
    
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
            contractAddress: contractScriptHash,
            compiledCode: compiledCode,
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
    // Get contract balance by fetching UTXOs and calculating total  
    const contractUtxosAfterForBalanceResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfterForBalance = await contractUtxosAfterForBalanceResponse.json();
    const contractBalanceAfterAmount = BigInt(contractUtxosAfterForBalance.utxos.reduce((sum: number, utxo: any) => sum + parseInt(utxo.amount), 0));
    
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
    console.log(`✅ BABBAGE BUILD-SUBMIT PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ Alice spent ${aliceBalanceDecrease} lovelace (3.5 ADA + fees)`);
    console.log(`✅ Alice's old UTXOs were consumed and she got change UTXO`);
    console.log(`✅ Bob received exactly ${bobBalanceIncrease} lovelace via UTXO with matching txHash`);
    console.log(`✅ Contract received exactly ${contractBalanceIncrease} lovelace via UTXO with matching txHash`);
    console.log(`✅ ALL outputs have the same transaction ID - proving it's ONE real transaction`);
    console.log(`✅ BABBAGE REFERENCE SCRIPT PROOF: Complex transaction operations produce real transaction IDs`);
  });

  it("should handle complex transaction with UTXO unlocking using reference scripts", async () => {
    // Babbage-era approach for unlocking UTXOs using reference scripts
    // Most efficient for repeated unlocking operations
    
    // Create fresh session for this test
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA
      })
    });
    
    const compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";
    
    // Compute contract info directly (no deployment needed)
    const { scriptHash: refContractScriptHash, contractAddress: refContractAddress } = computeScriptInfo(compiledCode);
    
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
    
    // First, lock funds to the contract using manual UTXO selection
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
          compiledCode: compiledCode,
          amount: "3000000", // 3 ADA
          datum: 99
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);
    
    
    // Get the locked UTXO details
    const contractUtxosResponse = await fetch(`${baseUrl}/api/contract/${refContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxos = await contractUtxosResponse.json();
    const lockedUtxo = contractUtxos.utxos.find((u: any) => u.txHash === lockData.transactionId);
    expect(lockedUtxo).toBeDefined();
    
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
            redeemer: 99, // Matching redeemer to unlock
            compiledCode: compiledCode, // Needed for UTXO discovery
            referenceScriptUtxo: {
              txHash: refScriptUtxo.txHash,
              outputIndex: refScriptUtxo.outputIndex
            }
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
    
    console.log(`✅ BABBAGE UNLOCK PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ Contract UTXO was successfully unlocked and consumed using reference script`);
    console.log(`✅ Alice received back ${aliceBalanceIncrease} lovelace from unlocked funds`);
    console.log(`✅ Transaction ID matches the UTXO that contains the unlocked funds`);
    console.log(`✅ BABBAGE REFERENCE SCRIPT PROOF: Complex unlock operations produce real transaction IDs`);
  });

  it("should handle complex transaction with UTXO unlocking using inline scripts", async () => {
    // Alonzo-era approach for unlocking UTXOs using inline scripts
    // Backward compatible approach for complex unlock operations
    
    // Create fresh session for this test
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA
      })
    });
    
    const compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";
    
    // Compute contract info directly (no deployment needed)
    const { scriptHash: inlineContractScriptHash, contractAddress: inlineContractAddress } = computeScriptInfo(compiledCode);
    
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
    
    // First, lock funds to the contract using manual UTXO selection
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
          compiledCode: compiledCode,
          amount: "3000000", // 3 ADA
          datum: 99
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);
    
    
    // Get the locked UTXO details
    const contractUtxosResponse = await fetch(`${baseUrl}/api/contract/${inlineContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxos = await contractUtxosResponse.json();
    const lockedUtxo = contractUtxos.utxos.find((u: any) => u.txHash === lockData.transactionId);
    expect(lockedUtxo).toBeDefined();

    // Get initial balances
    const aliceBalanceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResponse.json();
    const aliceBalanceBeforeAmount = BigInt(aliceBalanceBefore.balance);
    
    // Build and submit transaction that unlocks the contract UTXO using inline script
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
            redeemer: 99, // Matching redeemer to unlock
            compiledCode: compiledCode // Modern approach - script provided directly
          },
          {
            type: "pay-to-address",
            address: aliceAddress,
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

    // Verify the contract UTXO was consumed
    const contractUtxosAfterResponse = await fetch(`${baseUrl}/api/contract/${inlineContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResponse.json();
    const remainingUtxos = contractUtxosAfter.utxos.filter((u: any) => u.amount === "3000000");
    expect(remainingUtxos.length).toBe(0); // Our 3 ADA contract UTXO should be consumed
    
    // Verify Alice received funds back
    const aliceBalanceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceAfter = await aliceBalanceAfterResponse.json();
    const aliceBalanceAfterAmount = BigInt(aliceBalanceAfter.balance);
    
    // Alice should have received back most of the 3 ADA (minus fees)
    const aliceBalanceIncrease = aliceBalanceAfterAmount - aliceBalanceBeforeAmount;
    expect(aliceBalanceIncrease).toBeGreaterThan(2300000n); // Got back at least 2.3 ADA
    expect(aliceBalanceIncrease).toBeLessThan(2900000n); // But not more than 2.9 ADA (accounting for fees)
    
    // Verify Alice has a UTXO from this transaction
    const aliceUtxosResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxos = await aliceUtxosResponse.json();
    const aliceReceivedUtxo = aliceUtxos.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId && utxo.amount === "2500000"
    );
    expect(aliceReceivedUtxo).toBeDefined();
    
    console.log(`✅ ALONZO UNLOCK PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ Contract UTXO was successfully unlocked and consumed using inline script`);
    console.log(`✅ Alice received back ${aliceBalanceIncrease} lovelace from unlocked funds`);
    console.log(`✅ Transaction ID matches the UTXO that contains the unlocked funds`);
    console.log(`✅ ALONZO INLINE SCRIPT PROOF: Backward-compatible inline script approach produces real transaction IDs for complex unlock operations`);
  });
});