# Demo System User Guide

The Demo System provides an interactive environment for creating and running blockchain demos with smart contracts. This guide covers how to create demos, use the built-in functions, and integrate with the contract development workflow.

## Table of Contents

1. [Overview](#overview)
2. [Creating Demos](#creating-demos)
3. [Contract Development Workflow](#contract-development-workflow)
4. [Built-in Functions](#built-in-functions)
5. [Transaction Builder API](#transaction-builder-api)
6. [Demo Configuration](#demo-configuration)
7. [Running Demos](#running-demos)
8. [Troubleshooting](#troubleshooting)

## Overview

The Demo System consists of:

- **Demo Files (.demonb)**: JSON-based demo scripts with markdown and JavaScript code blocks
- **Demo Server**: Express server that executes demos and manages sessions
- **Monadic Functions**: High-level JavaScript functions for blockchain operations
- **Transaction Builder**: Fluent API for constructing complex transactions
- **Web Interface**: Browser-based demo runner with real-time output

## Creating Demos

### Demo File Structure

Demo files use the `.demonb` extension and contain:

```json
{
  "name": "My Demo",
  "description": "Description of what this demo demonstrates",
  "version": "1.0",
  "config": {
    "baseUrl": "http://localhost:3041"
  },
  "stanzas": [
    {
      "name": "introduction",
      "blocks": [
        {
          "type": "markdown",
          "content": ["# Introduction", "", "This demo shows..."]
        },
        {
          "type": "code",
          "language": "javascript",
          "content": [
            "// JavaScript code here",
            "wallet = await createWallet('alice', 10_000_000);"
          ]
        }
      ]
    }
  ]
}
```

### Stanza Structure

Each stanza contains:
- **name**: Unique identifier for the stanza
- **blocks**: Array of markdown and code blocks
- **markdown**: Documentation and explanations
- **code**: JavaScript code that uses monadic functions

## Contract Development Workflow

### Overview

The demo system integrates seamlessly with the Aiken contract development workflow, allowing you to test contracts as you develop them.

### Step-by-Step Workflow

1. **Write Aiken Contract**
   ```bash
   # Create or edit your contract
   vim validators/my_contract.ak
   ```

2. **Build and Test**
   ```bash
   # Build the contract
   aiken build
   
   # Run unit tests
   aiken test
   ```

3. **Generate Blueprint**
   ```bash
   # Generate blueprint JSON
   aiken blueprint build
   ```

4. **Load Contract in Demo**
   ```javascript
   // Load contract details from blueprint
   const contractInfo = await loadContract('./plutus.json', 'my_contract');
   console.log(`Script hash: ${contractInfo.scriptHash}`);
   console.log(`Contract address: ${contractInfo.contractAddress}`);
   ```

5. **Use in Transactions**
   ```javascript
   // Use the contract in transactions
   const tx = await newTransaction('alice')
     .payToContract(contractInfo.scriptHash, contractInfo.compiledCode, 3_000_000, 42)
     .submit();
   ```

6. **Iterate**
   - Make changes to contract
   - Rebuild: `aiken build && aiken test && aiken blueprint build`
   - Demo automatically picks up changes

### Benefits

- **Fast Iteration**: Change contract → rebuild → demo reflects immediately
- **Proper Testing**: Unit tests run before demo testing
- **Blueprint Benefits**: Type safety, parameter validation, documentation
- **Direct Loading**: Load contracts directly from blueprint files
- **No Config Overhead**: No need to pre-configure contracts in demo files

## Built-in Functions

The demo system provides high-level monadic functions that abstract away HTTP calls and session management.

### Wallet Operations

#### `createWallet(name, initialBalance)`
Creates a new wallet with the specified initial balance.

```javascript
// Create Alice's wallet with 10 ADA
alice = await createWallet('alice', 10_000_000);
console.log(`Wallet created: ${alice.name} with ${alice.balance} lovelace`);
```

**Parameters:**
- `name` (string): Wallet name
- `initialBalance` (number): Initial balance in lovelace

**Returns:** `{name: string, balance: string}`

#### `getBalance(name)`
Gets the current balance of a wallet.

```javascript
balance = await getBalance('alice');
console.log(`Alice's balance: ${balance} lovelace`);
```

**Parameters:**
- `name` (string): Wallet name

**Returns:** `string` (balance in lovelace)

#### `getWalletUtxos(walletName)`
Gets all UTXOs for a wallet.

```javascript
utxos = await getWalletUtxos('alice');
console.log(`Alice has ${utxos.length} UTXOs`);
```

**Parameters:**
- `walletName` (string): Wallet name

**Returns:** `Array<object>` (wallet UTXOs)

### Contract Operations

#### `loadContract(filePath, contractName)`
Loads contract details from a blueprint file.

```javascript
const contractInfo = await loadContract('./plutus.json', 'hello_world');
console.log(`Script hash: ${contractInfo.scriptHash}`);
console.log(`Contract address: ${contractInfo.contractAddress}`);
console.log(`Compiled code: ${contractInfo.compiledCode}`);
```

**Parameters:**
- `filePath` (string): Path to the plutus.json file
- `contractName` (string): The name of the contract validator

**Returns:** `{compiledCode: string, scriptHash: string, contractAddress: string}`

#### `getContractState(contractAddress)`
Gets the current state of a contract (UTXOs).

```javascript
contractState = await getContractState(contractAddress);
console.log(`Contract UTXOs: ${contractState.length} total`);
```

**Parameters:**
- `address` (string): Contract address

**Returns:** `Array<object>` (contract UTXOs)

### Emulator Operations

#### `advanceTime(seconds)`
Advances time in the emulator.

```javascript
result = await advanceTime(3600); // Advance 1 hour
console.log(`New slot: ${result.newSlot}`);
```

**Parameters:**
- `seconds` (number): Seconds to advance

**Returns:** `{newSlot: number}`

### Watcher Functions

#### `watchBalance(walletName, formatter)`
Watches a wallet's balance for changes.

```javascript
// Use default formatter (shows ADA)
watcher = await watchBalance('alice');

// Or use custom formatter
watcher = await watchBalance('alice', (balance) => 
  `${(parseInt(balance)/1000000).toFixed(6)} ADA`
);
```

**Parameters:**
- `walletName` (string): Wallet name to watch
- `formatter` (Function): Optional formatter function (default shows ADA)

**Returns:** `{name: string, status: string}`

#### `watchContractState(address, formatter)`
Watches a contract's state for changes.

```javascript
// Use default formatter (shows UTXO count, total ADA, and datum)
watcher = await watchContractState(contractAddress);

// Or use custom formatter
watcher = await watchContractState(contractAddress, (utxos) => 
  `${utxos.length} UTXOs, ${(utxos.reduce((sum, u) => sum + parseInt(u.amount), 0)/1000000).toFixed(6)} ADA`
);
```

**Parameters:**
- `address` (string): Contract address to watch
- `formatter` (Function): Optional formatter function (default shows UTXO count, total ADA, and datum)

**Returns:** `{name: string, status: string}`

#### `watchWalletUtxos(walletName, formatter)`
Watches a wallet's UTXOs for changes.

```javascript
// Use default formatter (shows UTXO count and total ADA)
watcher = await watchWalletUtxos('alice');

// Or use custom formatter
watcher = await watchWalletUtxos('alice', (utxos) => 
  `${utxos.length} UTXOs, ${(utxos.reduce((sum, u) => sum + parseInt(u.amount), 0)/1000000).toFixed(6)} ADA`
);
```

**Parameters:**
- `walletName` (string): Wallet name to watch
- `formatter` (Function): Optional formatter function (default shows UTXO count and total ADA)

**Returns:** `{name: string, status: string}`

### Utility Functions

#### `waitFor(condition, timeout)`
Waits for a specific condition to be met.

```javascript
await waitFor(async () => {
  balance = await getBalance('alice');
  return parseInt(balance) > 5_000_000;
}, 30000); // Wait up to 30 seconds
```

**Parameters:**
- `condition` (Function): Function that returns true when condition is met
- `timeout` (number): Maximum wait time in milliseconds (default: 30000)

**Returns:** `Promise<void>`

## Transaction Builder API

The Transaction Builder provides a fluent API for constructing complex transactions. All on-chain operations now use this pattern.

### Basic Usage

```javascript
// Start building a transaction
const tx = await newTransaction('alice')
  .payToAddress(address, 1_000_000)
  .submit();

console.log(`Transaction ID: ${tx.transactionId}`);
```

### Available Methods

#### `newTransaction(signerWallet)`
Begins construction of a new transaction.

```javascript
const tx = await newTransaction('alice');
```

**Parameters:**
- `signerWallet` (string): Wallet name that will sign the transaction

**Returns:** `TransactionBuilder` instance

#### `spendUtxos(utxos)`
Specifies specific UTXOs to spend in the transaction.

```javascript
const tx = await newTransaction('alice')
  .spendUtxos([utxo1, utxo2])
  .submit();
```

**Parameters:**
- `utxos` (Array): Array of UTXO objects to spend

**Returns:** `TransactionBuilder` (for chaining)

#### `payToAddress(address, amount, options)`
Pays funds to a specific address.

```javascript
const tx = await newTransaction('alice')
  .payToAddress('addr1...', 1_000_000)
  .submit();

// With reference script
const tx = await newTransaction('alice')
  .payToAddress('addr1...', 2_000_000, { 
    referenceScript: compiledCode 
  })
  .submit();
```

**Parameters:**
- `address` (string): Destination address
- `amount` (number): Amount in lovelace
- `options` (object): Optional parameters including `referenceScript`

**Returns:** `TransactionBuilder` (for chaining)

#### `payToContract(scriptHash, compiledCode, amount, datum)`
Locks funds to a contract with a datum.

```javascript
const tx = await newTransaction('alice')
  .payToContract(scriptHash, compiledCode, 3_000_000, 42)
  .submit();
```

**Parameters:**
- `scriptHash` (string): Contract script hash
- `compiledCode` (string): Compiled contract code
- `amount` (number): Amount in lovelace
- `datum` (any): Datum value

**Returns:** `TransactionBuilder` (for chaining)

#### `unlockUtxo(lockedUtxo, redeemer, compiledCode, options)`
Unlocks funds from a contract using a redeemer.

```javascript
const tx = await newTransaction('alice')
  .unlockUtxo(lockedUtxo, 42, compiledCode, {
    referenceScriptUtxo: refScriptUtxo
  })
  .submit();
```

**Parameters:**
- `lockedUtxo` (object): The UTXO to unlock
- `redeemer` (any): Redeemer value
- `compiledCode` (string): Compiled contract code
- `options` (object): Optional parameters including `referenceScriptUtxo`

**Returns:** `TransactionBuilder` (for chaining)

#### `mint(policyId, assetName, amount, options)`
Mints tokens using a minting policy.

```javascript
const tx = await newTransaction('alice')
  .mint(policyId, 'MyNFT', 1, {
    redeemer: {},
    referenceScriptUtxo: refScriptUtxo
  })
  .submit();
```

**Parameters:**
- `policyId` (string): Minting policy ID
- `assetName` (string): Asset name (converted to hex automatically)
- `amount` (number): Amount to mint
- `options` (object): Optional parameters including `redeemer` and `referenceScriptUtxo`

**Returns:** `TransactionBuilder` (for chaining)

#### `addCollateral(utxos)`
Adds collateral UTXOs for complex transactions.

```javascript
const tx = await newTransaction('alice')
  .addCollateral([collateralUtxo])
  .payToContract(scriptHash, compiledCode, 3_000_000, datum)
  .submit();
```

**Parameters:**
- `utxos` (Array): Array of UTXO objects to use as collateral

**Returns:** `TransactionBuilder` (for chaining)

#### `submit()`
Submits the transaction to the blockchain.

```javascript
const result = await newTransaction('alice')
  .payToAddress(address, 1_000_000)
  .submit();

console.log(`Transaction ID: ${result.transactionId}`);
console.log(`Created UTXOs: ${result.createdUtxos.length}`);
```

**Returns:** `{transactionId: string, createdUtxos: Array}`

### Complete Examples

#### Simple Transfer
```javascript
// Transfer 10 ADA from Alice to Bob
const bobAddress = (await getWalletUtxos('bob'))[0].address;
const tx = await newTransaction('alice')
  .payToAddress(bobAddress, 10_000_000)
  .submit();

console.log(`Transfer completed: ${tx.transactionId}`);
```

#### Contract Interaction
```javascript
// Load contract
const contractInfo = await loadContract('./plutus.json', 'hello_world');

// Lock funds to contract
const lockTx = await newTransaction('alice')
  .payToContract(contractInfo.scriptHash, contractInfo.compiledCode, 3_000_000, 42)
  .submit();

// Get the locked UTXO
const lockedUtxo = lockTx.createdUtxos.find(u => u.address === contractInfo.contractAddress);

// Unlock funds
const unlockTx = await newTransaction('alice')
  .unlockUtxo(lockedUtxo, 42, contractInfo.compiledCode, {
    referenceScriptUtxo: refScriptUtxo
  })
  .submit();
```

#### NFT Minting
```javascript
// Load minting policy
const policyInfo = await loadContract('./plutus.json', 'simple_mint');

// Create reference script
const setupTx = await newTransaction('alice')
  .payToAddress(aliceAddress, 2_000_000, { referenceScript: policyInfo.compiledCode })
  .submit();

const refScriptUtxo = setupTx.createdUtxos.find(u => u.amount === '2000000');

// Mint NFT
const mintTx = await newTransaction('alice')
  .mint(policyInfo.scriptHash, 'MyNFT', 1, {
    redeemer: {},
    referenceScriptUtxo: refScriptUtxo
  })
  .submit();
```

## Demo Configuration

### Server Configuration

```json
{
  "config": {
    "baseUrl": "http://localhost:3041"
  }
}
```

**Note**: Contract configuration is no longer needed in the demo file. Contracts are loaded directly from blueprint files using the `loadContract` function.

## Running Demos

### Starting the Demo Environment

```bash
# Start all demo servers
bun run demo:start

# Start with logging enabled
bun run demo:start:logging
```

This starts:
- Blaze Backend (port 3041)
- Demo Server (port 3042)
- Web Interface (port 8080)

### Running Demos

1. **Web Interface**: Open http://localhost:8080
2. **Upload Demo**: Select your `.demonb` file
3. **Execute**: Click through stanzas to run the demo
4. **Watch Output**: See real-time results and state changes

### Command Line

```bash
# Run demo from command line
bun run demo:run ./demo-flows/my-demo.demonb
```

## Troubleshooting

### Common Issues

**Demo Server Not Starting**
- Check if port 3042 is available
- Ensure all dependencies are installed
- Check server logs for errors

**Contract Not Found**
- Verify blueprint file path is correct
- Ensure blueprint file exists and is valid JSON
- Check that contract name matches the validator title in blueprint

**Function Not Defined**
- Ensure you're using the correct function names
- Check that the demo server is running
- Verify function imports in the demo system

**Transaction Failures**
- Check wallet balances
- Verify contract parameters
- Ensure UTXOs are available for spending
- Check that reference scripts are properly created

**Asset Name Issues**
- Asset names are automatically converted to hex
- Maximum length is 32 bytes
- Use simple strings like 'MyNFT' or hex strings

### Debug Mode

Enable debug mode to see detailed logs:

```javascript
// In demo configuration
{
  "config": {
    "debug": true
  }
}
```

### Getting Help

- Check the demo examples in `demo-flows/`
- Review the built-in function documentation above
- Check server logs for detailed error messages
- Ensure your contract development workflow is correct