/**
 * Dry-Run Runtime for Operation Analysis
 * 
 * Simulates the MonadicRuntime to detect what operations
 * a code block would perform without actually executing them.
 */

const { MonadicRuntime } = require('./runtime.js');

class DryRuntime extends MonadicRuntime {
  constructor(config = {}) {
    super(config);
    this.operations = [];
    this.isDryRun = true;
  }

  /**
   * Override fetch to record operations without executing
   */
  async fetch(url, options = {}) {
    const method = options.method || 'GET';
    
    // Record the operation
    this.operations.push({
      url,
      method,
      endpoint: this.extractEndpoint(url),
      body: options.body ? JSON.parse(options.body) : null
    });

    // Return mock successful response to let code continue
    return {
      ok: true,
      status: 200,
      json: async () => this.getMockResponse(url, method)
    };
  }

  /**
   * Extract endpoint pattern from URL
   */
  extractEndpoint(url) {
    // Remove base URL and extract API path
    const apiPath = url.replace(this.baseUrl, '');
    return apiPath;
  }

  /**
   * Generate mock response based on endpoint
   */
  getMockResponse(url, method) {
    // Return minimal valid responses to keep code running
    if (url.includes('/wallet/register')) {
      return { success: true, walletName: 'mock', balance: '0' };
    }
    if (url.includes('/balance')) {
      return { success: true, balance: '0' };
    }
    if (url.includes('/transfer')) {
      return { success: true, txId: 'mock-tx-id' };
    }
    if (url.includes('/contract/deploy')) {
      return { success: true, address: 'mock-address', scriptHash: 'mock-hash' };
    }
    return { success: true };
  }

  /**
   * Analyze recorded operations to determine type
   */
  getOperationType() {
    if (this.operations.length === 0) {
      return 'unknown';
    }

    const methods = new Set(this.operations.map(op => op.method));
    const hasPost = methods.has('POST') || methods.has('PUT') || methods.has('DELETE');
    const hasGet = methods.has('GET');

    if (hasPost && hasGet) {
      return 'mixed';
    }
    if (hasPost) {
      return 'transaction';
    }
    if (hasGet) {
      return 'query';
    }
    return 'unknown';
  }

  /**
   * Get detailed operation summary
   */
  getOperationSummary() {
    const posts = this.operations.filter(op => op.method === 'POST');
    const gets = this.operations.filter(op => op.method === 'GET');
    
    return {
      type: this.getOperationType(),
      totalOperations: this.operations.length,
      transactions: posts.length,
      queries: gets.length,
      endpoints: this.operations.map(op => `${op.method} ${op.endpoint}`)
    };
  }

  /**
   * Override all state-modifying methods to be no-ops in dry run
   */
  async initialize() {
    this.sessionId = 'dry-run-session';
    return Promise.resolve();
  }

  async cleanup() {
    return Promise.resolve();
  }
}

module.exports = { DryRuntime };