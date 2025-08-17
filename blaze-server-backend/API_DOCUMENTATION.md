# Blaze Server Backend API Documentation

A production-ready HTTP server for Cardano smart contract development using the Blaze SDK and Emulator.

## Overview

This server provides a stateful HTTP API for managing Cardano transactions, wallets, and smart contracts in an emulated environment. It's designed for development, testing, and prototyping Cardano applications.

## 🚨 Critical Constraints

### Single Client Architecture
- **ONE client at a time** - The server maintains a single session
- **Serial session usage** - Sessions are replaced, not concurrent
- **No session sharing** - Each new session destroys the previous one

### Session Lifecycle
```
Client A creates session → Server active for Client A
Client B creates session → Client A session destroyed, Server now for Client B
```

## Quick Start

### Installation
```bash
npm install aiken-demo-backend
```

### Start Server
```bash
# Development
npm run dev

# Production  
npm start

# Or use the CLI
npx blaze-server
```

Server runs on `http://localhost:3031` by default.

## API Reference

### 1. Session Management

#### Create New Session
```http
POST /api/session/new
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid-string",
  "createdAt": "2024-01-01T12:00:00.000Z"
}
```

**⚠️ Important:** Creating a new session destroys any existing session.

### 2. Wallet Management

#### Register Wallet
```http
POST /api/wallet/register
Content-Type: application/json

{
  "sessionId": "your-session-id",
  "name": "alice",
  "initialBalance": "10000000"
}
```

**Response:**
```json
{
  "success": true,
  "walletName": "alice", 
  "balance": "10000000"
}
```

**Notes:**
- Balance in lovelace (1 ADA = 1,000,000 lovelace)
- Wallet names must be unique within a session
- Wallets are destroyed when session ends

#### Transfer Funds
```http
POST /api/wallet/transfer
Content-Type: application/json

{
  "sessionId": "your-session-id",
  "fromWallet": "alice",
  "toWallet": "bob", 
  "amount": "5000000"
}
```

#### Get Wallet Balance
```http
GET /api/wallet/{walletName}/balance?sessionId=your-session-id
```

#### Get Wallet UTXOs
```http
GET /api/wallet/{walletName}/utxos?sessionId=your-session-id
```

### 3. UTXO Management

#### Create UTXO Directly
```http
POST /api/utxo/create
Content-Type: application/json

{
  "sessionId": "your-session-id",
  "address": "addr_test1q...",
  "amount": "5000000",
  "datum": 42,
  "referenceScript": "590a4f590a4c..." // Optional
}
```

**Response:**
```json
{
  "success": true,
  "utxo": {
    "txHash": "1111111111111111111111111111111111111111111111111111111111111111",
    "outputIndex": 0,
    "address": "addr_test1q...",
    "amount": "5000000",
    "datum": 42
  }
}
```

**Notes:**
- **Phase Restriction**: Only available BEFORE any transactions are processed in the session
- Creates UTXOs directly in emulator state (no transaction overhead)
- Perfect for test setup and fixture creation
- `datum` is optional - simple integer datums supported
- `referenceScript` is optional - hex-encoded Plutus bytecode for reference scripts
- Amount in lovelace (1 ADA = 1,000,000 lovelace)

**Phase Validation:**
```json
// After any transaction is processed:
{
  "success": false,
  "error": "Cannot create UTXOs after transactions have been processed"
}
```

### 4. Smart Contract Operations

#### Get Contract Balance
```http
GET /api/contract/{scriptHash}/balance?sessionId=your-session-id
```

#### Get Contract UTXOs
```http
GET /api/contract/{contractAddress}/utxos?sessionId=your-session-id
```

### 4. Advanced Transaction Building

#### Build and Submit Complex Transaction
```http
POST /api/transaction/build-and-submit
Content-Type: application/json

{
  "sessionId": "your-session-id",
  "signerWallet": "alice",
  "operations": [
    {
      "type": "spend-from-wallet",
      "walletName": "alice",
      "amount": "10000000"
    },
    {
      "type": "pay-to-contract", 
      "contractAddress": "script-hash",
      "amount": "3000000",
      "datum": 100
    },
    {
      "type": "pay-to-address",
      "address": "addr_test1...",
      "amount": "2000000"
    }
  ]
}
```

**Operation Types:**
- `spend-from-wallet` - Use wallet UTXOs as inputs (automatic selection)
- `spend-specific-utxos` - Use specific UTXOs by txHash + outputIndex array
- `spend-utxo` - Use single specific UTXO by txHash + outputIndex  
- `unlock-utxo` - Unlock contract UTXO with redeemer and script
- `pay-to-address` - Send to wallet address (with optional reference script)
- `pay-to-contract` - Lock to contract with datum and compiled code

### 5. Time Management

#### Get Current Emulator Time
```http
GET /api/emulator/current-time?sessionId=your-session-id
```

**Response:**
```json
{
  "success": true,
  "currentSlot": 1000,
  "currentUnixTime": 1640995200
}
```

**Notes:**
- Returns emulator's internal time state (not system time)
- `currentSlot` is the current Cardano slot number
- `currentUnixTime` is Unix timestamp (seconds since epoch)

#### Advance Emulator Time
```http
POST /api/emulator/advance-time
Content-Type: application/json

{
  "sessionId": "your-session-id",
  "targetUnixTime": 1640995200
}
```

**Response:**
```json
{
  "success": true,
  "newSlot": 2000,
  "slotsAdvanced": 1000
}
```

**Notes:**
- Fast-forwards emulator time to target Unix timestamp
- Enables testing of time-based contract logic
- `newSlot` shows final slot after advancement
- `slotsAdvanced` shows how many slots were jumped

### 6. Network Information

#### Get Network Tip
```http
GET /api/network/tip?sessionId=your-session-id
```

### 7. Logging Control

#### Get Logging Status
```http
GET /api/logging
```

**Response:**
```json
{
  "success": true,
  "enabled": false
}
```

#### Enable/Disable Logging
```http
POST /api/logging
Content-Type: application/json

{
  "enabled": true
}
```

**Response:**
```json
{
  "success": true,
  "enabled": true,
  "message": "Logging enabled"
}
```

**Notes:**
- **Default**: Logging is disabled by default to reduce noise in unit tests
- **Scope**: Controls HTTP request/response logging for all endpoints
- **Format**: When enabled, logs include timestamps and request/response details
- **Persistence**: Logging state persists for the server's runtime
- **Use Case**: Enable for debugging web app interactions, disable for clean test output

**Example Usage:**
```javascript
// Enable logging for debugging
await fetch('/api/logging', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({enabled: true})
});

// Check current status
const status = await fetch('/api/logging');
const {enabled} = await status.json();

// Disable logging for clean tests
await fetch('/api/logging', {
  method: 'POST', 
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({enabled: false})
});
```

**Log Output Format (when enabled):**
```
[2024-01-15T10:30:45.123Z] [BlazeBackend] POST /api/wallet/register {
  "query": {},
  "body": {"sessionId": "session_123", "name": "alice", "initialBalance": "10000000"},
  "sessionId": "session_123"
}
[2024-01-15T10:30:45.456Z] [BlazeBackend] POST /api/wallet/register -> 200 {
  "statusCode": 200,
  "responseData": "{\"success\":true,\"walletName\":\"alice\",\"balance\":\"10000000\"}"
}
```

## Example Workflows

### Basic Wallet Operations
```javascript
// 1. Create session
const session = await fetch('/api/session/new', {method: 'POST'});
const {sessionId} = await session.json();

// 2. Register wallets
await fetch('/api/wallet/register', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    name: 'alice',
    initialBalance: '100000000' // 100 ADA
  })
});

// 3. Transfer funds
await fetch('/api/wallet/transfer', {
  method: 'POST', 
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    fromWallet: 'alice',
    toWallet: 'bob',
    amount: '25000000' // 25 ADA
  })
});
```

### Smart Contract Lifecycle (Traditional Transaction-Based)
```javascript
// 1. Lock funds to contract with datum using build-and-submit
const lockResp = await fetch('/api/transaction/build-and-submit', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    signerWallet: 'alice',
    operations: [{
      type: 'pay-to-contract',
      contractAddress: 'script-hash-hex',
      compiledCode: 'your-plutus-bytecode',
      amount: '10000000',
      datum: 42
    }]
  })
});

// 2. Unlock funds with matching redeemer
await fetch('/api/transaction/build-and-submit', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    signerWallet: 'bob',
    operations: [{
      type: 'unlock-utxo',
      txHash: 'contract-utxo-tx-hash',
      outputIndex: 0,
      redeemer: 42,
      compiledCode: 'your-plutus-bytecode'
    }]
  })
});
```

### Efficient Test Setup with Direct UTXO Creation
```javascript
// 1. Create session and register wallet
const session = await fetch('/api/session/new', {method: 'POST'});
const {sessionId} = await session.json();

await fetch('/api/wallet/register', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    name: 'alice',
    initialBalance: '100000000'
  })
});

// 2. Get alice's address for UTXO creation
const utxosResp = await fetch(`/api/wallet/alice/utxos?sessionId=${sessionId}`);
const utxosData = await utxosResp.json();
const aliceAddress = utxosData.utxos[0].address;

// 3. SETUP PHASE: Create test UTXOs directly (no transaction overhead)
await fetch('/api/utxo/create', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    address: aliceAddress,
    amount: '8000000' // Additional funds for alice
  })
});

await fetch('/api/utxo/create', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    address: 'contract-bech32-address',
    amount: '5000000',
    datum: 42 // Contract UTXO ready for testing
  })
});

// 4. TEST PHASE: Now run actual transaction logic
await fetch('/api/transaction/build-and-submit', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    signerWallet: 'alice',
    operations: [{
      type: 'unlock-utxo',
      txHash: 'created-utxo-tx-hash',
      outputIndex: 0,
      redeemer: 42,
      compiledCode: 'your-plutus-bytecode'
    }]
  })
});
```

### Time-Based Contract Testing
```javascript
// 1. Set up contract with time-locked datum
const currentTimeResp = await fetch(`/api/emulator/current-time?sessionId=${sessionId}`);
const {currentUnixTime} = await currentTimeResp.json();
const lockUntil = currentUnixTime + 3600; // Lock for 1 hour

await fetch('/api/utxo/create', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    address: 'time-locked-contract-address',
    amount: '10000000',
    datum: lockUntil
  })
});

// 2. Try to unlock before time (should fail)
await fetch('/api/transaction/build-and-submit', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    signerWallet: 'alice',
    operations: [{
      type: 'unlock-utxo',
      txHash: 'time-locked-utxo-hash',
      outputIndex: 0,
      redeemer: 0
    }]
  })
}); // Should fail with time validation error

// 3. Fast-forward time and unlock successfully
await fetch('/api/emulator/advance-time', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    targetUnixTime: lockUntil + 1
  })
});

await fetch('/api/transaction/build-and-submit', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    signerWallet: 'alice',
    operations: [{
      type: 'unlock-utxo',
      txHash: 'time-locked-utxo-hash',
      outputIndex: 0,
      redeemer: 0
    }]
  })
}); // Should succeed
```

## ✅ Best Practices

### Session Management
```javascript
// ✅ GOOD - Single client creates one session
const sessionResp = await fetch('/api/session/new', {method: 'POST'});
const {sessionId} = await sessionResp.json();

// Use sessionId for all subsequent requests
```

```javascript
// ❌ BAD - Multiple clients competing
// Client A creates session
const sessionA = await fetch('/api/session/new', {method: 'POST'});

// Client B creates session (destroys Client A's session!)
const sessionB = await fetch('/api/session/new', {method: 'POST'});

// Client A's requests will now fail with "Invalid session ID"
```

### Error Handling
```javascript
// ✅ GOOD - Check response status
const response = await fetch('/api/wallet/transfer', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({sessionId, fromWallet: 'alice', toWallet: 'bob', amount: '1000000'})
});

if (!response.ok) {
  const error = await response.json();
  console.error('Transfer failed:', error.error);
  return;
}

const result = await response.json();
if (!result.success) {
  console.error('Transfer failed:', result.error);
  return;
}
```

### Contract Address vs Script Hash
```javascript
// ✅ GOOD - Use script hash for operations
const scriptHash = 'computed-from-compiled-code';
const contractAddress = 'computed-bech32-address';

// Use script hash for pay-to-contract operations
await fetch('/api/transaction/build-and-submit', {
  body: JSON.stringify({
    sessionId, 
    signerWallet: 'alice',
    operations: [{
      type: 'pay-to-contract',
      contractAddress: scriptHash,
      compiledCode: 'your-plutus-bytecode',
      ...
    }]
  })
});

// Use contractAddress (bech32) for UTXO queries  
await fetch(`/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
```

### UTXO Creation Phase Management
```javascript
// ✅ GOOD - Use UTXO creation for setup, transactions for testing
const {sessionId} = await (await fetch('/api/session/new', {method: 'POST'})).json();

// SETUP PHASE - Create test fixtures efficiently
await fetch('/api/utxo/create', {
  body: JSON.stringify({sessionId, address: aliceAddress, amount: '5000000'})
});

// TEST PHASE - Run actual transaction logic  
await fetch('/api/transaction/build-and-submit', {
  body: JSON.stringify({sessionId, signerWallet: 'alice', operations: [...]})
});

// ❌ BAD - Cannot create UTXOs after transaction phase begins
await fetch('/api/utxo/create', {...}); // 400 Error: "Cannot create UTXOs after transactions have been processed"
```

### Time Management for Testing
```javascript
// ✅ GOOD - Test time-based logic with emulator time control
const currentTime = await fetch(`/api/emulator/current-time?sessionId=${sessionId}`);
const {currentUnixTime} = await currentTime.json();

// Create time-locked contract
await fetch('/api/utxo/create', {
  body: JSON.stringify({
    sessionId,
    address: contractAddress,
    datum: currentUnixTime + 3600, // 1 hour lock
    amount: '10000000'
  })
});

// Fast-forward past lock time
await fetch('/api/emulator/advance-time', {
  body: JSON.stringify({sessionId, targetUnixTime: currentUnixTime + 3601})
});

// Now test can proceed with unlocking
```

### Performance Considerations
```javascript
// ✅ GOOD - Direct UTXO creation for test setup (70% faster)
await fetch('/api/utxo/create', {
  body: JSON.stringify({sessionId, address: contractAddress, datum: 42, amount: '5000000'})
}); // Instant - no transaction processing

// ❌ SLOWER - Transaction-based setup (still valid for integration tests)  
await fetch('/api/transaction/build-and-submit', {
  body: JSON.stringify({
    sessionId,
    signerWallet: 'alice',
    operations: [{type: 'pay-to-contract', ...}]
  })
}); // Requires full transaction processing
```

### Logging Management
```javascript
// ✅ GOOD - Disable logging for unit tests
await fetch('/api/logging', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({enabled: false})
});

// Run tests with clean output
await fetch('/api/wallet/register', {...}); // No logging noise

// ✅ GOOD - Enable logging for debugging web app interactions
await fetch('/api/logging', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({enabled: true})
});

// Debug with detailed request/response logs
await fetch('/api/wallet/register', {...}); // Full logging output
```

```javascript
// ✅ GOOD - Check logging status before enabling
const status = await fetch('/api/logging');
const {enabled} = await status.json();

if (!enabled) {
  await fetch('/api/logging', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({enabled: true})
  });
}
```

```javascript
// ❌ BAD - Don't leave logging enabled in production tests
// This creates excessive noise and slows down test execution
await fetch('/api/logging', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({enabled: true})
});

// Run all tests with verbose logging...
// Results in thousands of log lines and slower execution
```

### Transaction IDs Are Real
```javascript
// ✅ The server returns REAL transaction IDs
const response = await fetch('/api/wallet/transfer', {...});
const {transactionId} = await response.json();

// This transaction ID is cryptographically valid and matches actual UTXOs
// You can verify it exists in wallet UTXOs
const utxos = await fetch(`/api/wallet/alice/utxos?sessionId=${sessionId}`);
const utxoList = await utxos.json();
const matchingUtxo = utxoList.utxos.find(u => u.txHash === transactionId);
// matchingUtxo will exist!
```

## ❌ Common Mistakes

### Session Conflicts
```javascript
// ❌ DON'T create multiple sessions
const session1 = await fetch('/api/session/new', {method: 'POST'});
const session2 = await fetch('/api/session/new', {method: 'POST'}); // Destroys session1!

// ❌ DON'T share sessions between different workflows
// Each client should create its own session
```

### Invalid Contract References
```javascript
// ❌ DON'T use contract names (they don't exist)
await fetch('/api/contract/my-contract/balance', {...}); // 404 Not Found

// ✅ DO use contract addresses for queries
await fetch(`/api/contract/${contractAddress}/utxos`, {...}); // Works
```

### Insufficient Funds
```javascript
// ❌ This will fail if alice only has 1 ADA
await fetch('/api/wallet/transfer', {
  body: JSON.stringify({
    sessionId,
    fromWallet: 'alice',
    toWallet: 'bob', 
    amount: '5000000' // 5 ADA
  })
});
// Response: 400 Bad Request {"success": false, "error": "Insufficient funds for transfer"}
```

### Wrong Datum/Redeemer Pairs
```javascript
// ❌ This will fail - redeemer doesn't match datum
await fetch('/api/transaction/build-and-submit', {
  body: JSON.stringify({
    sessionId,
    signerWallet: 'alice',
    operations: [{type: 'pay-to-contract', datum: 42, ...}]
  })
});

await fetch('/api/transaction/build-and-submit', {
  body: JSON.stringify({
    sessionId,
    signerWallet: 'alice', 
    operations: [{type: 'unlock-utxo', redeemer: 99, ...}] // Wrong!
  })
});
// Response: 400 Bad Request {"success": false, "error": "Script validation failed"}
```

## Environment Configuration

```bash
# Server port (default: 3001)
PORT=3001

# Environment mode
NODE_ENV=production

# Start server
npm start
```

## Response Format

All endpoints return JSON with this structure:

**Success:**
```json
{
  "success": true,
  "field1": "value1",
  "field2": "value2"
}
```

**Error:**
```json
{
  "success": false,
  "error": "Description of what went wrong"
}
```

## Transaction Fees

The emulator automatically calculates and deducts transaction fees. Expect ~0.17-0.2 ADA fees for typical transactions.

## Development vs Production

- **Development**: Rich debugging output, detailed transaction logs
- **Production**: Clean startup messages, essential logging only

## When to Use Each Approach

### Direct UTXO Creation (`/api/utxo/create`)
**Best for:**
- Test fixture setup and preparation
- Creating known contract states quickly
- Performance-sensitive test suites
- Rapid prototyping and development

**Characteristics:**
- ⚡ Instant execution (no transaction processing)
- 🔒 Setup phase only (before any transactions)
- 🎯 Perfect for establishing baseline conditions
- 📊 70% faster than transaction-based setup

### Transaction-Based Operations (`/api/transaction/build-and-submit`)
**Best for:**
- Testing actual contract logic and validation
- Real-world transaction flow simulation
- Integration testing with full transaction lifecycle
- Production-like behavior verification

**Characteristics:**
- 🔐 Full cryptographic validation and processing
- 🌐 Real transaction IDs and UTXO relationships
- 📋 Complete fee calculation and deduction
- ✅ Script execution and validation

### Hybrid Approach (Recommended)
```javascript
// 1. SETUP: Use direct UTXO creation for test fixtures
await fetch('/api/utxo/create', {
  body: JSON.stringify({sessionId, address: contractAddress, datum: 42, amount: '5000000'})
});

// 2. TEST: Use transactions for actual business logic
await fetch('/api/transaction/build-and-submit', {
  body: JSON.stringify({
    sessionId,
    signerWallet: 'alice', 
    operations: [{type: 'unlock-utxo', redeemer: 42, ...}]
  })
});
```

This combination provides **efficient setup** with **realistic testing**.

## Architecture Notes

- Built on **Blaze SDK** for Cardano integration
- Uses **Cardano Emulator** for deterministic blockchain simulation
- **Plutus V3** smart contract support
- **Ed25519** signature scheme for multisig operations
- **Real transaction IDs** - not faked or mocked
- **Phase-based session management** for optimal test performance

---

For bugs or feature requests, see the project repository.