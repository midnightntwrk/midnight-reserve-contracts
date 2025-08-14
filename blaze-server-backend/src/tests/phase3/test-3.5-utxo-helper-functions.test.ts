import { describe, it, expect, beforeEach } from "bun:test";

describe("Phase 3.5: UTXO Helper Functions", () => {
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

    // Register test wallet with funding
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

    // Lock funds with datum to create contract UTXO
    await fetch(`${baseUrl}/api/contract/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        fromWallet: "alice",
        contractAddress,
        amount: "3000000", // 3 ADA
        datum: 123
      })
    });
  });

  it("should extract datum and datumHash from contract UTXOs", async () => {
    // TDD Red Phase: Test that contract UTXO discovery includes proper datum extraction
    const response = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.utxos.length).toBeGreaterThan(0);
    
    const utxo = data.utxos[0];
    
    // Test datum extraction helper function
    expect(utxo.datum).toBe(123); // Should extract the actual datum value
    expect(utxo.datumHash).toBeDefined(); // Should provide datum hash
    expect(typeof utxo.datumHash).toBe("string"); // Should be a hex string
    expect(utxo.datumHash.length).toBeGreaterThan(0); // Should not be empty
  });
});