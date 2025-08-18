#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
exports.stopServer = stopServer;
const server_1 = require("./server");
const session_manager_1 = require("./utils/session-manager");
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables
dotenv_1.default.config();
const PORT = process.env.PORT || 3031;
const NODE_ENV = process.env.NODE_ENV || "development";
let globalServer = null;
let globalSessionManager = null;
async function startServer() {
    try {
        console.log(`🚀 Starting Blaze Server Backend in ${NODE_ENV} mode...`);
        // Initialize session manager
        globalSessionManager = new session_manager_1.SessionManager();
        // Create and start server
        globalServer = await (0, server_1.createServer)(globalSessionManager);
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
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        throw error;
    }
}
async function stopServer() {
    if (globalServer) {
        console.log('🛑 Shutting down server...');
        return new Promise((resolve) => {
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
