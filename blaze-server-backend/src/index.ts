#!/usr/bin/env node

import { createServer } from "./server";
import { SessionManager } from "./utils/session-manager";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || "development";

async function startServer() {
  try {
    console.log(`🚀 Starting Blaze Server Backend in ${NODE_ENV} mode...`);
    
    // Initialize session manager
    const sessionManager = new SessionManager();
    
    // Create and start server
    const server = await createServer(sessionManager) as any;
    
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📋 API Documentation: http://localhost:${PORT}/api`);
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 Received SIGTERM, shutting down gracefully...');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });
    
    process.on('SIGINT', () => {
      console.log('🛑 Received SIGINT, shutting down gracefully...');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server if this file is executed directly
if (require.main === module) {
  startServer();
}

export { startServer };