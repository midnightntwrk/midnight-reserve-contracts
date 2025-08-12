import { describe, test, expect } from "bun:test";
import { SessionManager } from "../../utils/session-manager";
import { makeValue } from "@blaze-cardano/sdk";

describe("Phase 2.1: Session Manager", () => {
  test("should instantiate SessionManager", () => {
    const sessionManager = new SessionManager();
    
    expect(sessionManager).toBeDefined();
    expect(sessionManager).toBeInstanceOf(SessionManager);
  });

  test("should create a session", async () => {
    const sessionManager = new SessionManager();
    const session = await sessionManager.createSession();
    
    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
  });

  test("should create session with emulator that can register accounts", async () => {
    const sessionManager = new SessionManager();
    const session = await sessionManager.createSession();
    
    const alice = await session.emulator.register("alice", makeValue(100_000_000n));
    expect(alice).toBeDefined();
  });

  test("should get current session and validate session ID", async () => {
    const sessionManager = new SessionManager();
    const session = await sessionManager.createSession();
    
    const currentSession = sessionManager.getCurrentSession();
    expect(currentSession).toBeDefined();
    expect(currentSession?.id).toBe(session.id);
    
    // Client can validate their session ID against current session
    expect(currentSession?.id).toBe(session.id);
  });

  test("should return null when no session exists", () => {
    const sessionManager = new SessionManager();
    
    const currentSession = sessionManager.getCurrentSession();
    expect(currentSession).toBeNull();
  });
});
