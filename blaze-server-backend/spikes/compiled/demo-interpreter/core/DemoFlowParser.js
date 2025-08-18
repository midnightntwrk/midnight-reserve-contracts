"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemoFlowParser = void 0;
const yaml = __importStar(require("js-yaml"));
/**
 * YAML Demo Flow Parser with Implicit Session Handling
 * Parses and validates YAML demo flows
 */
class DemoFlowParser {
    parseYaml(yamlContent) {
        try {
            const parsed = yaml.load(yamlContent);
            return this.validateDemoFlow(parsed);
        }
        catch (error) {
            throw new Error(`YAML parsing failed: ${error.message}`);
        }
    }
    validateDemoFlow(data) {
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
    validateConfig(config) {
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
    validateSteps(steps, fieldName) {
        if (!Array.isArray(steps)) {
            throw new Error(`${fieldName} must be an array`);
        }
        return steps.map((step, index) => this.validateStep(step, `${fieldName}[${index}]`));
    }
    validateStep(step, path) {
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
    validateHttpRequest(request, path) {
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
    validateMonitor(monitor, path) {
        if (!monitor || typeof monitor !== 'object') {
            throw new Error(`${path} must be an object`);
        }
        const result = {};
        for (const [name, query] of Object.entries(monitor)) {
            result[name] = this.validateStateQuery(query, `${path}.${name}`);
        }
        return result;
    }
    validateStateQuery(query, path) {
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
    validateString(value, fieldName) {
        if (typeof value !== 'string') {
            throw new Error(`${fieldName} must be a string`);
        }
        return value;
    }
}
exports.DemoFlowParser = DemoFlowParser;
