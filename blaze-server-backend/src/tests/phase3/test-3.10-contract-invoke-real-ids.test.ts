import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createServer } from "../../server";
import { SessionManager } from "../../utils/session-manager";

describe("Phase 3.10: Contract Invoke Real Transaction IDs", () => {
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
        contractName: "hello_world",
        compiledCode: "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009"
      })
    });
    const deployData = await deployResponse.json();
    contractAddress = deployData.contractAddress;

    // Lock funds to contract first (needed for invoke to have something to unlock)
    await fetch(`${baseUrl}/api/contract/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        fromWallet: "alice",
        contractAddress,
        amount: "3000000", // 3 ADA
        datum: 42 // This redeemer will unlock the UTXO
      })
    });
  });

  it("should prove contract invoke transaction IDs are real and unfakeable", async () => {
    // TDD Red Phase: Test that will FAIL if /api/contract/invoke returns fake transaction IDs
    
    // Step 1: First check contract has the locked UTXO before invoking
    const contractUtxosBeforeResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    const contractUtxosBefore = await contractUtxosBeforeResponse.json();
    expect(contractUtxosBefore.utxos.length).toBe(1); // Should have our locked UTXO
    expect(contractUtxosBefore.utxos[0].amount).toBe("3000000"); // The 3 ADA we locked
    
    // Step 2: Get Alice's balance before invoke
    const aliceBalanceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceBefore = await aliceBalanceBeforeResponse.json();
    const balanceBefore = BigInt(aliceBalanceBefore.balance);
    
    // Step 3: Invoke contract and get server's claimed transaction ID
    const invokeResponse = await fetch(`${baseUrl}/api/contract/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        fromWallet: "alice",
        contractAddress: contractAddress, // Use the actual contract address
        redeemer: 42 // This should unlock the UTXO we locked
      })
    });

    if (invokeResponse.status !== 200) {
      const errorData = await invokeResponse.json();
      console.log("Invoke error:", errorData);
    }
    expect(invokeResponse.status).toBe(200);
    const invokeData = await invokeResponse.json();
    expect(invokeData.success).toBe(true);
    
    const claimedTransactionId = invokeData.transactionId;
    expect(claimedTransactionId).toMatch(/^[a-f0-9]{64}$/); // Should be real 64-char hex

    // Step 4: Transaction should be fully processed (emulator is immediately consistent)

    // Step 5: Verify contract UTXO was consumed (no longer exists)
    const contractUtxosAfterResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    
    if (contractUtxosAfterResponse.status !== 200) {
      const errorText = await contractUtxosAfterResponse.text();
      console.log(`❌ Contract UTXO query failed with status ${contractUtxosAfterResponse.status}: ${errorText}`);
    }
    expect(contractUtxosAfterResponse.status).toBe(200);
    
    const contractUtxosAfter = await contractUtxosAfterResponse.json();
    
    if (!contractUtxosAfter.success) {
      console.log(`❌ Contract UTXO query returned error:`, contractUtxosAfter);
    }
    expect(contractUtxosAfter.success).toBe(true);
    expect(contractUtxosAfter.utxos.length).toBe(0); // Contract UTXO should be consumed

    // Step 6: Check Alice's wallet UTXOs - the contract invoke should have sent funds back to Alice
    const aliceUtxosResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    expect(aliceUtxosResponse.status).toBe(200);
    const aliceUtxosData = await aliceUtxosResponse.json();
    expect(aliceUtxosData.success).toBe(true);

    // Step 7: Find the UTXO that was created by our contract invoke transaction
    // This UTXO should contain the unlocked funds from the contract
    const utxoFromOurTransaction = aliceUtxosData.utxos.find(
      (utxo: any) => utxo.txHash === claimedTransactionId
    );

    // Step 8: CRITICAL TEST - If the server lied about the transaction ID,
    // then no UTXO would have that transaction hash and this would fail
    expect(utxoFromOurTransaction).toBeDefined();
    expect(utxoFromOurTransaction.txHash).toBe(claimedTransactionId);
    
    // Step 9: Verify Alice's balance increased (got the locked funds back minus fees)
    const aliceBalanceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBalanceAfter = await aliceBalanceAfterResponse.json();
    const balanceAfter = BigInt(aliceBalanceAfter.balance);
    
    // Alice should have received back close to the 3 ADA that was locked (minus tx fees)
    const balanceIncrease = balanceAfter - balanceBefore;
    expect(balanceIncrease).toBeGreaterThan(2800000n); // At least 2.8 ADA back (accounting for fees)
    expect(balanceIncrease).toBeLessThanOrEqual(3000000n); // At most 3 ADA back

    console.log(`✅ CONTRACT INVOKE PROOF: Transaction ID ${claimedTransactionId} is REAL`);
    console.log(`✅ CONTRACT INVOKE PROOF: Contract UTXO was consumed (no longer exists)`);
    console.log(`✅ CONTRACT INVOKE PROOF: Found Alice's UTXO with matching txHash`);
    console.log(`✅ CONTRACT INVOKE PROOF: Alice received back ~${balanceIncrease} lovelace from unlocked contract`);
    console.log(`✅ CONTRACT INVOKE PROOF: Server cannot fake contract invoke transaction IDs`);
  });
});