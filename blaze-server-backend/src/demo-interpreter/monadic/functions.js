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
 * @returns {Promise<{address: string, balance: string, name: string}>}
 */
async function createWallet(name, initialBalance) {
  // Runtime will intercept this call and handle HTTP
  return global.__demoRuntime.createWallet(name, initialBalance);
}

/**
 * Get wallet balance
 * @param {string} name - Wallet name
 * @returns {Promise<string>} Balance in lovelace
 */
async function getBalance(name) {
  return global.__demoRuntime.getBalance(name);
}

/**
 * Transfer funds between wallets
 * @param {string} from - Source wallet name
 * @param {string} to - Destination wallet name or address
 * @param {number} amount - Amount in lovelace
 * @returns {Promise<{txId: string}>}
 */
async function transfer(from, to, amount) {
  return global.__demoRuntime.transfer(from, to, amount);
}

/**
 * Deploy a contract
 * @param {string} name - Contract name (must exist in config.contracts)
 * @param {object} params - Contract parameters
 * @returns {Promise<{address: string, scriptHash: string}>}
 */
async function deployContract(name, params = {}) {
  return global.__demoRuntime.deployContract(name, params);
}

/**
 * Interact with a contract
 * @param {string} address - Contract address
 * @param {string} action - Action to perform
 * @param {object} params - Action parameters
 * @returns {Promise<{txId: string, result: any}>}
 */
async function contractAction(address, action, params) {
  return global.__demoRuntime.contractAction(address, action, params);
}

/**
 * Get contract state
 * @param {string} address - Contract address
 * @returns {Promise<object>} Contract state/UTXOs
 */
async function getContractState(address) {
  return global.__demoRuntime.getContractState(address);
}

/**
 * Advance time in the emulator
 * @param {number} seconds - Seconds to advance
 * @returns {Promise<{newTime: number}>}
 */
async function advanceTime(seconds) {
  return global.__demoRuntime.advanceTime(seconds);
}

/**
 * Wait for a specific condition
 * @param {Function} condition - Function that returns true when condition is met
 * @param {number} timeout - Maximum wait time in milliseconds
 * @returns {Promise<void>}
 */
async function waitFor(condition, timeout = 30000) {
  return global.__demoRuntime.waitFor(condition, timeout);
}

// Failure-expecting variants
// These expect the operation to fail and will throw if it succeeds

async function createWalletExpectFailure(name, initialBalance) {
  return global.__demoRuntime.createWalletExpectFailure(name, initialBalance);
}

async function transferExpectFailure(from, to, amount) {
  return global.__demoRuntime.transferExpectFailure(from, to, amount);
}

async function deployContractExpectFailure(name, params = {}) {
  return global.__demoRuntime.deployContractExpectFailure(name, params);
}

async function contractActionExpectFailure(address, action, params) {
  return global.__demoRuntime.contractActionExpectFailure(address, action, params);
}

module.exports = {
  createWallet,
  getBalance,
  transfer,
  deployContract,
  contractAction,
  getContractState,
  advanceTime,
  waitFor,
  createWalletExpectFailure,
  transferExpectFailure,
  deployContractExpectFailure,
  contractActionExpectFailure
};