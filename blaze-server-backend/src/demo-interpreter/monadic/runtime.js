/**
 * Monadic Runtime
 * 
 * Handles all HTTP communication, session management, and error handling.
 * Provides the implementation for the pure functions in functions.js.
 */

class MonadicRuntime {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:3031';
    this.sessionId = null;
    this.contracts = config.contracts || {};
    this.currentStepLabel = '';
    this.debug = config.debug || false;
    this.watchers = new Map();
    this.watchResults = new Map();
    this.watcherCounter = 0;
    this.changedWatchers = new Set();
  }

  setCurrentStep(label) {
    this.currentStepLabel = label;
  }

  async initialize() {
    // Create session
    try {
      const response = await fetch(`${this.baseUrl}/api/session/new`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      const data = await response.json();
      this.sessionId = data.sessionId;
      
      if (this.debug) {
        console.log(`[Runtime] Session created: ${this.sessionId}`);
      }
    } catch (error) {
      throw new Error(`Failed to connect to server at ${this.baseUrl}: ${error.message}`);
    }
  }

  // Core wallet operations

  async createWallet(name, initialBalance) {
    console.log(`[MonadicRuntime] Making HTTP call to ${this.baseUrl}/api/wallet/register for wallet: ${name}`);
    
    const response = await fetch(`${this.baseUrl}/api/wallet/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        name,
        initialBalance: initialBalance.toString()
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error during ${this.currentStepLabel}: ${response.status}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Server error during ${this.currentStepLabel}: ${body.error || 'unknown'}`);
    }

    console.log(`[MonadicRuntime] Wallet created successfully: ${body.walletName} with balance ${body.balance}`);

    // API returns walletName and balance only - no address
    return { 
      name: body.walletName,
      balance: body.balance
    };
  }

  async getBalance(name) {
    const response = await fetch(
      `${this.baseUrl}/api/wallet/${name}/balance?sessionId=${this.sessionId}`
    );

    if (!response.ok) {
      throw new Error(`HTTP error getting balance for ${name}: ${response.status}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Server error getting balance: ${body.error || 'unknown'}`);
    }

    return body.balance;
  }

  async transfer(from, to, amount) {
    const response = await fetch(`${this.baseUrl}/api/wallet/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        fromWallet: from,
        toWallet: to,
        amount: amount.toString()
      })
    });

    if (!response.ok) {
      let errorDetails = '';
      try {
        const errorBody = await response.text();
        errorDetails = ` - ${errorBody}`;
      } catch (e) {
        errorDetails = ' - Could not read error response';
      }
      throw new Error(`HTTP error during transfer: ${response.status}${errorDetails}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Transfer failed: ${body.error || body.message || 'unknown'}`);
    }

    return { transactionId: body.transactionId };
  }

  // Contract operations

  async deployContract(name, params) {
    const compiledCode = this.contracts[name];
    if (!compiledCode) {
      throw new Error(`Contract '${name}' not found in config`);
    }

    const response = await fetch(`${this.baseUrl}/api/contract/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        compiledCode,
        params
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error deploying contract: ${response.status}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Contract deployment failed: ${body.error || body.message || 'unknown'}`);
    }

    return {
      address: body.address,
      scriptHash: body.scriptHash
    };
  }

  async contractAction(address, action, params) {
    const response = await fetch(`${this.baseUrl}/api/contract/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        address,
        ...params
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error during contract action: ${response.status}`);
    }

    const body = await response.json();
    if (!body.ok) {
      throw new Error(`Contract action failed: ${body.error || 'unknown'}`);
    }

    return {
      txId: body.txId,
      result: body.result
    };
  }

  async getContractState(address) {
    const response = await fetch(
      `${this.baseUrl}/api/contract/${address}/state?sessionId=${this.sessionId}`
    );

    if (!response.ok) {
      throw new Error(`HTTP error getting contract state: ${response.status}`);
    }

    const body = await response.json();
    if (!body.ok) {
      throw new Error(`Failed to get contract state: ${body.error || 'unknown'}`);
    }

    return body.state;
  }

  // Emulator operations

  async advanceTime(seconds) {
    const response = await fetch(`${this.baseUrl}/api/emulator/advance-time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        seconds
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error advancing time: ${response.status}`);
    }

    const body = await response.json();
    if (!body.ok) {
      throw new Error(`Failed to advance time: ${body.error || 'unknown'}`);
    }

    return { newTime: body.newTime };
  }

  async waitFor(condition, timeout) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`Timeout waiting for condition after ${timeout}ms`);
  }

  // Failure-expecting variants

  async createWalletExpectFailure(name, initialBalance) {
    try {
      const result = await this.createWallet(name, initialBalance);
      throw new Error(`Expected wallet creation to fail but it succeeded: ${JSON.stringify(result)}`);
    } catch (error) {
      if (error.message.startsWith('Expected wallet creation to fail')) {
        throw error;
      }
      // Expected failure occurred
      return { error: error.message };
    }
  }

  async transferExpectFailure(from, to, amount) {
    try {
      const result = await this.transfer(from, to, amount);
      throw new Error(`Expected transfer to fail but it succeeded: ${JSON.stringify(result)}`);
    } catch (error) {
      if (error.message.startsWith('Expected transfer to fail')) {
        throw error;
      }
      return { error: error.message };
    }
  }

  async deployContractExpectFailure(name, params) {
    try {
      const result = await this.deployContract(name, params);
      throw new Error(`Expected contract deployment to fail but it succeeded: ${JSON.stringify(result)}`);
    } catch (error) {
      if (error.message.startsWith('Expected contract deployment to fail')) {
        throw error;
      }
      return { error: error.message };
    }
  }

  async contractActionExpectFailure(address, action, params) {
    try {
      const result = await this.contractAction(address, action, params);
      throw new Error(`Expected contract action to fail but it succeeded: ${JSON.stringify(result)}`);
    } catch (error) {
      if (error.message.startsWith('Expected contract action to fail')) {
        throw error;
      }
      return { error: error.message };
    }
  }

  // Watch functionality

  async watchBalance(walletName, formatter = null) {
    console.log(`[Runtime] Setting up balance watcher for ${walletName}`);
    const defaultFormatter = (data) => `${walletName}: ${data.balance} lovelace`;
    try {
      const result = await this.watch(walletName, { type: 'balance', wallet: walletName }, formatter || defaultFormatter);
      console.log(`[Runtime] Balance watcher setup successful for ${walletName}`);
      return result;
    } catch (error) {
      console.error(`[Runtime] Balance watcher setup failed for ${walletName}:`, error);
      throw error;
    }
  }

  async watchContractState(address, formatter = null) {
    const defaultFormatter = (data) => `Contract ${address.slice(0, 8)}...: ${JSON.stringify(data)}`;
    return this.watch(`contract-${address.slice(0, 8)}`, { type: 'contract-state', address }, formatter || defaultFormatter);
  }

  async watchWalletUtxos(walletName, formatter = null) {
    console.log(`[Runtime] Setting up UTXO watcher for ${walletName}`);
    const defaultFormatter = (data) => `${walletName} UTXOs: ${data.utxos.length} total`;
    try {
      const result = await this.watch(`${walletName}-utxos`, { type: 'wallet-utxos', wallet: walletName }, formatter || defaultFormatter);
      console.log(`[Runtime] UTXO watcher setup successful for ${walletName}`);
      return result;
    } catch (error) {
      console.error(`[Runtime] UTXO watcher setup failed for ${walletName}:`, error);
      throw error;
    }
  }

  async watchCustom(name, endpoint, formatter, options = {}) {
    return this.watch(name, {
      type: 'custom',
      endpoint,
      method: options.method || 'GET',
      body: options.body
    }, formatter);
  }

  async watch(name, query, formatter) {
    const httpRequest = this.convertQueryToHttpRequest(query);
    
    // Generate unique ID for this watcher
    const watcherId = `watcher_${++this.watcherCounter}_${Date.now()}`;
    
    const watcher = {
      id: watcherId,
      name,
      query: httpRequest,
      formatter: formatter,
      lastResult: null,
      lastRun: null,
      hasChanged: false
    };

    this.watchers.set(watcherId, watcher);
    
    // Execute immediately
    await this.executeWatcher(watcher);
    
    return { id: watcherId, name, status: 'active' };
  }

  convertQueryToHttpRequest(query) {
    switch (query.type) {
      case 'balance':
        return {
          endpoint: `/api/wallet/${query.wallet}/balance`,
          method: 'GET',
          params: { sessionId: this.sessionId }
        };
      
      case 'contract-state':
        return {
          endpoint: `/api/contract/${query.address}/state`,
          method: 'GET',
          params: { sessionId: this.sessionId }
        };
      
      case 'wallet-utxos':
        return {
          endpoint: `/api/wallet/${query.wallet}/utxos`,
          method: 'GET',
          params: { sessionId: this.sessionId }
        };
      
      case 'custom':
        return {
          endpoint: query.endpoint,
          method: query.method || 'GET',
          params: { ...query.params, sessionId: this.sessionId },
          body: query.body
        };
      
      default:
        throw new Error(`Unknown query type: ${query.type}`);
    }
  }

  async executeWatcher(watcher) {
    try {
      const url = new URL(`${this.baseUrl}${watcher.query.endpoint}`);
      if (watcher.query.params) {
        Object.entries(watcher.query.params).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });
      }

      const response = await fetch(url.toString(), {
        method: watcher.query.method,
        headers: { 'Content-Type': 'application/json' },
        body: watcher.query.body ? JSON.stringify(watcher.query.body) : undefined
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Apply formatter
      let formattedResult;
      if (typeof watcher.formatter === 'string') {
        formattedResult = this.applyStringFormatter(watcher.formatter, data);
      } else {
        formattedResult = this.applyFunctionFormatter(watcher.formatter, data);
      }

      // Check if result has changed
      const hasChanged = watcher.lastResult !== formattedResult;
      watcher.hasChanged = hasChanged;
      
      console.log(`[Runtime] Watcher ${watcher.name}: lastResult="${watcher.lastResult}", newResult="${formattedResult}", hasChanged=${hasChanged}`);
      
      if (hasChanged) {
        this.changedWatchers.add(watcher.id);
        console.log(`[Runtime] Added ${watcher.id} to changed watchers`);
      }
      
      watcher.lastResult = formattedResult;
      watcher.lastRun = Date.now();
      this.watchResults.set(watcher.id, formattedResult);

      if (this.debug) {
        console.log(`[Runtime] Watcher ${watcher.name}: ${formattedResult}`);
      }

      return formattedResult;
    } catch (error) {
      console.error(`Watcher ${watcher.name} failed:`, error);
      
      // Provide friendly error messages for common cases
      let friendlyMessage;
      if (error.message.includes('HTTP 400') || error.message.includes('HTTP 404')) {
        if (watcher.name.includes('balance')) {
          friendlyMessage = 'Wallet not created yet';
        } else if (watcher.name.includes('utxo')) {
          friendlyMessage = 'Wallet not created yet';
        } else {
          friendlyMessage = 'Resource not available yet';
        }
      } else {
        friendlyMessage = error.message;
      }
      
      const result = `⏳ ${friendlyMessage}`;
      
      // Check if result has changed (even for errors)
      const hasChanged = watcher.lastResult !== result;
      watcher.hasChanged = hasChanged;
      
      if (hasChanged) {
        this.changedWatchers.add(watcher.id);
      }
      
      watcher.lastResult = result;
      watcher.lastRun = Date.now();
      this.watchResults.set(watcher.id, result);
      return result;
    }
  }

  applyStringFormatter(formatter, data) {
    // Simple string template replacement
    return formatter.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] || match;
    });
  }

  applyFunctionFormatter(formatter, data) {
    // Execute the formatter function directly
    try {
      return formatter(data);
    } catch (error) {
      console.error('Formatter function error:', error);
      return `Formatter error: ${error.message}`;
    }
  }

  async executeAllWatchers() {
    console.log('[Runtime] Executing all watchers...');
    
    const promises = Array.from(this.watchers.values())
      .map(w => this.executeWatcher(w));
    
    return Promise.allSettled(promises);
  }

  getWatchResults() {
    return Object.fromEntries(this.watchResults);
  }

  getWatchersInfo() {
    const watchers = [];
    for (const [id, watcher] of this.watchers) {
      const watcherInfo = {
        id: watcher.id,
        name: watcher.name,
        result: this.watchResults.get(id),
        hasChanged: watcher.hasChanged,
        lastRun: watcher.lastRun
      };
      console.log(`[Runtime] Watcher info for ${watcher.name}:`, watcherInfo);
      watchers.push(watcherInfo);
    }
    return watchers;
  }

  clearChangedState() {
    console.log('[Runtime] Clearing changed state for all watchers');
    this.changedWatchers.clear();
    for (const watcher of this.watchers.values()) {
      watcher.hasChanged = false;
    }
  }

  stopWatcher(name) {
    this.watchers.delete(name);
    this.watchResults.delete(name);
  }

  stopAllWatchers() {
    this.watchers.clear();
    this.watchResults.clear();
  }

  // Cleanup

  async cleanup() {
    if (this.sessionId && this.debug) {
      console.log(`[Runtime] Cleaning up session: ${this.sessionId}`);
    }
    this.sessionId = null;
    this.stopAllWatchers();
  }
}

module.exports = { MonadicRuntime };