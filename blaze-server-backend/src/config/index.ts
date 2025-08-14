import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface Config {
  // Server
  port: number;
  nodeEnv: string;
  
  // Logging
  logLevel: string;
  logFormat: 'json' | 'simple';
  
  // Session Management
  sessionTimeoutMs: number;
  maxSessions: number;
  
  // Performance
  maxMemoryPerSessionMb: number;
  
  // Paths
  contractsDir: string;
  
  // Debug
  debugMode: boolean;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

function getEnvNumber(key: string, defaultValue: number): number {
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

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

export const config: Config = {
  // Server
  port: getEnvNumber('PORT', 3031),
  nodeEnv: getEnvVar('NODE_ENV', 'development'),
  
  // Logging
  logLevel: getEnvVar('LOG_LEVEL', 'debug'),
  logFormat: getEnvVar('LOG_FORMAT', 'json') as 'json' | 'simple',
  
  // Session Management
  sessionTimeoutMs: getEnvNumber('SESSION_TIMEOUT_MS', 3600000), // 1 hour default
  maxSessions: getEnvNumber('MAX_SESSIONS', 20),
  
  // Performance
  maxMemoryPerSessionMb: getEnvNumber('MAX_MEMORY_PER_SESSION_MB', 50),
  
  // Paths
  contractsDir: getEnvVar('CONTRACTS_DIR', path.join(process.cwd(), 'contracts')),
  
  // Debug
  debugMode: getEnvBoolean('DEBUG_MODE', false),
};

// Validate config
export function validateConfig(): void {
  if (config.port < 1 || config.port > 65535) {
    throw new Error('Invalid port number');
  }
  
  if (config.maxSessions < 1) {
    throw new Error('MAX_SESSIONS must be at least 1');
  }
  
  if (config.sessionTimeoutMs < 60000) {
    throw new Error('SESSION_TIMEOUT_MS must be at least 60000 (1 minute)');
  }
}