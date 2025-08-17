/**
 * Demo Flow TypeScript Definitions
 * Based on YAML specification from PLAN_002.md
 */

export interface DemoFlow {
  name: string;
  description: string;
  version: string;
  config: DemoConfig;
  setup: DemoStep[];
  steps: DemoStep[];
}

export interface DemoConfig {
  baseUrl: string;
  contracts: Record<string, string>; // name -> compiled code
  [key: string]: any; // Allow additional config properties
}

export interface DemoStep {
  name: string;
  description?: string;
  request: HttpRequest;
  monitor?: Record<string, StateQuery>;
  capture?: Record<string, string>; // name -> jsonPath
  validate?: string[]; // Validation expressions
  display?: string[]; // Display templates
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  body?: any;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface StateQuery {
  type: 'wallet_utxos' | 'contract_utxos' | 'wallet_balance' | 'contract_balance' | 'network_tip' | 'emulator_time' | 'all_utxos';
  wallet?: string;
  address?: string;
  script_hash?: string;
}

export interface StateSnapshot {
  timestamp: number;
  data: Record<string, any>;
}

export interface StepResult {
  stepName: string;
  response: any;
  statusCode: number;
  beforeState: StateSnapshot;
  afterState: StateSnapshot;
  executionTime: number;
}

export interface DemoExecutionContext {
  sessionId: string | null;
  stepResults: StepResult[];
  config: DemoConfig;
  variables: Record<string, any>;
}

// Built-in function definitions
export type BuiltInFunction = 
  | 'computeContractAddress'
  | 'computeScriptHash' 
  | 'add'
  | 'multiply'
  | 'formatAda'
  | 'formatUnixTime';

export interface VariableContext {
  r: any[]; // Response array for r[i] references
  config: DemoConfig;
}