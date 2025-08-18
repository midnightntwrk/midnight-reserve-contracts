/**
 * Monadic Demo Functions
 * 
 * Pure interface functions that demo scripts call.
 * The runtime injects context and handles HTTP/errors.
 * These functions return promises that resolve to domain objects.
 */

/**
 * Create a new wallet with initial balance
 * @param {string} name - Wallet name
 * @param {number} initialBalance - Initial balance in lovelace
 * @returns {object} {name: string, balance: string}
 */
function createWallet(name, initialBalance) {
  // Runtime will intercept this call and handle HTTP asynchronously
  return global.__demoRuntime.createWallet(name, initialBalance);
}

/**
 * Get wallet balance
 * @param {string} name - Wallet name
 * @returns {Promise<string>} Balance in lovelace
 */
function getBalance(name) {
  return global.__demoRuntime.getBalance(name);
}

/**
 * Transfer funds between wallets
 * @param {string} from - Source wallet name
 * @param {string} to - Destination wallet name or address
 * @param {number} amount - Amount in lovelace
 * @returns {Promise<{txId: string}>}
 */
function transfer(from, to, amount) {
  return global.__demoRuntime.transfer(from, to, amount);
}

/**
 * Create a reference script for a contract
 * @param {string} name - Contract name (must exist in config.contracts)
 * @param {object} params - Parameters including wallet name
 * @returns {Promise<{refScriptUtxo: object, spendingUtxo: object, scriptHash: string, contractAddress: string}>}
 */
function createReferenceScript(name, params = {}) {
  return global.__demoRuntime.createReferenceScript(name, params);
}

/**
 * Lock funds to a contract
 * @param {string} contractAddress - Contract address (script hash)
 * @param {object} params - Parameters including amount, datum, spendingUtxo
 * @returns {Promise<{txId: string, lockedUtxo: object}>}
 */
function lockToContract(contractAddress, params) {
  return global.__demoRuntime.lockToContract(contractAddress, params);
}

/**
 * Unlock funds from a contract
 * @param {object} lockedUtxo - The UTXO to unlock
 * @param {object} refScriptUtxo - Reference script UTXO
 * @param {object} params - Parameters including redeemer, returnAddress
 * @returns {Promise<{txId: string, unlockedAmount: string}>}
 */
function unlockFromContract(lockedUtxo, refScriptUtxo, params) {
  return global.__demoRuntime.unlockFromContract(lockedUtxo, refScriptUtxo, params);
}

/**
 * Mint an NFT using a deployed minting policy
 * @param {string} policyId - The policy ID (script hash)
 * @param {string} assetName - The asset name (e.g., "001")
 * @param {number} amount - Amount to mint (typically 1 for NFTs)
 * @param {object} referenceScriptUtxo - Reference script UTXO from policy deployment
 * @param {object} params - Parameters including wallet name
 * @returns {Promise<{transactionId: string, policyId: string, assetName: string, amount: number}>}
 */
function mintNFT(policyId, assetName, amount, referenceScriptUtxo, params = {}) {
  return global.__demoRuntime.mintNFT(policyId, assetName, amount, referenceScriptUtxo, params);
}

/**
 * Get contract state
 * @param {string} address - Contract address
 * @returns {Promise<object>} Contract state/UTXOs
 */
function getContractState(address) {
  return global.__demoRuntime.getContractState(address);
}

/**
 * Advance time in the emulator
 * @param {number} seconds - Seconds to advance
 * @returns {Promise<{newTime: number}>}
 */
function advanceTime(seconds) {
  return global.__demoRuntime.advanceTime(seconds);
}

/**
 * Wait for a specific condition
 * @param {Function} condition - Function that returns true when condition is met
 * @param {number} timeout - Maximum wait time in milliseconds
 * @returns {Promise<void>}
 */
function waitFor(condition, timeout = 30000) {
  return global.__demoRuntime.waitFor(condition, timeout);
}

/**
 * Watch wallet balance
 * @param {string} walletName - Wallet name to watch
 * @param {Function} formatter - Optional formatter function
 * @returns {Promise<{name: string, status: string}>}
 */
function watchBalance(walletName, formatter = null) {
  return global.__demoRuntime.watchBalance(walletName, formatter);
}

/**
 * Watch contract state
 * @param {string} address - Contract address to watch
 * @param {Function} formatter - Optional formatter function
 * @returns {Promise<{name: string, status: string}>}
 */
function watchContractState(address, formatter = null) {
  return global.__demoRuntime.watchContractState(address, formatter);
}

/**
 * Watch wallet UTXOs
 * @param {string} walletName - Wallet name to watch
 * @param {Function} formatter - Optional formatter function
 * @returns {Promise<{name: string, status: string}>}
 */
function watchWalletUtxos(walletName, formatter = null) {
  return global.__demoRuntime.watchWalletUtxos(walletName, formatter);
}

function getWalletUtxos(walletName) {
  return global.__demoRuntime.getWalletUtxos(walletName);
}

/**
 * Watch custom endpoint
 * @param {string} name - Watcher name
 * @param {string} endpoint - API endpoint to watch
 * @param {Function} formatter - Formatter function
 * @param {object} options - Optional configuration
 * @returns {Promise<{name: string, status: string}>}
 */
function watchCustom(name, endpoint, formatter, options = {}) {
  return global.__demoRuntime.watchCustom(name, endpoint, formatter, options);
}

/**
 * Generic watch function
 * @param {string} name - Watcher name
 * @param {object} query - Query specification
 * @param {Function} formatter - Formatter function
 * @returns {Promise<{name: string, status: string}>}
 */
function watch(name, query, formatter) {
  return global.__demoRuntime.watch(name, query, formatter);
}

module.exports = {
  createWallet,
  getBalance,
  transfer,
  createReferenceScript,
  lockToContract,
  unlockFromContract,
  mintNFT,
  getContractState,
  getWalletUtxos,
  advanceTime,
  waitFor,
  watchBalance,
  watchContractState,
  watchWalletUtxos,
  watchCustom,
  watch
};