import { describe, it, expect, beforeEach } from "bun:test";

describe("Phase 3: Multi-Input Contract Transactions", () => {
  const baseUrl = "http://localhost:3001";
  let sessionId: string;
  let contractScriptHash: string;

  // Note: Using shared server and SessionManager from global test setup

  beforeEach(async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    sessionId = sessionData.sessionId;

    // Register wallets with funding
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
        initialBalance: "15000000" // 15 ADA
      })
    });

    // Deploy contract for output destination
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
    contractScriptHash = deployData.contractId;
  });

  it("should consume from multiple wallets and create 50/50 split outputs at contract", async () => {
    // Get initial balances
    const aliceBeforeResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceBeforeData = await aliceBeforeResponse.json();
    const aliceBalanceBefore = BigInt(aliceBeforeData.balance);

    const bobBeforeResponse = await fetch(`${baseUrl}/api/wallet/bob/balance?sessionId=${sessionId}`);
    const bobBeforeData = await bobBeforeResponse.json();
    const bobBalanceBefore = BigInt(bobBeforeData.balance);

    const contractBeforeResponse = await fetch(`${baseUrl}/api/contract/${contractScriptHash}/balance?sessionId=${sessionId}`);
    const contractBeforeData = await contractBeforeResponse.json();
    const contractBalanceBefore = BigInt(contractBeforeData.balance);

    // Multi-output transaction: spend from alice (8 ADA total available)
    // Create 50/50 split: 3 ADA + 3 ADA to contract = 6 ADA + fees (~0.2 ADA) = ~6.2 ADA total
    const response = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [
          {
            type: "spend-from-wallet",
            walletName: "alice",
            amount: "8000000" // 8 ADA from alice (within her 10 ADA limit)
          },
          {
            type: "pay-to-contract",
            contractAddress: contractScriptHash,
            amount: "3000000", // 3 ADA (50% of 6 ADA)
            datum: 100
          },
          {
            type: "pay-to-contract",
            contractAddress: contractScriptHash, 
            amount: "3000000", // 3 ADA (50% of 6 ADA)
            datum: 200
          }
        ]
      })
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.transactionId).toMatch(/^[a-f0-9]{64}$/); // Real transaction ID
    expect(data.operationsExecuted).toBe(3);

    // Verify alice spent 6 ADA + fees (3 + 3 ADA to contract + transaction fees)
    const aliceAfterResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    const aliceAfterData = await aliceAfterResponse.json();
    const aliceBalanceAfter = BigInt(aliceAfterData.balance);
    expect(aliceBalanceAfter).toBeLessThan(aliceBalanceBefore - 6000000n);

    // Verify bob's balance unchanged (not involved in transaction)
    const bobAfterResponse = await fetch(`${baseUrl}/api/wallet/bob/balance?sessionId=${sessionId}`);
    const bobAfterData = await bobAfterResponse.json();
    const bobBalanceAfter = BigInt(bobAfterData.balance);
    expect(bobBalanceAfter).toBe(bobBalanceBefore);

    // Verify contract received exactly 6 ADA total (3 + 3)
    const contractAfterResponse = await fetch(`${baseUrl}/api/contract/${contractScriptHash}/balance?sessionId=${sessionId}`);
    const contractAfterData = await contractAfterResponse.json();
    const contractBalanceAfter = BigInt(contractAfterData.balance);
    expect(contractBalanceAfter).toBe(contractBalanceBefore + 6000000n);
  });
});