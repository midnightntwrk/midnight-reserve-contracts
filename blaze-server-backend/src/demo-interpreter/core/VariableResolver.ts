import { VariableContext, BuiltInFunction } from '../types/DemoFlow';
import { computeScriptInfo } from '../../utils/script-utils';

/**
 * Variable Resolver for r[i] references and built-in functions
 * Handles template string resolution with {{...}} syntax
 */
export class VariableResolver {
  private context: VariableContext;

  constructor(context: VariableContext) {
    this.context = context;
  }

  updateContext(context: VariableContext) {
    this.context = context;
  }

  /**
   * Resolve template strings with {{...}} syntax
   */
  resolve(template: any): any {
    if (typeof template === 'string') {
      return this.resolveString(template);
    } else if (Array.isArray(template)) {
      return template.map(item => this.resolve(item));
    } else if (template && typeof template === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.resolve(value);
      }
      return result;
    }
    return template;
  }

  private resolveString(template: string): any {
    // Match {{...}} expressions
    const expressionRegex = /\{\{([^}]+)\}\}/g;
    let resolved = template;
    let hasExpressions = false;

    resolved = resolved.replace(expressionRegex, (match, expression) => {
      hasExpressions = true;
      try {
        const result = this.evaluateExpression(expression.trim());
        return String(result);
      } catch (error) {
        throw new Error(`Failed to resolve expression '${expression}': ${(error as Error).message}`);
      }
    });

    // If the entire string was a single expression, return the raw value
    if (hasExpressions && template.match(/^\{\{[^}]+\}\}$/)) {
      const expression = template.slice(2, -2).trim();
      return this.evaluateExpression(expression);
    }

    return resolved;
  }

  private evaluateExpression(expression: string): any {
    // Handle r[i] references
    const rRefMatch = expression.match(/^r\[(\d+)\](.*)$/);
    if (rRefMatch) {
      const index = parseInt(rRefMatch[1], 10);
      const path = rRefMatch[2];

      if (index < 0 || index >= this.context.r.length) {
        throw new Error(`r[${index}] is out of bounds (0-${this.context.r.length - 1})`);
      }

      let value = this.context.r[index];
      if (path) {
        value = this.resolvePath(value, path);
      }
      return value;
    }

    // Handle config references
    if (expression.startsWith('config.')) {
      const path = expression.slice(7); // Remove 'config.'
      return this.resolvePath(this.context.config, path);
    }

    // Handle built-in functions
    if (this.isFunctionCall(expression)) {
      return this.callBuiltInFunction(expression);
    }

    // Handle literal values
    if (expression.match(/^\d+$/)) {
      return parseInt(expression, 10);
    }
    if (expression.match(/^\d+\.\d+$/)) {
      return parseFloat(expression);
    }
    if (expression.match(/^".*"$/)) {
      return expression.slice(1, -1);
    }
    if (expression.match(/^'.*'$/)) {
      return expression.slice(1, -1);
    }

    throw new Error(`Unknown expression: ${expression}`);
  }

  private resolvePath(obj: any, path: string): any {
    if (!path || path === '') return obj;
    
    // First, expand property[index] syntax into separate segments
    const normalizedPath = path.replace(/([^[\]]+)\[(\d+)\]/g, '$1.[[$2]]');
    const segments = normalizedPath.split('.').filter(s => s.length > 0);
    let current = obj;

    for (const segment of segments) {
      // Handle array indexing like [[0]] (normalized from property[0])
      if (segment.startsWith('[[') && segment.endsWith(']]')) {
        const index = parseInt(segment.slice(2, -2), 10);
        if (!Array.isArray(current)) {
          throw new Error(`Cannot index non-array with [${index}]`);
        }
        if (index < 0 || index >= current.length) {
          throw new Error(`Array index [${index}] is out of bounds`);
        }
        current = current[index];
      }
      // Handle array indexing like [0]
      else if (segment.startsWith('[') && segment.endsWith(']')) {
        const index = parseInt(segment.slice(1, -1), 10);
        if (!Array.isArray(current)) {
          throw new Error(`Cannot index non-array with [${index}]`);
        }
        if (index < 0 || index >= current.length) {
          throw new Error(`Array index [${index}] is out of bounds`);
        }
        current = current[index];
      }
      // Handle array extraction like *.property
      else if (segment === '*') {
        if (!Array.isArray(current)) {
          throw new Error(`Cannot use * operator on non-array`);
        }
        // Continue with next segment for each array element
        const nextSegments = segments.slice(segments.indexOf(segment) + 1);
        if (nextSegments.length === 0) return current;
        
        return current.map(item => {
          let result = item;
          for (const nextSeg of nextSegments) {
            if (result && typeof result === 'object') {
              result = result[nextSeg];
            } else {
              return undefined;
            }
          }
          return result;
        });
      }
      // Handle normal property access
      else {
        if (current === null || current === undefined) {
          throw new Error(`Cannot access property '${segment}' on null/undefined`);
        }
        current = current[segment];
      }
    }

    return current;
  }

  private isFunctionCall(expression: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(expression);
  }

  private callBuiltInFunction(expression: string): any {
    const match = expression.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.*)\)$/);
    if (!match) {
      throw new Error(`Invalid function call: ${expression}`);
    }

    const functionName = match[1] as BuiltInFunction;
    const argsStr = match[2];
    const args = this.parseArguments(argsStr);

    switch (functionName) {
      case 'add':
        if (args.length !== 2) throw new Error('add() requires exactly 2 arguments');
        const a = typeof args[0] === 'number' ? args[0] : Number(args[0]);
        const b = typeof args[1] === 'number' ? args[1] : Number(args[1]);
        return a + b;

      case 'multiply':
        if (args.length !== 2) throw new Error('multiply() requires exactly 2 arguments');
        const m1 = typeof args[0] === 'number' ? args[0] : Number(args[0]);
        const m2 = typeof args[1] === 'number' ? args[1] : Number(args[1]);
        return m1 * m2;

      case 'formatAda':
        if (args.length !== 1) throw new Error('formatAda() requires exactly 1 argument');
        const lovelace = typeof args[0] === 'number' ? args[0] : Number(args[0]);
        return `${(lovelace / 1_000_000).toFixed(6)} ADA`;

      case 'formatUnixTime':
        if (args.length !== 1) throw new Error('formatUnixTime() requires exactly 1 argument');
        const timestamp = Number(args[0]);
        return new Date(timestamp * 1000).toISOString();

      case 'computeContractAddress':
        if (args.length !== 1) throw new Error('computeContractAddress() requires exactly 1 argument');
        const { contractAddress } = computeScriptInfo(String(args[0]));
        return contractAddress;

      case 'computeScriptHash':
        if (args.length !== 1) throw new Error('computeScriptHash() requires exactly 1 argument');
        const { scriptHash } = computeScriptInfo(String(args[0]));
        return scriptHash;

      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  }

  private parseArguments(argsStr: string): any[] {
    if (!argsStr.trim()) return [];

    // Simple argument parsing - could be more sophisticated
    const args: any[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let depth = 0;

    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        current += char;
      } else if (!inQuotes && char === '(') {
        depth++;
        current += char;
      } else if (!inQuotes && char === ')') {
        depth--;
        current += char;
      } else if (!inQuotes && depth === 0 && char === ',') {
        args.push(this.parseArgument(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      args.push(this.parseArgument(current.trim()));
    }

    return args;
  }

  private parseArgument(arg: string): any {
    // First trim the argument
    arg = arg.trim();
    
    // If it's a template expression, resolve it
    if (arg.includes('{{') && arg.includes('}}')) {
      return this.resolve(arg);
    }
    
    // If it looks like a direct reference, evaluate it
    if (arg.match(/^r\[\d+\]/) || arg.startsWith('config.')) {
      return this.evaluateExpression(arg);
    }
    
    // Otherwise parse as literal
    if (arg.match(/^\d+$/)) {
      return parseInt(arg, 10);
    }
    if (arg.match(/^\d+\.\d+$/)) {
      return parseFloat(arg);
    }
    if (arg.match(/^["'].*["']$/)) {
      return arg.slice(1, -1);
    }
    
    return arg;
  }
}