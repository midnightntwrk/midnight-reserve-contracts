import { describe, it, expect, beforeEach } from "bun:test";

describe("Phase 3.9: Contract Lock Real Transaction IDs", () => {
  // Note: Using shared server and SessionManager from global test setup

  const baseUrl = "http://localhost:3001";
  let sessionId: string;
  let contractAddress: string;
  let contractScriptHash: string;


  beforeEach(async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    sessionId = sessionData.sessionId;

    // Register test wallet
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
        compiledCode: "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009"
      })
    });
    const deployData = await deployResponse.json();
    contractAddress = deployData.contractAddress;
    contractScriptHash = deployData.contractId;
  });

  it("should prove contract lock transaction IDs are real and unfakeable", async () => {
    // COMPREHENSIVE TEST: Proves the transaction ID is real by verifying ALL state changes
    
    // Step 1: Get Alice's state BEFORE locking funds
    const aliceBalanceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResponse.json();
    const aliceBalanceBeforeAmount = BigInt(aliceBalanceBefore.balance);
    
    const aliceUtxosBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosBefore = await aliceUtxosBeforeResponse.json();
    const aliceUtxosBeforeCount = aliceUtxosBefore.utxos.length;
    const aliceUtxosBeforeTxHashes = aliceUtxosBefore.utxos.map((u: any) => u.txHash);
    
    // Step 2: Get contract state BEFORE locking
    const contractBalanceBeforeResponse = await fetch(`${baseUrl}/api/contract/${contractScriptHash}/balance?sessionId=${sessionId}`);
    const contractBalanceBefore = await contractBalanceBeforeResponse.json();
    const contractBalanceBeforeAmount = BigInt(contractBalanceBefore.balance);
    
    const contractUtxosBeforeResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosBefore = await contractUtxosBeforeResponse.json();
    const contractUtxosBeforeCount = contractUtxosBefore.utxos.length;
    
    // Step 3: Lock funds to contract and get server's claimed transaction ID
    const lockResponse = await fetch(`${baseUrl}/api/contract/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        fromWallet: "alice",
        contractAddress,
        amount: "2000000", // 2 ADA
        datum: 42
      })
    });

    expect(lockResponse.status).toBe(200);
    const lockData = await lockResponse.json();
    expect(lockData.success).toBe(true);
    
    const claimedTransactionId = lockData.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/); // Should be real 64-char hex

    // Step 4: Wait for transaction processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Step 5: Verify Alice's state AFTER locking
    const aliceBalanceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceAfter = await aliceBalanceAfterResponse.json();
    const aliceBalanceAfterAmount = BigInt(aliceBalanceAfter.balance);
    
    // Alice's balance should have decreased by MORE than 2 ADA (lock amount + fees)
    const aliceBalanceDecrease = aliceBalanceBeforeAmount - aliceBalanceAfterAmount;
    expect(aliceBalanceDecrease).toBeGreaterThan(2000000n); // More than 2 ADA (includes fees)
    expect(aliceBalanceDecrease).toBeLessThan(2200000n); // Less than 2.2 ADA (reasonable fee limit)
    
    // Step 6: Verify Alice's UTXOs changed
    const aliceUtxosAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosAfter = await aliceUtxosAfterResponse.json();
    
    // Alice's old UTXOs should be consumed (none should remain with old tx hashes)
    const oldUtxosStillPresent = aliceUtxosAfter.utxos.filter((u: any) => 
      aliceUtxosBeforeTxHashes.includes(u.txHash)
    );
    expect(oldUtxosStillPresent.length).toBe(0); // All old UTXOs should be consumed
    
    // Alice should have a NEW change UTXO from our transaction
    const aliceChangeUtxo = aliceUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId
    );
    expect(aliceChangeUtxo).toBeDefined();
    expect(aliceChangeUtxo.txHash).toBe(claimedTransactionId);
    
    // Step 7: Verify contract received the locked funds
    const contractBalanceAfterResponse = await fetch(`${baseUrl}/api/contract/${contractScriptHash}/balance?sessionId=${sessionId}`);
    const contractBalanceAfter = await contractBalanceAfterResponse.json();
    const contractBalanceAfterAmount = BigInt(contractBalanceAfter.balance);
    
    // Contract balance should have increased by exactly 2 ADA
    const contractBalanceIncrease = contractBalanceAfterAmount - contractBalanceBeforeAmount;
    expect(contractBalanceIncrease).toBe(2000000n);
    
    // Step 8: Verify contract has new UTXO with our transaction ID
    const contractUtxosAfterResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosAfter = await contractUtxosAfterResponse.json();
    expect(contractUtxosAfter.utxos.length).toBe(contractUtxosBeforeCount + 1);
    
    // Find the UTXO that was created by our contract lock transaction
    const contractUtxoFromOurTx = contractUtxosAfter.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId && utxo.amount === "2000000"
    );

    // Step 9: CRITICAL TESTS - If the server lied about the transaction ID:
    // - Alice's old UTXOs wouldn't be consumed
    // - Alice wouldn't have a change UTXO with this tx ID
    // - Contract wouldn't have a UTXO with this tx ID
    // - The balances wouldn't change correctly
    expect(contractUtxoFromOurTx).toBeDefined();
    expect(contractUtxoFromOurTx.txHash).toBe(claimedTransactionId);
    expect(contractUtxoFromOurTx.amount).toBe("2000000");
    expect(contractUtxoFromOurTx.datum).toBe(42); // Verify datum was properly extracted

    console.log(`✅ COMPREHENSIVE PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ Alice's balance decreased by ${aliceBalanceDecrease} lovelace (lock + fees)`);
    console.log(`✅ Alice's ${aliceUtxosBeforeCount} old UTXOs were ALL consumed`);
    console.log(`✅ Alice received change UTXO with matching txHash`);
    console.log(`✅ Contract balance increased by exactly ${contractBalanceIncrease} lovelace`);
    console.log(`✅ Contract received UTXO with matching txHash and datum`);
    console.log(`✅ Server CANNOT fake contract lock transaction IDs - all state changes are consistent`);
  });
});