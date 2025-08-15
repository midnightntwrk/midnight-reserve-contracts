#!/usr/bin/env node

import { createServer } from "./server";
import { SessionManager } from "./utils/session-manager";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3031;
const NODE_ENV = process.env.NODE_ENV || "development";

let globalServer: any = null;
let globalSessionManager: SessionManager | null = null;

async function startServer() {
  try {
    console.log(`🚀 Starting Blaze Server Backend in ${NODE_ENV} mode...`);
    
    // Initialize session manager
    globalSessionManager = new SessionManager();
    
    // Create and start server
    globalServer = await createServer(globalSessionManager) as any;
    
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📋 API Documentation: http://localhost:${PORT}/api`);
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 Received SIGTERM, shutting down gracefully...');
      stopServer();
    });
    
    process.on('SIGINT', () => {
      console.log('🛑 Received SIGINT, shutting down gracefully...');
      stopServer();
    });
    
    return `http://localhost:${PORT}`;
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    throw error;
  }
}

async function stopServer() {
  if (globalServer) {
    console.log('🛑 Shutting down server...');
    return new Promise<void>((resolve) => {
      globalServer.close(() => {
        console.log('✅ Server closed');
        globalServer = null;
        globalSessionManager = null;
        resolve();
      });
    });
  }
}

// Start the server if this file is executed directly
if (require.main === module) {
  startServer();
}

export { startServer, stopServer };