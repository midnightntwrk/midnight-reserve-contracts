import { beforeAll, afterAll } from "bun:test";
import { createServer } from "./src/server";
import { SessionManager } from "./src/utils/session-manager";

// Global shared instances
let globalServer: any = null;
let globalSessionManager: SessionManager | null = null;

// Graceful shutdown handler
async function gracefulShutdown() {
  console.log("🌍 EMERGENCY SHUTDOWN: Forcefully cleaning up resources");
  
  if (globalServer) {
    try {
      await Promise.race([
        globalServer.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000))
      ]);
    } catch (error) {
      console.log("🌍 EMERGENCY SHUTDOWN: Force closing server");
      try {
        globalServer.closeAllConnections?.();
        globalServer.unref?.();
      } catch (e) {
        // Force exit if nothing else works
      }
    }
    globalServer = null;
  }
  
  globalSessionManager = null;
  (global as any).testServer = null;
  (global as any).testSessionManager = null;
}

beforeAll(async () => {
  console.log("🌍 GLOBAL SETUP: Starting shared server for all tests");
  
  // Check if port is already in use and clean up
  try {
    const response = await fetch("http://localhost:3031/api/session/new", {
      method: "POST",
      signal: AbortSignal.timeout(1000)
    });
    if (response.ok) {
      console.log("🌍 GLOBAL SETUP: Port 3031 appears to be in use, attempting cleanup");
      // Port is in use, try to clean up
      await gracefulShutdown();
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    // Expected if port is free - this is good
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