/**
 * Monadic Runtime v4.7
 * 
 * This version implements the new data conversion strategy where all
 * transformations happen at this layer, leaving the server as a simple proxy.
 */

// Node.js module dependencies for the loadContract function
const fs = require('fs');
const path = require('path');
// This utility is assumed to exist in your project structure
const { computeScriptInfo } = require('../../utils/script-utils.js');

// Import Core utilities for asset name conversion
const { Core } = require('@blaze-cardano/sdk');

/**
 * Creates a canonical (sorted-key) string representation of a JSON object.
 * This is used for reliable change detection in watchers.
 * @param {*} value - The value to stringify.
 * @returns {string}
 */
function canonicalStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalStringify).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    const pairs = keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
    return `{${pairs.join(',')}}`;
}


// Helper function to deserialize a byte array from a JSON object
function deserializeBytes(json) {
    if (json && json.type === 'Buffer' && Array.isArray(json.data)) {
        return Buffer.from(json.data);
    }
    return null;
}

class MonadicRuntime {
    /**
     * Corrected, single constructor for the MonadicRuntime class.
     */
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:3031';
    this.sessionId = null;
    this.currentStepLabel = '';
    this.debug = config.debug || false;
        this._contractCache = new Map();
        // Properties from the original, proven watcher implementation
    this.watchers = new Map();
    this.watchResults = new Map();
    this.watcherCounter = 0;
    this.changedWatchers = new Set();
  }

    /**
     * Emits a structured log for the frontend to render transaction information.
     * @param {string} type - The type of operation (e.g., 'createWallet', 'transaction').
     * @param {object} data - The data associated with the operation.
     */
  emitTransaction(type, data) {
    const txInfo = {
      type: 'transaction',
      operation: type,
      timestamp: new Date().toISOString(),
      data: data
    };
        // This special console log format can be parsed by a listening frontend.
    console.log(`🚀 TX_EMIT:${JSON.stringify(txInfo)}`);
  }

    /**
     * Sets a label for the current step in a demo script for better error reporting.
     * @param {string} label - The descriptive label for the current step.
     */
  setCurrentStep(label) {
    this.currentStepLabel = label;
  }

    /**
     * Initializes the runtime by creating a new session with the server.
     * This must be called before any other operations.
     */
  async initialize() {
        try {
            const response = await this._fetch('/api/session/new', { method: 'POST' });
            this.sessionId = response.sessionId;
      if (this.debug) {
        console.log(`[Runtime] Session created: ${this.sessionId}`);
      }
    } catch (error) {
            console.error(`[Runtime] Failed to connect to server at ${this.baseUrl}: ${error.message}`);
            throw error;
    }
  }

    // =================================================================
    // CORE API: Wallet and Emulator Management
    // =================================================================

  async createWallet(name, initialBalance) {
        const body = {
        sessionId: this.sessionId,
        name,
        initialBalance: initialBalance.toString()
        };
        const result = await this._fetch('/api/wallet/register', {
            method: 'POST',
            body: body
        });

    this.emitTransaction('createWallet', {
            walletName: result.walletName,
            initialBalance: result.balance,
            result: { name: result.walletName, balance: result.balance }
        });

    return { 
            name: result.walletName,
            balance: result.balance
    };
  }

  async getBalance(name) {
        const result = await this._fetch(`/api/wallet/${name}/balance?sessionId=${this.sessionId}`);
        return result.balance;
    }

        async getWalletUtxos(walletName) {
        const result = await this._fetch(`/api/wallet/${walletName}/utxos?sessionId=${this.sessionId}`);
        
        // Convert hex asset names to readable strings for the frontend
        return result.utxos.map(utxo => {
            if (utxo.assets && Object.keys(utxo.assets).length > 0) {
                const convertedAssets = {};
                for (const [policyId, assets] of Object.entries(utxo.assets)) {
                    convertedAssets[policyId] = {};
                    for (const [assetNameHex, assetAmount] of Object.entries(assets)) {
                        let readableName = assetNameHex;
                        try {
                            const decoded = Buffer.from(assetNameHex, 'hex').toString('utf8');
                            if (decoded.match(/^[a-zA-Z0-9\s\-_]+$/)) {
                                readableName = decoded;
                            }
                        } catch (e) {
                            // Keep hex if conversion fails
                        }
                        convertedAssets[policyId][readableName] = assetAmount;
                    }
                }
                return { ...utxo, assets: convertedAssets };
            }
            return utxo;
        });
    }

    async getContractState(contractAddress) {
        const result = await this._fetch(`/api/contract/${contractAddress}/utxos?sessionId=${this.sessionId}`);

        // Convert hex asset names to readable strings for the frontend
        return result.utxos.map(utxo => {
            if (utxo.assets && Object.keys(utxo.assets).length > 0) {
                const convertedAssets = {};
                for (const [policyId, assets] of Object.entries(utxo.assets)) {
                    convertedAssets[policyId] = {};
                    for (const [assetNameHex, assetAmount] of Object.entries(assets)) {
                        let readableName = assetNameHex;
                        try {
                            const decoded = Buffer.from(assetNameHex, 'hex').toString('utf8');
                            if (decoded.match(/^[a-zA-Z0-9\s\-_]+$/)) {
                                readableName = decoded;
                            }
                        } catch (e) {
                            // Keep hex if conversion fails
                        }
                        convertedAssets[policyId][readableName] = assetAmount;
                    }
                }
                return { ...utxo, assets: convertedAssets };
            }
            return utxo;
        });
    }

    async advanceTime(seconds) {
        const currentTimeResponse = await this._fetch(`/api/emulator/current-time?sessionId=${this.sessionId}`);
        const targetUnixTime = currentTimeResponse.currentUnixTime + (seconds * 1000);

        const body = {
            sessionId: this.sessionId,
            targetUnixTime
        };
        const result = await this._fetch('/api/emulator/advance-time', {
      method: 'POST',
            body: body
        });

        this.emitTransaction('advanceTime', {
            seconds: seconds,
            newSlot: result.newSlot,
            result: { newSlot: result.newSlot }
        });

        return { newSlot: result.newSlot };
    }

    async loadContract(filePath, contractName) {
        const cacheKey = `${filePath}:${contractName}`;
        if (this._contractCache.has(cacheKey)) {
            return this._contractCache.get(cacheKey);
        }

        const blueprintPath = path.resolve(filePath);
        if (!fs.existsSync(blueprintPath)) {
          throw new Error(`Blueprint file not found: ${blueprintPath}`);
        }
        
        const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));
        const validator = blueprint.validators.find(v => v.title.startsWith(contractName));
        
        if (!validator) {
            throw new Error(`Validator '${contractName}' not found in ${filePath}`);
        }

        const compiledCode = validator.compiledCode;
        const scriptInfo = computeScriptInfo(compiledCode);
        
        const contractDetails = {
            ...scriptInfo,
            compiledCode: compiledCode
        };

        this._contractCache.set(cacheKey, contractDetails);
        return contractDetails;
    }

    // =================================================================
    // WATCHER API (Integrated from original runtime)
    // =================================================================

  async watch(name, query, formatter) {
        const watcherId = `watcher_${++this.watcherCounter}`;
    const watcher = {
      id: watcherId,
      name,
            query,
            formatter,
      lastRawData: null,
      lastRun: null,
      hasChanged: false
    };
    this.watchers.set(watcherId, watcher);
        await this.executeWatcher(watcher); // Execute immediately on creation
        return { name, status: 'active' };
    }

    watchBalance(walletName, formatter = null) {
        const defaultFormatter = (balance) => `${walletName}: ${(parseInt(balance || '0') / 1000000).toFixed(6)} ADA`;
        return this.watch(`Balance: ${walletName}`, { type: 'balance', key: walletName }, formatter || defaultFormatter);
    }

    watchWalletUtxos(walletName, formatter = null) {
        const defaultFormatter = (utxos) => {
            const totalValue = (utxos || []).reduce((sum, utxo) => sum + parseInt(utxo.amount || '0'), 0);
            return `${walletName}: ${(utxos || []).length} UTxOs, ${(totalValue / 1000000).toFixed(6)} ADA`;
        };
        return this.watch(`UTxOs: ${walletName}`, { type: 'walletUtxos', key: walletName }, formatter || defaultFormatter);
    }

    watchContractState(address, formatter = null) {
        const defaultFormatter = (utxos) => {
            const utxoList = utxos || [];
            const totalValue = utxos.reduce((sum, utxo) => sum + parseInt(utxo.amount || '0'), 0);
            let datumInfo = '';
            if (utxoList.length > 0 && utxoList[0].datum !== undefined) {
                datumInfo = `, datum: ${utxoList[0].datum}`;
            }
            return `Contract: ${utxoList.length} UTxOs, ${(totalValue / 1000000).toFixed(6)} ADA${datumInfo}`;
        };
        return this.watch(`State: ${address.substring(0, 20)}...`, { type: 'contractState', key: address }, formatter || defaultFormatter);
  }

  async executeWatcher(watcher) {
        let rawData;
        try {
            switch (watcher.query.type) {
                case 'balance':
                    rawData = await this.getBalance(watcher.query.key);
                    break;
                case 'walletUtxos':
                    rawData = await this.getWalletUtxos(watcher.query.key);
                    break;
                case 'contractState':
                    rawData = await this.getContractState(watcher.query.key);
                    break;
                default:
                    throw new Error(`Unknown watcher type: ${watcher.query.type}`);
            }

            const dataChanged = canonicalStringify(watcher.lastRawData) !== canonicalStringify(rawData);
            
      watcher.hasChanged = dataChanged;
      if (dataChanged) {
        this.changedWatchers.add(watcher.id);
      }
      
            watcher.lastRawData = rawData;
      watcher.lastRun = Date.now();
            this.watchResults.set(watcher.id, { 
                data: rawData, 
                formatted: watcher.formatter(rawData) 
            });

    } catch (error) {
            let errorStatus;
            if (error instanceof Error && error.message.includes("does not exist")) {
                errorStatus = '⏳ Pending creation...';
        } else {
                errorStatus = `Error: ${error.message}`;
            }

            const statusChanged = watcher.lastErrorStatus !== errorStatus;
            watcher.hasChanged = statusChanged;
            if (statusChanged) {
        this.changedWatchers.add(watcher.id);
      }
      watcher.lastErrorStatus = errorStatus;
            this.watchResults.set(watcher.id, { error: errorStatus, formatted: errorStatus });
    }
  }

  async executeAllWatchers() {
        if (this.debug) console.log(`[Runtime] Executing all ${this.watchers.size} watchers...`);
        const promises = Array.from(this.watchers.values()).map(w => this.executeWatcher(w));
        await Promise.allSettled(promises);
  }

  getWatchersInfo() {
        const watchersInfo = [];
    for (const [id, watcher] of this.watchers) {
            watchersInfo.push({
        id: watcher.id,
        name: watcher.name,
        result: this.watchResults.get(id),
                rawData: watcher.lastRawData, 
                hasChanged: this.changedWatchers.has(id),
        lastRun: watcher.lastRun
            });
      }
        return watchersInfo;
    }

    getWatchResults() {
        return Object.fromEntries(this.watchResults);
  }

  clearChangedState() {
    this.changedWatchers.clear();
    for (const watcher of this.watchers.values()) {
      watcher.hasChanged = false;
    }
  }

    // =================================================================
    // TRANSACTION BUILDER API
    // =================================================================

    newTransaction(signerWallet) {
        return new TransactionBuilder(this, signerWallet);
    }

    // =================================================================
    // INTERNAL HELPERS
    // =================================================================

    async _fetch(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };
        const config = { ...options, headers };
        if (options.body) {
            config.body = JSON.stringify(options.body);
        }
        const response = await fetch(url, config);
        if (!response.ok) {
            let errorDetails = '';
            try {
                const errorBody = await response.json();
                errorDetails = errorBody.error || errorBody.message || 'No additional details.';
            } catch (e) {
                errorDetails = 'Could not parse error response.';
            }
            const errorMessage = `HTTP error for ${this.currentStepLabel}: ${response.status} - ${errorDetails}`;
            console.error(`[Runtime] Fetch failed for ${url}: ${errorMessage}`);
            throw new Error(errorMessage);
        }
        const responseBody = await response.json();
        if (!responseBody.success) {
            const errorMessage = `Server error during ${this.currentStepLabel}: ${responseBody.error || 'unknown'}`;
            console.error(`[Runtime] Server logic error for ${url}: ${errorMessage}`);
            throw new Error(errorMessage);
        }
        return responseBody;
    }

  async cleanup() {
    if (this.sessionId && this.debug) {
      console.log(`[Runtime] Cleaning up session: ${this.sessionId}`);
    }
    this.sessionId = null;
    }
}

class TransactionBuilder {
    constructor(runtime, signerWallet) {
        this._runtime = runtime;
        this._signerWallet = signerWallet;
        this._operations = [];
        this._collateralUtxos = null;
    }
    spendUtxos(utxos) {
        this._operations.push({
            type: 'spend-specific-utxos',
            utxos: utxos.map(u => ({ txHash: u.txHash, outputIndex: u.outputIndex })),
        });
        return this;
    }
    payToAddress(address, amount, options = {}) {
        const op = {
            type: 'pay-to-address',
            address: address,
            amount: amount.toString(),
        };
        if (options.referenceScript) {
            op.referenceScript = options.referenceScript;
        }
        this._operations.push(op);
        return this;
    }
    payToContract(scriptHash, compiledCode, amount, datum) {
        this._operations.push({
            type: 'pay-to-contract',
            scriptHash: scriptHash,
            compiledCode: compiledCode,
            amount: amount.toString(),
            datum: datum,
        });
        return this;
    }
    unlockUtxo(lockedUtxo, redeemer, compiledCode, options = {}) {
        const op = {
            type: 'unlock-utxo',
            txHash: lockedUtxo.txHash,
            outputIndex: lockedUtxo.outputIndex,
            redeemer: redeemer,
            compiledCode: compiledCode,
        };
        if (options.referenceScriptUtxo) {
            op.referenceScriptUtxo = {
                txHash: options.referenceScriptUtxo.txHash,
                outputIndex: options.referenceScriptUtxo.outputIndex
            };
        }
        this._operations.push(op);
        return this;
    }
mint(policyId, assetName, amount, options = {}) {
    // Handle different asset name formats using Blaze SDK patterns:
    // 1. String like 'MyNFT' -> convert to hex using Core.toHex()
    // 2. Hex string like '4d794e4654' -> use as-is
    // 3. Already a Uint8Array -> convert to hex
    
    let assetNameHex;
    
    if (typeof assetName === 'string') {
        if (assetName.match(/^[0-9a-fA-F]+$/)) {
            // Already a hex string
            assetNameHex = assetName;
        } else {
            // Regular string - convert to hex using standard Buffer conversion
            assetNameHex = Buffer.from(assetName, 'utf8').toString('hex');
        }
    } else if (assetName instanceof Uint8Array) {
        // Byte array - convert to hex
        assetNameHex = Core.toHex(assetName);
    } else {
        throw new Error('Asset name must be a string or Uint8Array');
    }

    // Validate length (32 bytes max)
    const assetNameBytes = Buffer.from(assetNameHex, 'hex');
    if (assetNameBytes.length > 32) {
        throw new Error(`Asset name "${assetName}" exceeds the 32-byte limit.`);
    }

    console.log("[DEBUG] Runtime converting asset name:", {
        originalAssetName: assetName,
        convertedAssetNameHex: assetNameHex,
        policyId: policyId,
        amount: amount.toString()
    });
    
    const op = {
        type: 'mint',
        policyId: policyId,
        assetName: assetNameHex, // Send as hex string to server
        amount: amount.toString(),
    };
    
    console.log("[DEBUG] Runtime sending operation to server:", op);
    if (options.redeemer) {
        op.redeemer = options.redeemer;
    }
    if (options.referenceScriptUtxo) {
        op.referenceScriptUtxo = {
            txHash: options.referenceScriptUtxo.txHash,
            outputIndex: options.referenceScriptUtxo.outputIndex
        };
    }
    this._operations.push(op);
    return this;
}
    addCollateral(utxos) {
        this._collateralUtxos = utxos.map(u => ({ txHash: u.txHash, outputIndex: u.outputIndex }));
        return this;
    }
    async submit() {
        if (this._operations.length === 0) {
            throw new Error("Transaction has no operations. Add operations before submitting.");
        }
        const body = {
            sessionId: this._runtime.sessionId,
            signerWallet: this._signerWallet,
            operations: this._operations,
        };
        if (this._collateralUtxos) {
            body.collateralUtxos = this._collateralUtxos;
        }
        const result = await this._runtime._fetch('/api/transaction/build-and-submit', {
            method: 'POST',
            body: body,
        });
        this._runtime.emitTransaction('transaction', {
            signer: this._signerWallet,
            operations: this._operations,
            result: {
                transactionId: result.transactionId,
                createdUtxos: result.createdUtxos
            }
        });
        return {
            transactionId: result.transactionId,
            createdUtxos: result.createdUtxos,
        };
    }
}

// Export for use in Node.js environments
if (typeof module !== 'undefined' && module.exports) {
module.exports = { MonadicRuntime };
}
