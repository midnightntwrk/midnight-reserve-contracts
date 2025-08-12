import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "../../server";
import { SessionManager } from "../../utils/session-manager";

describe("Phase 4.1: Core Endpoints", () => {
  let server: any;
  let sessionManager: SessionManager;

  beforeAll(async () => {
    sessionManager = new SessionManager();
    server = createServer(sessionManager);
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  test("should create new session via HTTP endpoint", async () => {
    const response = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.sessionId).toBeDefined();
    expect(data.createdAt).toBeDefined();
  });

  test("should reject requests with invalid session ID", async () => {
    const response = await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "invalid-session-id",
        name: "alice",
        initialBalance: "100000000"
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid session ID");
  });

  test("should get network tip with valid session ID", async () => {
    // First create a session
    const createResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const createData = await createResponse.json();
    const sessionId = createData.sessionId;

    // Then get network tip with valid session ID
    const response = await fetch(`http://localhost:3001/api/network/tip?sessionId=${sessionId}`);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.slot).toBeDefined();
    expect(data.blockHeight).toBeDefined();
  });

  test("should handle client with no session trying to make requests", async () => {
    // Client tries to use network tip without creating session first
    const response = await fetch("http://localhost:3001/api/network/tip?sessionId=some-old-id");
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid session ID");
  });

  test("should handle client with expired session ID", async () => {
    // Create first session
    const createResponse1 = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const session1Data = await createResponse1.json();
    const oldSessionId = session1Data.sessionId;

    // Create new session (destroys old one)
    await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });

    // Client tries to use old session ID
    const response = await fetch(`http://localhost:3001/api/network/tip?sessionId=${oldSessionId}`);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid session ID");
  });
});
