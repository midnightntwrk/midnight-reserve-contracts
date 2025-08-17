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
      throw new Error(`HTTP error during transfer: ${response.status}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Transfer failed: ${body.error || body.message || 'unknown'}`);
    }

    return { txId: body.txId };
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

  // Cleanup

  async cleanup() {
    if (this.sessionId && this.debug) {
      console.log(`[Runtime] Cleaning up session: ${this.sessionId}`);
    }
    this.sessionId = null;
  }
}

module.exports = { MonadicRuntime };