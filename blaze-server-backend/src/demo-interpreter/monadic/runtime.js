/**
 * Monadic Runtime
 * 
 * Handles all HTTP communication, session management, and error handling.
 * Provides the implementation for the pure functions in functions.js.
 */

// Import utilities for blueprint resolution
const { computeScriptInfo } = require('../../utils/script-utils.js');
const fs = require('fs');
const path = require('path');

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

  // Emit transaction info for frontend rendering
  emitTransaction(type, data) {
    const txInfo = {
      type: 'transaction',
      operation: type,
      timestamp: new Date().toISOString(),
      data: data
    };
    
    // Print in a special format that can be parsed by the frontend
    console.log(`🚀 TX_EMIT:${JSON.stringify(txInfo)}`);
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
      console.log(`[MonadicRuntime] Session created: ${this.sessionId}`);
    } catch (error) {
      throw new Error(`Failed to connect to server at ${this.baseUrl}: ${error.message}`);
    }
  }

  // Core wallet operations

  async createWallet(name, initialBalance) {
    if (this.debug) {
      console.log(`[MonadicRuntime] Making HTTP call to ${this.baseUrl}/api/wallet/register for wallet: ${name}`);
    }
    
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

    if (this.debug) {
      console.log(`[MonadicRuntime] Wallet created successfully: ${body.walletName} with balance ${body.balance}`);
    }

    // Emit transaction info for frontend
    this.emitTransaction('createWallet', {
      walletName: body.walletName,
      initialBalance: body.balance,
      result: { name: body.walletName, balance: body.balance }
    });

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

    // Emit transaction info for frontend
    this.emitTransaction('transfer', {
      from: from,
      to: to,
      amount: amount,
      transactionId: body.transactionId,
      result: { transactionId: body.transactionId }
    });

    return { transactionId: body.transactionId };
  }

  // Contract operations

  async createReferenceScript(name, params = {}) {
    // Handle blueprint file paths from params
    let compiledCode;
    if (params.blueprint) {
      // User-specified blueprint file path
      const blueprintPath = path.resolve(params.blueprint);
      if (!fs.existsSync(blueprintPath)) {
        throw new Error(`Blueprint file not found: ${blueprintPath}`);
      }
      
      const blueprintData = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));
      const validator = blueprintData.validators.find(v => 
        v.title.includes(name) && v.title.includes('spend')
      );
      
      if (!validator) {
        throw new Error(`Validator not found in blueprint for contract '${name}'`);
      }
      
      compiledCode = validator.compiledCode;
    } else {
      // Fallback to config-based resolution (legacy)
      const contractConfig = this.contracts[name];
      if (!contractConfig) {
        throw new Error(`Contract '${name}' not found in config and no blueprint path provided`);
      }

      if (typeof contractConfig === 'string') {
        // Direct CBOR string (legacy format)
        compiledCode = contractConfig;
      } else if (contractConfig.blueprint) {
        // Config-based blueprint file path
        const blueprintPath = path.resolve(contractConfig.blueprint);
        if (!fs.existsSync(blueprintPath)) {
          throw new Error(`Blueprint file not found: ${blueprintPath}`);
        }
        
        const blueprintData = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));
        const validator = blueprintData.validators.find(v => 
          v.title.includes(name) && v.title.includes('spend')
        );
        
        if (!validator) {
          throw new Error(`Validator not found in blueprint for contract '${name}'`);
        }
        
        compiledCode = validator.compiledCode;
      } else {
        throw new Error(`Invalid contract configuration for '${name}'. Expected string or {blueprint: path}`);
      }
    }

    // Get wallet address for reference script
    const walletResponse = await fetch(`${this.baseUrl}/api/wallet/${params.wallet || 'alice'}/utxos?sessionId=${this.sessionId}`);
    if (!walletResponse.ok) {
      throw new Error(`HTTP error getting wallet UTXOs: ${walletResponse.status}`);
    }
    const walletData = await walletResponse.json();
    const walletAddress = walletData.utxos[0].address;

    // Create reference script transaction (following phase 3 test pattern)
    const response = await fetch(`${this.baseUrl}/api/transaction/build-and-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        signerWallet: params.wallet || 'alice',
        operations: [{
          type: "pay-to-address",
          address: walletAddress,
          amount: "2000000", // 2 ADA for reference script
          referenceScript: compiledCode
        }, {
          type: "pay-to-address",
          address: walletAddress,
          amount: "8000000" // 8 ADA for spending
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error creating reference script: ${response.status}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Failed to create reference script: ${body.error || 'unknown'}`);
    }

    // Extract UTXOs from the response
    const refScriptUtxo = body.createdUtxos.find(utxo => utxo.amount === "2000000");
    const spendingUtxo = body.createdUtxos.find(utxo => utxo.amount === "8000000");

    if (!refScriptUtxo || !spendingUtxo) {
      throw new Error(`Failed to find expected UTXOs in transaction response`);
    }

    // Compute script info dynamically from the compiled code
    const scriptInfo = computeScriptInfo(compiledCode);
    const scriptHash = scriptInfo.scriptHash;
    const contractAddress = scriptInfo.contractAddress;

    // Emit transaction info for frontend
    this.emitTransaction('createReferenceScript', {
      contractName: name,
      scriptHash: scriptHash,
      contractAddress: contractAddress,
      wallet: params.wallet || 'alice',
      result: {
        refScriptUtxo,
        spendingUtxo,
        scriptHash,
        contractAddress
      }
    });

    // Return script info and UTXOs
    return {
      refScriptUtxo,
      spendingUtxo,
      scriptHash,
      contractAddress
    };
  }

  async mintNFT(policyId, assetName, amount, referenceScriptUtxo, params = {}) {
    // Get wallet address for the mint transaction
    const walletResponse = await fetch(`${this.baseUrl}/api/wallet/${params.wallet || 'alice'}/utxos?sessionId=${this.sessionId}`);
    if (!walletResponse.ok) {
      throw new Error(`HTTP error getting wallet UTXOs: ${walletResponse.status}`);
    }
    const walletData = await walletResponse.json();
    const walletAddress = walletData.utxos[0].address;

    // Create mint transaction
    const response = await fetch(`${this.baseUrl}/api/transaction/build-and-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        signerWallet: params.wallet || 'alice',
        operations: [
          {
            type: "mint",
            policyId: policyId,
            assetName: assetName,
            amount: amount.toString(),
            referenceScriptUtxo: referenceScriptUtxo
          },
          {
            type: "pay-to-address",
            address: walletAddress,
            amount: "1000000" // 1 ADA for the NFT
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error minting NFT: ${response.status}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Failed to mint NFT: ${body.error || 'unknown'}`);
    }

    // Emit transaction info for frontend
    this.emitTransaction('mintNFT', {
      policyId: policyId,
      assetName: assetName,
      amount: amount,
      wallet: params.wallet || 'alice',
      transactionId: body.transactionId,
      result: {
        transactionId: body.transactionId,
        policyId: policyId,
        assetName: assetName,
        amount: amount
      }
    });

    return {
      transactionId: body.transactionId,
      policyId: policyId,
      assetName: assetName,
      amount: amount
    };
  }

  async lockToContract(contractAddress, params) {
    const { amount, datum, spendingUtxo, wallet = 'alice', contractName, blueprint } = params;
    
    if (!amount || !datum || !spendingUtxo || !contractName) {
      throw new Error(`Missing required parameters: amount, datum, spendingUtxo, contractName`);
    }

    // Handle blueprint file paths from params
    let compiledCode;
    if (blueprint) {
      // User-specified blueprint file path
      const blueprintPath = path.resolve(blueprint);
      if (!fs.existsSync(blueprintPath)) {
        throw new Error(`Blueprint file not found: ${blueprintPath}`);
      }
      
      const blueprintData = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));
      const validator = blueprintData.validators.find(v => 
        v.title.includes(contractName) && v.title.includes('spend')
      );
      
      if (!validator) {
        throw new Error(`Validator not found in blueprint for contract '${contractName}'`);
      }
      
      compiledCode = validator.compiledCode;
    } else {
      // Fallback to config-based resolution (legacy)
      const contractConfig = this.contracts[contractName];
      if (!contractConfig) {
        throw new Error(`Contract '${contractName}' not found in config and no blueprint path provided`);
      }

      if (typeof contractConfig === 'string') {
        // Direct CBOR string (legacy format)
        compiledCode = contractConfig;
      } else if (contractConfig.blueprint) {
        // Config-based blueprint file path
        const blueprintPath = path.resolve(contractConfig.blueprint);
        if (!fs.existsSync(blueprintPath)) {
          throw new Error(`Blueprint file not found: ${blueprintPath}`);
        }
        
        const blueprintData = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));
        const validator = blueprintData.validators.find(v => 
          v.title.includes(contractName) && v.title.includes('spend')
        );
        
        if (!validator) {
          throw new Error(`Validator not found in blueprint for contract '${contractName}'`);
        }
        
        compiledCode = validator.compiledCode;
      } else {
        throw new Error(`Invalid contract configuration for '${contractName}'. Expected string or {blueprint: path}`);
      }
    }

    // Lock funds to contract using the transaction API
    const response = await fetch(`${this.baseUrl}/api/transaction/build-and-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        signerWallet: wallet,
        operations: [{
          type: 'spend-specific-utxos',
          utxos: [{ txHash: spendingUtxo.txHash, outputIndex: spendingUtxo.outputIndex }]
        }, {
          type: 'pay-to-contract',
          contractAddress: contractAddress,
          compiledCode: compiledCode,
          amount: amount.toString(),
          datum: datum
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error locking funds: ${response.status}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Failed to lock funds: ${body.error || 'unknown'}`);
    }

    // Find the locked UTXO in the response
    const lockedUtxo = body.createdUtxos.find(utxo => utxo.amount === amount.toString());

    // Emit transaction info for frontend
    this.emitTransaction('lockToContract', {
      contractAddress: contractAddress,
      amount: amount,
      datum: datum,
      wallet: wallet,
      contractName: contractName,
      transactionId: body.transactionId,
      result: {
        txId: body.transactionId,
        lockedUtxo
      }
    });

    return {
      txId: body.transactionId,
      lockedUtxo
    };
  }

  async unlockFromContract(lockedUtxo, refScriptUtxo, params) {
    const { redeemer, returnAddress, wallet = 'alice', contractName, blueprint } = params;
    
    if (!redeemer || !returnAddress) {
      throw new Error(`Missing required parameters: redeemer, returnAddress`);
    }

    // Get compiled code for the contract
    let compiledCode;
    if (blueprint) {
      // User-specified blueprint file path
      const blueprintPath = path.resolve(blueprint);
      if (!fs.existsSync(blueprintPath)) {
        throw new Error(`Blueprint file not found: ${blueprintPath}`);
      }
      
      const blueprintData = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));
      const validator = blueprintData.validators.find(v => 
        v.title.includes(contractName) && v.title.includes('spend')
      );
      
      if (!validator) {
        throw new Error(`Validator not found in blueprint for contract '${contractName}'`);
      }
      
      compiledCode = validator.compiledCode;
    } else {
      // Fallback to config-based resolution (legacy)
      const contractConfig = this.contracts[contractName];
      if (!contractConfig) {
        throw new Error(`Contract '${contractName}' not found in config and no blueprint path provided`);
      }

      if (typeof contractConfig === 'string') {
        // Direct CBOR string (legacy format)
        compiledCode = contractConfig;
      } else if (contractConfig.blueprint) {
        // Config-based blueprint file path
        const blueprintPath = path.resolve(contractConfig.blueprint);
        if (!fs.existsSync(blueprintPath)) {
          throw new Error(`Blueprint file not found: ${blueprintPath}`);
        }
        
        const blueprintData = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));
        const validator = blueprintData.validators.find(v => 
          v.title.includes(contractName) && v.title.includes('spend')
        );
        
        if (!validator) {
          throw new Error(`Validator not found in blueprint for contract '${contractName}'`);
        }
        
        compiledCode = validator.compiledCode;
      } else {
        throw new Error(`Invalid contract configuration for '${contractName}'. Expected string or {blueprint: path}`);
      }
    }

    // Unlock funds from contract using reference script
    const response = await fetch(`${this.baseUrl}/api/transaction/build-and-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        signerWallet: wallet,
        operations: [{
          type: 'unlock-utxo',
          txHash: lockedUtxo.txHash,
          outputIndex: lockedUtxo.outputIndex,
          redeemer: redeemer,
          compiledCode: compiledCode, // Include script bytes for UTXO discovery
          referenceScriptUtxo: {
            txHash: refScriptUtxo.txHash,
            outputIndex: refScriptUtxo.outputIndex
          }
        }, {
          type: 'pay-to-address',
          address: returnAddress,
          amount: "2000000" // Return 2 ADA (minus fees)
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error unlocking funds: ${response.status}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Failed to unlock funds: ${body.error || 'unknown'}`);
    }

    // Emit transaction info for frontend
    this.emitTransaction('unlockFromContract', {
      lockedUtxo: lockedUtxo,
      redeemer: redeemer,
      returnAddress: returnAddress,
      wallet: wallet,
      contractName: contractName,
      transactionId: body.transactionId,
      result: {
        txId: body.transactionId,
        unlockedAmount: lockedUtxo.amount
      }
    });

    return {
      txId: body.transactionId,
      unlockedAmount: lockedUtxo.amount
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const response = await fetch(
        `${this.baseUrl}/api/contract/${address}/utxos?sessionId=${this.sessionId}`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error getting contract state: ${response.status}`);
      }

      const body = await response.json();
      if (!body.success) {
        throw new Error(`Failed to get contract state: ${body.error || 'unknown'}`);
      }

      return body;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Timeout getting contract state for address: ${address}`);
      }
      throw error;
    }
  }

  async getWalletUtxos(walletName) {
    const response = await fetch(
      `${this.baseUrl}/api/wallet/${walletName}/utxos?sessionId=${this.sessionId}`
    );

    if (!response.ok) {
      throw new Error(`HTTP error getting wallet UTXOs: ${response.status}`);
    }

    const body = await response.json();
    if (!body.success) {
      throw new Error(`Failed to get wallet UTXOs: ${body.error || 'unknown'}`);
    }

    return body;
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

    // Emit transaction info for frontend
    this.emitTransaction('advanceTime', {
      seconds: seconds,
      newTime: body.newTime,
      result: { newTime: body.newTime }
    });

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

  // Watch functionality

  async watchBalance(walletName, formatter = null) {
    if (this.debug) {
      console.log(`[Runtime] Setting up balance watcher for ${walletName}`);
    }
    const defaultFormatter = (data) => {
      // Handle both direct data and API response format
      const balance = parseInt((data.balance || data.success ? data.balance : '0') || '0');
      return `${walletName}: ${(balance/1000000).toFixed(6)} ADA`;
    };
    try {
      const result = await this.watch(walletName, { type: 'balance', wallet: walletName }, formatter || defaultFormatter);
      if (this.debug) {
        console.log(`[Runtime] Balance watcher setup successful for ${walletName}`);
      }
      return result;
    } catch (error) {
      console.error(`[Runtime] Balance watcher setup failed for ${walletName}:`, error);
      throw error;
    }
  }

  async watchContractState(address, formatter = null) {
    const defaultFormatter = (data) => {
      const utxos = data.utxos || [];
      const totalValue = utxos.reduce((sum, utxo) => sum + parseInt(utxo.amount || '0'), 0);
      
      // Show datum info if available
      let datumInfo = '';
      if (utxos.length > 0 && utxos[0].datum !== undefined) {
        datumInfo = `, datum: ${utxos[0].datum}`;
      }
      
      return `Contract: ${utxos.length} UTXOs, ${(totalValue/1000000).toFixed(6)} ADA${datumInfo}`;
    };
    return this.watch(`contract-${address.slice(0, 8)}`, { type: 'contract-state', address }, formatter || defaultFormatter);
  }

  async watchWalletUtxos(walletName, formatter = null) {
    if (this.debug) {
      console.log(`[Runtime] Setting up UTXO watcher for ${walletName}`);
    }
    const defaultFormatter = (data) => {
      const utxos = data.utxos || [];
      const totalValue = utxos.reduce((sum, utxo) => sum + parseInt(utxo.amount || '0'), 0);
      return `${walletName}: ${utxos.length} UTXOs, ${(totalValue/1000000).toFixed(6)} ADA`;
    };
    try {
      const result = await this.watch(`${walletName}-utxos`, { type: 'wallet-utxos', wallet: walletName }, formatter || defaultFormatter);
      if (this.debug) {
        console.log(`[Runtime] UTXO watcher setup successful for ${walletName}`);
      }
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
      formatter: formatter, // Keep for compatibility but don't use
      lastRawData: null,
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
          endpoint: `/api/contract/${query.address}/utxos`,
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
      
      // Store raw data
      watcher.rawData = data;
      
      // Store raw data only - no server-side formatting
      watcher.rawData = data;
      
      // Check if data has changed (compare raw data)
      const dataChanged = JSON.stringify(watcher.lastRawData) !== JSON.stringify(data);
      watcher.hasChanged = dataChanged;
      
      if (dataChanged) {
        this.changedWatchers.add(watcher.id);
        if (this.debug) {
          console.log(`[Runtime] Added ${watcher.id} to changed watchers`);
        }
      }
      
      watcher.lastRawData = data;
      watcher.lastRun = Date.now();
      this.watchResults.set(watcher.id, 'Data updated'); // Simple status, not formatted result

      if (this.debug) {
        console.log(`[Runtime] Watcher ${watcher.name}: data updated`);
      }

      return 'Data updated';
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
      
      const errorStatus = `⏳ ${friendlyMessage}`;
      
      // Check if error status has changed
      const hasChanged = watcher.lastErrorStatus !== errorStatus;
      watcher.hasChanged = hasChanged;
      
      if (hasChanged) {
        this.changedWatchers.add(watcher.id);
      }
      
      watcher.lastErrorStatus = errorStatus;
      watcher.lastRun = Date.now();
      this.watchResults.set(watcher.id, errorStatus);
      return errorStatus;
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
    if (this.debug) {
      console.log('[Runtime] Executing all watchers...');
    }
    
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
        rawData: watcher.rawData,
        hasChanged: watcher.hasChanged,
        lastRun: watcher.lastRun
      };
      if (this.debug) {
        console.log(`[Runtime] Watcher info for ${watcher.name}:`, watcherInfo);
      }
      watchers.push(watcherInfo);
    }
    return watchers;
  }

  clearChangedState() {
    if (this.debug) {
      console.log('[Runtime] Clearing changed state for all watchers');
    }
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