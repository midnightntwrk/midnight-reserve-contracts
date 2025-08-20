/**
 * Monadic Demo Functions (v2)
 *
 * This is the pure functional interface that demo scripts should use.
 * The runtime, injected as a global, handles all the underlying state,
 * HTTP communication, and error handling.
 *
 * This version is updated to use the TransactionBuilder pattern from the
 * new MonadicRuntime, promoting a more flexible and powerful way to
 * construct transactions.
 */

// =================================================================
// CORE API: Wallet and Emulator Management
// =================================================================

/**
 * Creates a new wallet in the emulator with an initial balance.
 * @param {string} name - The name for the new wallet (e.g., 'alice').
 * @param {number} initialBalance - The starting balance in Lovelace.
 * @returns {Promise<{name: string, balance: bigint}>} A promise that resolves to the new wallet's details.
 */
function createWallet(name, initialBalance) {
  return global.__demoRuntime.createWallet(name, initialBalance);
}

/**
 * Retrieves the current balance of a specified wallet.
 * @param {string} name - The name of the wallet to query.
 * @returns {Promise<bigint>} A promise that resolves to the wallet's balance in Lovelace.
 */
function getBalance(name) {
  return global.__demoRuntime.getBalance(name);
}

/**
 * Fetches all UTxOs (Unspent Transaction Outputs) for a given wallet.
 * @param {string} walletName - The name of the wallet.
 * @returns {Promise<Array<object>>} A promise that resolves to a list of UTxOs.
 */
function getWalletUtxos(walletName) {
  return global.__demoRuntime.getWalletUtxos(walletName);
}

/**
 * Fetches all UTxOs currently held at a contract address.
 * This effectively represents the current state of the contract.
 * @param {string} contractAddress - The Bech32 address of the contract.
 * @returns {Promise<Array<object>>} A promise that resolves to a list of the contract's UTxOs.
 */
function getContractState(contractAddress) {
  return global.__demoRuntime.getContractState(contractAddress);
}

/**
 * Advances the emulator's internal clock forward by a set amount of time.
 * @param {number} seconds - The number of seconds to advance time.
 * @returns {Promise<{newSlot: number}>} A promise that resolves with the new slot number.
 */
function advanceTime(seconds) {
  return global.__demoRuntime.advanceTime(seconds);
}

// =================================================================
// TRANSACTION BUILDER API
// =================================================================

/**
 * Begins the construction of a new transaction.
 * This is the primary entry point for all on-chain actions.
 * @param {string} signerWallet - The name of the wallet that will sign this transaction.
 * @returns {object} A TransactionBuilder instance to chain operations on.
 */
function newTransaction(signerWallet) {
  return global.__demoRuntime.newTransaction(signerWallet);
}


// =================================================================
// UTILITY & WATCHER FUNCTIONS (for UI integration)
// =================================================================

/**
 * Pauses execution until a condition is met or a timeout occurs.
 * @param {Function} condition - A function that returns true when the wait should end.
 * @param {number} [timeout=30000] - The maximum time to wait in milliseconds.
 * @returns {Promise<void>}
 */
function waitFor(condition, timeout = 30000) {
  return global.__demoRuntime.waitFor(condition, timeout);
}

/**
 * Sets up a watcher to monitor a wallet's balance.
 * @param {string} walletName - The name of the wallet to watch.
 * @param {Function|null} [formatter=null] - An optional function to format the output string.
 * @returns {Promise<object>}
 */
function watchBalance(walletName, formatter = null) {
  return global.__demoRuntime.watchBalance(walletName, formatter);
}

/**
 * Sets up a watcher to monitor the state (UTxOs) of a contract.
 * @param {string} address - The Bech32 address of the contract to watch.
 * @param {Function|null} [formatter=null] - An optional function to format the output string.
 * @returns {Promise<object>}
 */
function watchContractState(address, formatter = null) {
  return global.__demoRuntime.watchContractState(address, formatter);
}

/**
 * Sets up a watcher to monitor a wallet's UTxO set.
 * @param {string} walletName - The name of the wallet to watch.
 * @param {Function|null} [formatter=null] - An optional function to format the output string.
 * @returns {Promise<object>}
 */
function watchWalletUtxos(walletName, formatter = null) {
  return global.__demoRuntime.watchWalletUtxos(walletName, formatter);
}


/**
 * Loads contract details from a blueprint file by its name.
 * @param {string} filePath - Path to the plutus.json file.
 * @param {string} contractName - The name of the contract validator.
 * @returns {Promise<{compiledCode: string, scriptHash: string, contractAddress: string}>}
 */
function loadContract(filePath, contractName) {
  return global.__demoRuntime.loadContract(filePath, contractName);
}


module.exports = {
  // Core API
  createWallet,
  getBalance,
  getWalletUtxos,
  getContractState,
  advanceTime,
  loadContract,

  // Transaction Builder
  newTransaction,

  // Utilities & Watchers
  waitFor,
  watchBalance,
  watchContractState,
  watchWalletUtxos,
};
