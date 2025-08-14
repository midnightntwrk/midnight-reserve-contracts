import { describe, it, expect, beforeEach } from "bun:test";

describe("Phase 3.3: Wallet UTXO Discovery", () => {
  // Note: Using shared server and SessionManager from global test setup

  const baseUrl = "http://localhost:3031";
  let sessionId: string;


  beforeEach(async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    sessionId = sessionData.sessionId;

    // Register test wallet with initial UTXOs
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "10000000" // 10 ADA - creates initial UTXO(s)
      })
    });
  });

  it("should discover wallet UTXOs", async () => {
    // TDD Red Phase: Single failing test for wallet UTXO discovery endpoint
    const response = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.utxos).toBeDefined();
    expect(Array.isArray(data.utxos)).toBe(true);
    expect(data.utxos.length).toBeGreaterThan(0);
  });
});