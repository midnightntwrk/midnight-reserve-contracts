"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.validateConfig = validateConfig;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load environment variables
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), '.env') });
function getEnvVar(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined && defaultValue === undefined) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value || defaultValue;
}
function getEnvNumber(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) {
        return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
        throw new Error(`Invalid number for environment variable ${key}: ${value}`);
    }
    return parsed;
}
function getEnvBoolean(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) {
        return defaultValue;
    }
    return value.toLowerCase() === 'true';
}
exports.config = {
    // Server
    port: getEnvNumber('PORT', 3031),
    nodeEnv: getEnvVar('NODE_ENV', 'development'),
    // Logging
    logLevel: getEnvVar('LOG_LEVEL', 'debug'),
    logFormat: getEnvVar('LOG_FORMAT', 'json'),
    // Session Management
    sessionTimeoutMs: getEnvNumber('SESSION_TIMEOUT_MS', 3600000), // 1 hour default
    maxSessions: getEnvNumber('MAX_SESSIONS', 20),
    // Performance
    maxMemoryPerSessionMb: getEnvNumber('MAX_MEMORY_PER_SESSION_MB', 50),
    // Paths
    contractsDir: getEnvVar('CONTRACTS_DIR', path_1.default.join(process.cwd(), 'contracts')),
    // Debug
    debugMode: getEnvBoolean('DEBUG_MODE', false),
};
// Validate config
function validateConfig() {
    if (exports.config.port < 1 || exports.config.port > 65535) {
        throw new Error('Invalid port number');
    }
    if (exports.config.maxSessions < 1) {
        throw new Error('MAX_SESSIONS must be at least 1');
    }
    if (exports.config.sessionTimeoutMs < 60000) {
        throw new Error('SESSION_TIMEOUT_MS must be at least 60000 (1 minute)');
    }
}
