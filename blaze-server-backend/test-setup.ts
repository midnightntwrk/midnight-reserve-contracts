import { beforeAll, afterAll } from "bun:test";
import { createServer } from "./src/server";
import { SessionManager } from "./src/utils/session-manager";

// Global shared instances
let globalServer: any = null;
let globalSessionManager: SessionManager | null = null;

// Graceful shutdown handler
async function gracefulShutdown() {
  console.log("🌍 EMERGENCY SHUTDOWN: Starting cleanup...");
  
  if (globalServer) {
    console.log("🌍 EMERGENCY SHUTDOWN: Found globalServer, attempting to close...");
    try {
      console.log("🌍 EMERGENCY SHUTDOWN: Calling globalServer.close() with 2s timeout...");
      await Promise.race([
        globalServer.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000))
      ]);
      console.log("🌍 EMERGENCY SHUTDOWN: globalServer.close() completed successfully");
    } catch (error) {
      console.log("🌍 EMERGENCY SHUTDOWN: globalServer.close() failed or timed out:", error);
      console.log("🌍 EMERGENCY SHUTDOWN: Attempting force close...");
      try {
        globalServer.closeAllConnections?.();
        globalServer.unref?.();
        console.log("🌍 EMERGENCY SHUTDOWN: Force close methods called");
      } catch (e) {
        console.log("🌍 EMERGENCY SHUTDOWN: Force close methods failed:", e);
      }
    }
    globalServer = null;
    console.log("🌍 EMERGENCY SHUTDOWN: globalServer set to null");
  } else {
    console.log("🌍 EMERGENCY SHUTDOWN: No globalServer found");
  }
  
  globalSessionManager = null;
  (global as any).testServer = null;
  (global as any).testSessionManager = null;
  console.log("🌍 EMERGENCY SHUTDOWN: Cleanup completed");
}

beforeAll(async () => {
  console.log("🌍 GLOBAL SETUP: Starting shared server for all tests");
  
  // Check if port is already in use - if so, fail immediately
  console.log("🌍 GLOBAL SETUP: Checking if port 3031 is in use...");
  try {
    console.log("🌍 GLOBAL SETUP: Attempting to connect to existing server...");
    const response = await fetch("http://localhost:3031/api/session/new", {
      method: "POST",
      signal: AbortSignal.timeout(1000)
    });
    console.log("🌍 GLOBAL SETUP: Got response:", response.status, response.ok);
    if (response.ok) {
      console.error("🌍 GLOBAL SETUP: ERROR - Port 3031 is already in use by another process");
      console.error("🌍 GLOBAL SETUP: Please stop the development server (bun run --watch) before running tests");
      throw new Error("Port 3031 is already in use. Cannot run tests while development server is running.");
    }
  } catch (error: any) {
    if (error.message && error.message.includes("Port 3031 is already in use")) {
      throw error; // Re-throw our specific error
    }
    // Otherwise, port is free (connection failed) - this is what we want
    console.log("🌍 GLOBAL SETUP: Port 3031 is free, proceeding with test server setup");
  }
  
  // Create single SessionManager instance shared across all tests
  globalSessionManager = new SessionManager();
  
  // Create single server instance shared across all tests
  try {
    globalServer = await createServer(globalSessionManager);
    
    // Make them available globally
    (global as any).testServer = globalServer;
    (global as any).testSessionManager = globalSessionManager;
    
    console.log("🌍 GLOBAL SETUP: Shared server started on localhost:3031");
  } catch (error) {
    console.error("🌍 GLOBAL SETUP: Failed to start server:", error);
    await gracefulShutdown();
    throw error;
  }
});

afterAll(async () => {
  console.log("🌍 GLOBAL TEARDOWN: Closing shared server");
  await gracefulShutdown();
  console.log("🌍 GLOBAL TEARDOWN: Shared server closed");
});

// Handle process termination gracefully
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', async (error) => {
  console.error("🌍 UNCAUGHT EXCEPTION:", error);
  await gracefulShutdown();
  process.exit(1);
});
process.on('unhandledRejection', async (reason) => {
  console.error("🌍 UNHANDLED REJECTION:", reason);
  await gracefulShutdown();
  process.exit(1);
});

// Export for TypeScript typing
declare global {
  var testServer: any;
  var testSessionManager: SessionManager;
}