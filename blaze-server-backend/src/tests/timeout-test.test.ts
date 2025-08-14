import { describe, it, expect } from "bun:test";

describe("Timeout Performance Test", () => {
  const baseUrl = "http://localhost:3001";

  it("should work without timeout delays", async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register wallet
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000"
      })
    });
    
    const compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";

    // Deploy contract
    const deployResponse = await fetch(`${baseUrl}/api/contract/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        deployerWallet: "alice",
        compiledCode
      })
    });
    const deployData = await deployResponse.json();
    const contractAddress = deployData.contractAddress;

    // Lock funds
    const lockResponse = await fetch(`${baseUrl}/api/contract/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        fromWallet: "alice",
        contractAddress,
        amount: "3000000",
        datum: "42"
      })
    });
    
    expect(lockResponse.status).toBe(200);
    const lockData = await lockResponse.json();
    expect(lockData.success).toBe(true);

    // NO TIMEOUT HERE - test immediate access

    // Check contract balance immediately
    const balanceResponse = await fetch(`${baseUrl}/api/contract/${deployData.contractId}/balance?sessionId=${sessionId}`);
    expect(balanceResponse.status).toBe(200);
    const balanceData = await balanceResponse.json();
    expect(balanceData.balance).toBe("3000000");

    console.log("✅ Emulator transactions are synchronous - no timeout needed!");
  });
});