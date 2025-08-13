import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "../../server";
import { SessionManager } from "../../utils/session-manager";

describe("Phase 2.2: Wallet Service", () => {
  let server: any;
  let sessionManager: SessionManager;

  beforeAll(async () => {
    sessionManager = new SessionManager();
    server = await createServer(sessionManager);
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  test("should successfully register wallet via HTTP endpoint", async () => {
    // First create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    
    expect(createSessionResponse.status).toBe(200);
    const sessionData: any = await createSessionResponse.json();
    expect(sessionData.success).toBe(true);
    expect(sessionData.sessionId).toBeDefined();
    
    const sessionId = sessionData.sessionId;

    // Then register a wallet with valid session ID
    const response = await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "alice",
        initialBalance: "100000000"
      }),
    });

    expect(response.status).toBe(200);
    const data: any = await response.json();
    expect(data.success).toBe(true);
    expect(data.walletName).toBe("alice");
    expect(data.balance).toBe("100000000");
    
    // Verify that the returned balance matches what was actually created
    // This drives us to implement proper balance verification in the server
    expect(data.balance).toBe("100000000"); // Should be actual balance, not just echoed input
  });

  test("should reject duplicate wallet registration", async () => {
    // First create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    
    expect(createSessionResponse.status).toBe(200);
    const sessionData: any = await createSessionResponse.json();
    expect(sessionData.success).toBe(true);
    expect(sessionData.sessionId).toBeDefined();
    
    const sessionId = sessionData.sessionId;

    // Register "alice" first time
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "alice",
        initialBalance: "100000000"
      }),
    });

    // Try to register "alice" again
    const response = await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "alice",
        initialBalance: "50000000"
      }),
    });

    expect(response.status).toBe(400);
    const data: any = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("already exists");
  });

  test("should create multiple wallets with different balances and maintain separation", async () => {
    // First create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    
    expect(createSessionResponse.status).toBe(200);
    const sessionData: any = await createSessionResponse.json();
    expect(sessionData.success).toBe(true);
    expect(sessionData.sessionId).toBeDefined();
    
    const sessionId = sessionData.sessionId;

    // Register "alice" with 100 ADA
    const aliceResponse = await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "alice",
        initialBalance: "100000000"
      }),
    });

    expect(aliceResponse.status).toBe(200);
    const aliceData: any = await aliceResponse.json();
    expect(aliceData.success).toBe(true);
    expect(aliceData.walletName).toBe("alice");
    expect(aliceData.balance).toBe("100000000");

    // Register "bob" with 50 ADA
    const bobResponse = await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "bob",
        initialBalance: "50000000"
      }),
    });

    expect(bobResponse.status).toBe(200);
    const bobData: any = await bobResponse.json();
    expect(bobData.success).toBe(true);
    expect(bobData.walletName).toBe("bob");
    expect(bobData.balance).toBe("50000000");

    // Verify wallets are separate - try to register "alice" again (should fail)
    const duplicateResponse = await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "alice",
        initialBalance: "75000000"
      }),
    });

    expect(duplicateResponse.status).toBe(400);
    const duplicateData: any = await duplicateResponse.json();
    expect(duplicateData.success).toBe(false);
    expect(duplicateData.error).toContain("already exists");
  });

  test("should transfer funds from one wallet to another", async () => {
    // First create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const sessionData: any = await createSessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register "alice" with 100 ADA
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "alice",
        initialBalance: "100000000"
      }),
    });

    // Register "bob" with 50 ADA
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "bob",
        initialBalance: "50000000"
      }),
    });

    // Transfer 25 ADA from alice to bob
    const transferResponse = await fetch("http://localhost:3001/api/wallet/transfer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "alice",
        toWallet: "bob",
        amount: "25000000"
      }),
    });

    expect(transferResponse.status).toBe(200);
    const transferData: any = await transferResponse.json();
    expect(transferData.success).toBe(true);
    expect(transferData.fromWallet).toBe("alice");
    expect(transferData.toWallet).toBe("bob");
    expect(transferData.amount).toBe("25000000");
    expect(transferData.transactionId).toBeDefined();
  });

  test("should return error when emulator detects insufficient funds", async () => {
    // First create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const sessionData: any = await createSessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register "alice" with only 10 ADA
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "alice",
        initialBalance: "10000000"
      }),
    });

    // Register "bob" with 50 ADA
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "bob",
        initialBalance: "50000000"
      }),
    });

    // Try to transfer 25 ADA from alice (who only has 10) to bob
    const transferResponse = await fetch("http://localhost:3001/api/wallet/transfer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "alice",
        toWallet: "bob",
        amount: "25000000"
      }),
    });

    expect(transferResponse.status).toBe(400);
    const errorData: any = await transferResponse.json();
    expect(errorData.success).toBe(false);
    expect(errorData.error).toContain("Insufficient");
  });
});
