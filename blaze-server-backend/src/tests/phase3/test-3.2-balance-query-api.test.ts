import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createServer } from "../../server";
import { SessionManager } from "../../utils/session-manager";

describe("Phase 3.2: Balance Query API", () => {
  const baseUrl = "http://localhost:3001";
  let server: any;
  let sessionManager: SessionManager;
  let sessionId: string;

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

    // Deploy contract for contract balance tests
    await fetch(`${baseUrl}/api/contract/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        deployerWallet: "alice",
        contractName: "hello_world",
        compiledCode: "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009"
      })
    });
  });

  it("should query wallet balance", async () => {
    const response = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.balance).toBeDefined();
    expect(data.balance).toBe("10000000"); // Alice was registered with 10 ADA
  });

  it("should reject invalid session ID", async () => {
    const response = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=invalid-session`);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid session ID");
  });

  it("should reject non-existent wallet", async () => {
    const response = await fetch(`${baseUrl}/api/wallet/nonexistent/balance?sessionId=${sessionId}`);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("does not exist");
  });

  it("should query contract balance", async () => {
    // Query contract balance using contract name (should be 0 initially)
    const response = await fetch(`${baseUrl}/api/contract/hello_world/balance?sessionId=${sessionId}`);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.balance).toBeDefined();
    expect(data.balance).toBe("0"); // No ADA locked in contract initially
  });
});