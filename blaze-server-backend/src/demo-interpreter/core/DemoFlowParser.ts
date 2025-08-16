import * as yaml from 'js-yaml';
import { DemoFlow, DemoConfig, DemoStep, HttpRequest, StateQuery } from '../types/DemoFlow';

/**
 * YAML Demo Flow Parser with Implicit Session Handling
 * Parses and validates YAML demo flows
 */
export class DemoFlowParser {
  
  parseYaml(yamlContent: string): DemoFlow {
    try {
      const parsed = yaml.load(yamlContent) as any;
      return this.validateDemoFlow(parsed);
    } catch (error) {
      throw new Error(`YAML parsing failed: ${(error as Error).message}`);
    }
  }

  private validateDemoFlow(data: any): DemoFlow {
    if (!data || typeof data !== 'object') {
      throw new Error('Demo flow must be an object');
    }

    const required = ['name', 'description', 'version', 'config', 'setup', 'steps'];
    for (const field of required) {
      if (!(field in data)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    return {
      name: this.validateString(data.name, 'name'),
      description: this.validateString(data.description, 'description'),
      version: this.validateString(data.version, 'version'),
      config: this.validateConfig(data.config),
      setup: this.validateSteps(data.setup, 'setup'),
      steps: this.validateSteps(data.steps, 'steps')
    };
  }

  private validateConfig(config: any): DemoConfig {
    if (!config || typeof config !== 'object') {
      throw new Error('Config must be an object');
    }

    if (!config.baseUrl || typeof config.baseUrl !== 'string') {
      throw new Error('Config must have a valid baseUrl string');
    }

    return {
      baseUrl: config.baseUrl,
      contracts: config.contracts || {},
      ...config
    };
  }

  private validateSteps(steps: any, fieldName: string): DemoStep[] {
    if (!Array.isArray(steps)) {
      throw new Error(`${fieldName} must be an array`);
    }

    return steps.map((step, index) => this.validateStep(step, `${fieldName}[${index}]`));
  }

  private validateStep(step: any, path: string): DemoStep {
    if (!step || typeof step !== 'object') {
      throw new Error(`${path} must be an object`);
    }

    if (!step.name || typeof step.name !== 'string') {
      throw new Error(`${path} must have a valid name string`);
    }

    if (!step.request) {
      throw new Error(`${path} must have a request object`);
    }

    return {
      name: step.name,
      description: step.description,
      request: this.validateHttpRequest(step.request, `${path}.request`),
      monitor: step.monitor ? this.validateMonitor(step.monitor, `${path}.monitor`) : undefined,
      capture: step.capture,
      validate: step.validate,
      display: step.display
    };
  }

  private validateHttpRequest(request: any, path: string): HttpRequest {
    if (!request || typeof request !== 'object') {
      throw new Error(`${path} must be an object`);
    }

    const validMethods = ['GET', 'POST', 'PUT', 'DELETE'];
    if (!request.method || !validMethods.includes(request.method)) {
      throw new Error(`${path}.method must be one of: ${validMethods.join(', ')}`);
    }

    if (!request.endpoint || typeof request.endpoint !== 'string') {
      throw new Error(`${path}.endpoint must be a valid string`);
    }

    return {
      method: request.method,
      endpoint: request.endpoint,
      body: request.body,
      params: request.params,
      headers: request.headers
    };
  }

  private validateMonitor(monitor: any, path: string): Record<string, StateQuery> {
    if (!monitor || typeof monitor !== 'object') {
      throw new Error(`${path} must be an object`);
    }

    const result: Record<string, StateQuery> = {};
    for (const [name, query] of Object.entries(monitor)) {
      result[name] = this.validateStateQuery(query, `${path}.${name}`);
    }

    return result;
  }

  private validateStateQuery(query: any, path: string): StateQuery {
    if (!query || typeof query !== 'object') {
      throw new Error(`${path} must be an object`);
    }

    const validTypes = [
      'wallet_utxos', 'contract_utxos', 'wallet_balance', 
      'contract_balance', 'network_tip', 'emulator_time', 'all_utxos'
    ];

    if (!query.type || !validTypes.includes(query.type)) {
      throw new Error(`${path}.type must be one of: ${validTypes.join(', ')}`);
    }

    return {
      type: query.type,
      wallet: query.wallet,
      address: query.address,
      script_hash: query.script_hash
    };
  }

  private validateString(value: any, fieldName: string): string {
    if (typeof value !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }
    return value;
  }
}