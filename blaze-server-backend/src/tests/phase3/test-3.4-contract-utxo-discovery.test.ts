import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createServer } from "../../server";
import { SessionManager } from "../../utils/session-manager";

describe("Phase 3.4: Contract UTXO Discovery", () => {
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

    // Deploy contract and get its address
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

    // Lock some funds to the contract to create UTXOs
    await fetch(`${baseUrl}/api/contract/lock`, {
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
  });

  it("should discover contract UTXOs", async () => {
    // TDD Red Phase: Single failing test for contract UTXO discovery endpoint
    const response = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.utxos).toBeDefined();
    expect(Array.isArray(data.utxos)).toBe(true);
    expect(data.utxos.length).toBeGreaterThan(0);
    
    // Verify UTXO structure includes contract-specific fields
    const utxo = data.utxos[0];
    expect(utxo.txHash).toBeDefined();
    expect(typeof utxo.outputIndex).toBe("number");
    expect(utxo.address).toBe(contractAddress);
    expect(utxo.amount).toBe("2000000");
    expect(utxo.datum).toBeDefined(); // Contract UTXOs should have datum
  });
});