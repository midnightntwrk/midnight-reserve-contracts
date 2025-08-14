import { beforeAll, afterAll } from "bun:test";
import { createServer } from "./src/server";
import { SessionManager } from "./src/utils/session-manager";

// Global shared instances
let globalServer: any = null;
let globalSessionManager: SessionManager | null = null;

beforeAll(async () => {
  console.log("🌍 GLOBAL SETUP: Starting shared server for all tests");
  
  // Create single SessionManager instance shared across all tests
  globalSessionManager = new SessionManager();
  
  // Create single server instance shared across all tests
  globalServer = await createServer(globalSessionManager);
  
  // Make them available globally
  (global as any).testServer = globalServer;
  (global as any).testSessionManager = globalSessionManager;
  
  console.log("🌍 GLOBAL SETUP: Shared server started on localhost:3001");
});

afterAll(async () => {
  console.log("🌍 GLOBAL TEARDOWN: Closing shared server");
  
  if (globalServer) {
    await globalServer.close();
    globalServer = null;
  }
  
  globalSessionManager = null;
  (global as any).testServer = null;
  (global as any).testSessionManager = null;
  
  console.log("🌍 GLOBAL TEARDOWN: Shared server closed");
});

// Export for TypeScript typing
declare global {
  var testServer: any;
  var testSessionManager: SessionManager;
}