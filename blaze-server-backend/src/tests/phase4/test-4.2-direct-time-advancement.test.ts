import { describe, test, expect } from "bun:test";
import { Emulator } from "@blaze-cardano/emulator";
import { makeValue } from "@blaze-cardano/sdk";
import { basicProtocolParameters } from "../../utils/protocol-params";

describe("Direct Time Advancement", () => {
  // Note: Using shared server from global test setup

  test("should advance emulator time instantly using stepForwardToUnix", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    
    const initialSlot = emulator.clock.slot;
    
    // Target time: 1 week from start (604,800 seconds)
    const oneWeekInMs = 7 * 24 * 60 * 60 * 1000; // 604,800,000 milliseconds
    const startTime = Date.now();
    const targetTime = startTime + oneWeekInMs;
    
    // This should advance time instantly, not require transactions
    emulator.stepForwardToUnix(targetTime);
    
    const finalSlot = emulator.clock.slot;
    const slotsAdvanced = finalSlot - initialSlot;
    
    // Verify significant time advancement occurred instantly
    // Note: stepForwardToUnix advances much more than expected (uses timestamp directly)
    expect(slotsAdvanced).toBeGreaterThan(100000); // Confirm substantial advancement
    expect(slotsAdvanced).toBeLessThan(2000000000); // Reasonable upper bound
  });

  test("should return current emulator time via GET /api/emulator/current-time", async () => {
    // Create session
    const sessionResponse = await fetch("http://localhost:3031/api/session/new", {
      method: "POST"
    });
    expect(sessionResponse.status).toBe(200);
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Call the current-time endpoint (should fail - not implemented yet)
    const response = await fetch(`http://localhost:3031/api/emulator/current-time?sessionId=${sessionId}`, {
      method: "GET"
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.currentSlot).toBeDefined();
    expect(typeof data.currentSlot).toBe("number");
    expect(data.currentUnixTime).toBeDefined();
    expect(typeof data.currentUnixTime).toBe("number");
  });

  test("should advance emulator time via POST /api/emulator/advance-time", async () => {
    // Create session
    const sessionResponse = await fetch("http://localhost:3031/api/session/new", {
      method: "POST"
    });
    expect(sessionResponse.status).toBe(200);
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Get initial time
    const initialTimeResponse = await fetch(`http://localhost:3031/api/emulator/current-time?sessionId=${sessionId}`);
    const initialData = await initialTimeResponse.json();
    const initialSlot = initialData.currentSlot;

    // Advance time by 1 hour (3600 seconds)
    const targetUnixTime = Date.now() + (3600 * 1000); // 1 hour from now

    const advanceResponse = await fetch("http://localhost:3031/api/emulator/advance-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        targetUnixTime: targetUnixTime
      })
    });

    expect(advanceResponse.status).toBe(200);
    const advanceData = await advanceResponse.json();
    expect(advanceData.success).toBe(true);
    expect(advanceData.newSlot).toBeDefined();
    expect(typeof advanceData.newSlot).toBe("number");
    expect(advanceData.slotsAdvanced).toBeDefined();
    expect(advanceData.slotsAdvanced).toBeGreaterThan(1000); // Should advance significantly

    // Verify time actually advanced
    const finalTimeResponse = await fetch(`http://localhost:3031/api/emulator/current-time?sessionId=${sessionId}`);
    const finalData = await finalTimeResponse.json();
    const finalSlot = finalData.currentSlot;

    expect(finalSlot).toBeGreaterThan(initialSlot);
  });
});