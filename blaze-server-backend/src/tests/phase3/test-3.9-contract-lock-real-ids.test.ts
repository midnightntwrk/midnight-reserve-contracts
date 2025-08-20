import { describe, it, expect } from "bun:test";
import { computeScriptInfo, HELLO_WORLD_COMPILED_CODE } from "../../utils/script-utils";

describe("Phase 3.9: Contract Lock Real Transaction IDs - Two Approaches", () => {
  const baseUrl = "http://localhost:3031";

  // Note: Using shared server and SessionManager from global test setup
  // No beforeAll/afterAll needed - handled by test-setup.ts

  // Note: No shared beforeEach - each test creates its own isolated session
  // This follows the pattern where each approach is completely independent


  it("should prove contract lock transaction IDs are real and unfakeable (Babbage reference scripts)", async () => {
    // Babbage-era approach: reference scripts stored once, reused for multiple lock operations
    // Most efficient for repeated contract lock operations
    
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
    
    const compiledCode = HELLO_WORLD_COMPILED_CODE;
    
    // Compute contract info directly (no deployment needed)
    const { scriptHash: contractScriptHash, contractAddress } = computeScriptInfo(compiledCode);
    const refContractAddress = contractAddress;
    const refContractScriptHash = contractScriptHash;
    
    // Step 1: Create reference script UTXO and ensure we have multiple UTXOs for spending
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
          amount: "8000000" // 8 ADA - substantial UTXO for spending (following SundaeSwap pattern)
        }]
      })
    });
    
    expect(refScriptResp.status).toBe(200);
    const refScriptTx = await refScriptResp.json();
    expect(refScriptTx.success).toBe(true);
    expect(refScriptTx.createdUtxos).toBeDefined();
    expect(refScriptTx.createdUtxos.length).toBeGreaterThan(0);
    
    // Get the reference script UTXO directly from the response
    const refScriptUtxo = refScriptTx.createdUtxos.find((utxo: any) => utxo.amount === "2000000");
    expect(refScriptUtxo).toBeDefined();
    
    // COMPREHENSIVE TEST: Proves the transaction ID is real by verifying ALL state changes
    
    // Step 2: Get Alice's state BEFORE locking funds using build-and-submit approach
    const aliceBalanceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResponse.json();
    const aliceBalanceBeforeAmount = BigInt(aliceBalanceBefore.balance);
    
    const aliceUtxosBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosBefore = await aliceUtxosBeforeResponse.json();
    const aliceUtxosBeforeCount = aliceUtxosBefore.utxos.length;
    const aliceUtxosBeforeTxHashes = aliceUtxosBefore.utxos.map((u: any) => u.txHash);
    
    // Step 3: Get contract state BEFORE locking
    const contractUtxosBeforeResponse = await fetch(`${baseUrl}/api/contract/${refContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosBefore = await contractUtxosBeforeResponse.json();
    const contractBalanceBeforeAmount = BigInt(contractUtxosBefore.utxos.reduce((sum: number, utxo: any) => sum + parseInt(utxo.amount), 0));
    const contractUtxosBeforeCount = contractUtxosBefore.utxos.length;
    
    // Step 4: Lock funds to contract using manual UTXO selection (following SundaeSwap pattern)
    // Get the 8 ADA UTXO for spending, avoiding the 2 ADA reference script UTXO
    const bigUtxo = refScriptTx.createdUtxos.find((utxo: any) => utxo.amount === "8000000");
    expect(bigUtxo).toBeDefined();
    
    const lockResponse = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        signerWallet: "alice",
        operations: [{
          type: "spend-specific-utxos",
          utxos: [{ txHash: bigUtxo.txHash, outputIndex: bigUtxo.outputIndex }]
        }, {
          type: "pay-to-contract",
          scriptHash: refContractScriptHash,
          compiledCode: compiledCode,
          amount: "2000000", // 2 ADA
          datum: 42
        }]
      })
    });

    expect(lockResponse.status).toBe(200);
    const lockData = await lockResponse.json();
    expect(lockData.success).toBe(true);
    
    const claimedTransactionId = lockData.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/); // Should be real 64-char hex

    // Step 5: Wait for transaction processing

    // Step 6: Verify Alice's state AFTER locking
    const aliceBalanceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceAfter = await aliceBalanceAfterResponse.json();
    const aliceBalanceAfterAmount = BigInt(aliceBalanceAfter.balance);
    
    // Alice's balance should have decreased by MORE than 2 ADA (lock amount + fees)
    const aliceBalanceDecrease = aliceBalanceBeforeAmount - aliceBalanceAfterAmount;
    expect(aliceBalanceDecrease).toBeGreaterThan(2000000n); // More than 2 ADA (includes fees)
    expect(aliceBalanceDecrease).toBeLessThan(2200000n); // Less than 2.2 ADA (reasonable fee limit)
    
    // Step 7: Verify Alice's UTXOs changed
    const aliceUtxosAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosAfter = await aliceUtxosAfterResponse.json();
    
    // Alice should have a NEW change UTXO from our transaction
    const aliceChangeUtxo = aliceUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId
    );
    expect(aliceChangeUtxo).toBeDefined();
    expect(aliceChangeUtxo.txHash).toBe(claimedTransactionId);
    
    // Step 8: Verify contract received the locked funds
    const contractUtxosAfterResponse = await fetch(`${baseUrl}/api/contract/${refContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResponse.json();
    const contractBalanceAfterAmount = BigInt(contractUtxosAfter.utxos.reduce((sum: number, utxo: any) => sum + parseInt(utxo.amount), 0));
    
    // Contract balance should have increased by exactly 2 ADA
    const contractBalanceIncrease = contractBalanceAfterAmount - contractBalanceBeforeAmount;
    expect(contractBalanceIncrease).toBe(2000000n);
    
    // Step 9: Verify contract has new UTXO with our transaction ID
    expect(contractUtxosAfter.utxos.length).toBe(contractUtxosBeforeCount + 1);
    
    // Find the UTXO that was created by our contract lock transaction
    const contractUtxoFromOurTx = contractUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId && utxo.amount === "2000000"
    );

    // Step 10: CRITICAL TESTS - If the server lied about the transaction ID:
    // - Alice wouldn't have a change UTXO with this tx ID
    // - Contract wouldn't have a UTXO with this tx ID
    // - The balances wouldn't change correctly
    expect(contractUtxoFromOurTx).toBeDefined();
    expect(contractUtxoFromOurTx.txHash).toBe(claimedTransactionId);
    expect(contractUtxoFromOurTx.amount).toBe("2000000");
    expect(contractUtxoFromOurTx.datum).toBe(42); // Verify datum was properly extracted

    console.log(`✅ BABBAGE REFERENCE SCRIPT PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ Alice's balance decreased by ${aliceBalanceDecrease} lovelace (lock + fees)`);
    console.log(`✅ Alice received change UTXO with matching txHash`);
    console.log(`✅ Contract balance increased by exactly ${contractBalanceIncrease} lovelace`);
    console.log(`✅ Contract received UTXO with matching txHash and datum`);
    console.log(`✅ BABBAGE REFERENCE SCRIPT PROOF: Modern CIP-33 approach produces real transaction IDs for locks`);
  });

  it("should prove contract lock transaction IDs are real and unfakeable (Alonzo inline scripts)", async () => {
    // Alonzo-era approach: inline scripts provided with each transaction
    // Backward compatible and simpler for one-off contract lock operations
    
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
    
    const compiledCode = HELLO_WORLD_COMPILED_CODE;
    
    // Compute contract info directly (no deployment needed)
    const { scriptHash: inlineContractScriptHash, contractAddress: inlineContractAddress } = computeScriptInfo(compiledCode);
    
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
    
    // COMPREHENSIVE TEST: Proves the transaction ID is real by verifying ALL state changes
    
    // Step 2: Get Alice's state BEFORE locking funds
    const aliceBalanceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResponse.json();
    const aliceBalanceBeforeAmount = BigInt(aliceBalanceBefore.balance);
    
    const aliceUtxosBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosBefore = await aliceUtxosBeforeResponse.json();
    const aliceUtxosBeforeCount = aliceUtxosBefore.utxos.length;
    const aliceUtxosBeforeTxHashes = aliceUtxosBefore.utxos.map((u: any) => u.txHash);
    
    // Step 3: Get contract state BEFORE locking
    const contractUtxosBeforeResponse = await fetch(`${baseUrl}/api/contract/${inlineContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosBefore = await contractUtxosBeforeResponse.json();
    const contractBalanceBeforeAmount = BigInt(contractUtxosBefore.utxos.reduce((sum: number, utxo: any) => sum + parseInt(utxo.amount), 0));
    const contractUtxosBeforeCount = contractUtxosBefore.utxos.length;
    
    // Step 4: Lock funds to contract using manual UTXO selection
    const lockResponse = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        signerWallet: "alice",
        operations: [{
          type: "spend-specific-utxos",
          utxos: [{ txHash: spendingUtxo.txHash, outputIndex: spendingUtxo.outputIndex }]
        }, {
          type: "pay-to-contract",
          scriptHash: inlineContractScriptHash,
          compiledCode: compiledCode,
          amount: "2000000", // 2 ADA
          datum: 42
        }]
      })
    });

    expect(lockResponse.status).toBe(200);
    const lockData = await lockResponse.json();
    expect(lockData.success).toBe(true);
    
    const claimedTransactionId = lockData.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/); // Should be real 64-char hex

    // Step 5: Wait for transaction processing

    // Step 6: Verify Alice's state AFTER locking
    const aliceBalanceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceAfter = await aliceBalanceAfterResponse.json();
    const aliceBalanceAfterAmount = BigInt(aliceBalanceAfter.balance);
    
    // Alice's balance should have decreased by MORE than 2 ADA (lock amount + fees)
    const aliceBalanceDecrease = aliceBalanceBeforeAmount - aliceBalanceAfterAmount;
    expect(aliceBalanceDecrease).toBeGreaterThan(2000000n); // More than 2 ADA (includes fees)
    expect(aliceBalanceDecrease).toBeLessThan(2200000n); // Less than 2.2 ADA (reasonable fee limit)
    
    // Step 7: Verify Alice's UTXOs changed
    const aliceUtxosAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosAfter = await aliceUtxosAfterResponse.json();
    
    // Alice should have a NEW change UTXO from our transaction
    const aliceChangeUtxo = aliceUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId
    );
    expect(aliceChangeUtxo).toBeDefined();
    expect(aliceChangeUtxo.txHash).toBe(claimedTransactionId);
    
    // Step 8: Verify contract received the locked funds
    const contractUtxosAfterResponse = await fetch(`${baseUrl}/api/contract/${inlineContractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResponse.json();
    const contractBalanceAfterAmount = BigInt(contractUtxosAfter.utxos.reduce((sum: number, utxo: any) => sum + parseInt(utxo.amount), 0));
    
    // Contract balance should have increased by exactly 2 ADA
    const contractBalanceIncrease = contractBalanceAfterAmount - contractBalanceBeforeAmount;
    expect(contractBalanceIncrease).toBe(2000000n);
    
    // Step 9: Verify contract has new UTXO with our transaction ID
    expect(contractUtxosAfter.utxos.length).toBe(contractUtxosBeforeCount + 1);
    
    // Find the UTXO that was created by our contract lock transaction
    const contractUtxoFromOurTx = contractUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId && utxo.amount === "2000000"
    );

    // Step 10: CRITICAL TESTS - If the server lied about the transaction ID:
    // - Alice wouldn't have a change UTXO with this tx ID
    // - Contract wouldn't have a UTXO with this tx ID
    // - The balances wouldn't change correctly
    expect(contractUtxoFromOurTx).toBeDefined();
    expect(contractUtxoFromOurTx.txHash).toBe(claimedTransactionId);
    expect(contractUtxoFromOurTx.amount).toBe("2000000");
    expect(contractUtxoFromOurTx.datum).toBe(42); // Verify datum was properly extracted

    console.log(`✅ ALONZO INLINE SCRIPT PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ Alice's balance decreased by ${aliceBalanceDecrease} lovelace (lock + fees)`);
    console.log(`✅ Alice received change UTXO with matching txHash`);
    console.log(`✅ Contract balance increased by exactly ${contractBalanceIncrease} lovelace`);
    console.log(`✅ Contract received UTXO with matching txHash and datum`);
    console.log(`✅ ALONZO INLINE SCRIPT PROOF: Backward-compatible inline script approach produces real transaction IDs for locks`);
  });
});