# Demo System User Guide

The Demo System provides an interactive environment for creating and running blockchain demos with smart contracts. This guide covers how to create demos, use the built-in functions, and integrate with the contract development workflow.

## Table of Contents

1. [Overview](#overview)
2. [Creating Demos](#creating-demos)
3. [Contract Development Workflow](#contract-development-workflow)
4. [Built-in Functions](#built-in-functions)
5. [Demo Configuration](#demo-configuration)
6. [Running Demos](#running-demos)
7. [Troubleshooting](#troubleshooting)

## Overview

The Demo System consists of:

- **Demo Files (.demonb)**: JSON-based demo scripts with markdown and JavaScript code blocks
- **Demo Server**: Express server that executes demos and manages sessions
- **Monadic Functions**: High-level JavaScript functions for blockchain operations
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
    "baseUrl": "http://localhost:3031",
    "contracts": {
      "my_contract": {
        "blueprint": "./validators/my_contract/blueprint.json"
      }
    }
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

4. **Create Demo**
   ```json
   {
     "config": {
       "contracts": {
         "my_contract": {
           "blueprint": "./validators/my_contract/blueprint.json"
         }
       }
     }
   }
   ```

5. **Test in Demo**
   ```javascript
   // Use the contract in your demo
   referenceScripts = await createReferenceScript('my_contract', { 
     wallet: 'alice' 
   });
   ```

6. **Iterate**
   - Make changes to contract
   - Rebuild: `aiken build && aiken test && aiken blueprint build`
   - Demo automatically picks up changes

### Benefits

- **Fast Iteration**: Change contract → rebuild → demo reflects immediately
- **Proper Testing**: Unit tests run before demo testing
- **Blueprint Benefits**: Type safety, parameter validation, documentation
- **Hot Reload**: Demo server watches blueprint files for changes
- **No Compilation Overhead**: Demo server just reads JSON

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

#### `transfer(from, to, amount)`
Transfers funds between wallets.

```javascript
result = await transfer('alice', 'bob', 1_000_000);
console.log(`Transfer completed: ${result.txId}`);
```

**Parameters:**
- `from` (string): Source wallet name
- `to` (string): Destination wallet name or address
- `amount` (number): Amount in lovelace

**Returns:** `{txId: string}`

### Contract Operations

#### `createReferenceScript(name, params)`
Creates reference scripts for a contract using the modern Babbage-era approach.

```javascript
referenceScripts = await createReferenceScript('hello_world', { 
  wallet: 'alice' 
});
console.log(`Script hash: ${referenceScripts.scriptHash}`);
console.log(`Contract address: ${referenceScripts.contractAddress}`);
```

**Parameters:**
- `name` (string): Contract name (must exist in config.contracts)
- `params` (object): Parameters including wallet name

**Returns:** `{refScriptUtxo: object, spendingUtxo: object, scriptHash: string, contractAddress: string}`

#### `lockToContract(contractAddress, params)`
Locks funds to a contract with a datum.

```javascript
lockResult = await lockToContract(scriptHash, {
  amount: 3_000_000, // 3 ADA
  datum: 42,
  spendingUtxo: spendingUtxo,
  contractName: 'hello_world',
  wallet: 'alice'
});
console.log(`Funds locked: ${lockResult.txId}`);
```

**Parameters:**
- `contractAddress` (string): Contract address (script hash)
- `params` (object): Parameters including amount, datum, spendingUtxo, contractName, wallet

**Returns:** `{txId: string, lockedUtxo: object}`

#### `unlockFromContract(lockedUtxo, refScriptUtxo, params)`
Unlocks funds from a contract using reference scripts.

```javascript
unlockResult = await unlockFromContract(lockedUtxo, refScriptUtxo, {
  redeemer: 42, // Must match the datum value
  returnAddress: aliceAddress,
  wallet: 'alice'
});
console.log(`Funds unlocked: ${unlockResult.txId}`);
```

**Parameters:**
- `lockedUtxo` (object): The UTXO to unlock
- `refScriptUtxo` (object): Reference script UTXO
- `params` (object): Parameters including redeemer, returnAddress, wallet

**Returns:** `{txId: string, unlockedAmount: string}`

#### `getContractState(address)`
Gets the current state of a contract (UTXOs).

```javascript
contractState = await getContractState(contractAddress);
console.log(`Contract UTXOs: ${contractState.utxos.length} total`);
```

**Parameters:**
- `address` (string): Contract address

**Returns:** `object` (contract state/UTXOs)

### Emulator Operations

#### `advanceTime(seconds)`
Advances time in the emulator.

```javascript
result = await advanceTime(3600); // Advance 1 hour
console.log(`New time: ${result.newTime}`);
```

**Parameters:**
- `seconds` (number): Seconds to advance

**Returns:** `{newTime: number}`

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

### Watch Operations

#### `watchBalance(walletName, formatter)`
Watches a wallet's balance for changes.

```javascript
watcher = await watchBalance('alice', (data) => 
  `${data.balance} lovelace`
);
```

**Parameters:**
- `walletName` (string): Wallet name to watch
- `formatter` (Function): Optional formatter function

**Returns:** `{name: string, status: string}`

#### `watchContractState(address, formatter)`
Watches a contract's state for changes.

```javascript
watcher = await watchContractState(contractAddress, (data) => 
  `${data.utxos.length} UTXOs`
);
```

**Parameters:**
- `address` (string): Contract address to watch
- `formatter` (Function): Optional formatter function

**Returns:** `{name: string, status: string}`

#### `watchWalletUtxos(walletName, formatter)`
Watches a wallet's UTXOs for changes.

```javascript
watcher = await watchWalletUtxos('alice', (data) => 
  `${data.utxos.length} UTXOs`
);
```

**Parameters:**
- `walletName` (string): Wallet name to watch
- `formatter` (Function): Optional formatter function

**Returns:** `{name: string, status: string}`

#### `watchCustom(name, endpoint, formatter, options)`
Watches a custom endpoint.

```javascript
watcher = await watchCustom('custom', '/api/custom/endpoint', 
  (data) => JSON.stringify(data, null, 2)
);
```

**Parameters:**
- `name` (string): Watcher name
- `endpoint` (string): API endpoint to watch
- `formatter` (Function): Formatter function
- `options` (object): Optional configuration

**Returns:** `{name: string, status: string}`

#### `watch(name, query, formatter)`
Generic watch function.

```javascript
watcher = await watch('generic', { type: 'custom', data: 'value' }, 
  (data) => data.toString()
);
```

**Parameters:**
- `name` (string): Watcher name
- `query` (object): Query specification
- `formatter` (Function): Formatter function

**Returns:** `{name: string, status: string}`

### Failure-Expecting Variants

#### `createWalletExpectFailure(name, initialBalance)`
Expects wallet creation to fail.

```javascript
try {
  await createWalletExpectFailure('invalid', -1000);
} catch (error) {
  console.log('Expected failure:', error.message);
}
```

#### `transferExpectFailure(from, to, amount)`
Expects transfer to fail.

```javascript
try {
  await transferExpectFailure('alice', 'bob', 999999999);
} catch (error) {
  console.log('Expected failure:', error.message);
}
```

## Demo Configuration

### Contract Configuration

Contracts can be specified using blueprint file paths:

```json
{
  "config": {
    "contracts": {
      "hello_world": {
        "blueprint": "./validators/hello_world/blueprint.json"
      },
      "my_contract": {
        "blueprint": "../other-project/contracts/my_contract/blueprint.json"
      }
    }
  }
}
```

### Server Configuration

```json
{
  "config": {
    "baseUrl": "http://localhost:3031"
  }
}
```

## Running Demos

### Starting the Demo Environment

```bash
# Start all demo servers
bun run demo:serve
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
bun run demo:test ./demo-flows/my-demo.demonb
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
- Check file permissions

**Function Not Defined**
- Ensure you're using the correct function names
- Check that the demo server is running
- Verify function imports in the demo system

**Transaction Failures**
- Check wallet balances
- Verify contract parameters
- Ensure UTXOs are available for spending

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
