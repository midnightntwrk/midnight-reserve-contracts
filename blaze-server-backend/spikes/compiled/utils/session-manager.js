"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const crypto_1 = require("crypto");
const emulator_1 = require("@blaze-cardano/emulator");
const protocol_params_1 = require("./protocol-params");
class SessionManager {
    constructor() {
        this.currentSession = null;
        // Minimal implementation to make the test pass
    }
    async createSession() {
        // Destroy existing session if it exists
        if (this.currentSession) {
            // Clean up old emulator resources
            this.currentSession = null;
        }
        const emulator = new emulator_1.Emulator([], protocol_params_1.basicProtocolParameters);
        this.currentSession = {
            id: (0, crypto_1.randomUUID)(),
            emulator,
            deployedContracts: new Map(), // Store contract address -> compiled code mapping
            hasProcessedTransactions: false // Track if session has moved to transaction phase
        };
        return this.currentSession;
    }
    getCurrentSession() {
        return this.currentSession;
    }
}
exports.SessionManager = SessionManager;
