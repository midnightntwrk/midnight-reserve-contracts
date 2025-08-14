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

### 3. Smart Contract Operations

#### Deploy Contract
```http
POST /api/contract/deploy
Content-Type: application/json

{
  "sessionId": "your-session-id",
  "deployerWallet": "alice",
  "compiledCode": "590a4f590a4c01000033...",
  "datumSchema": {"thing": "BigInt"},
  "redeemerSchema": "BigInt"
}
```

**Response:**
```json
{
  "success": true,
  "contractId": "5b7e059453488d25906a7920dfe4b750ff4bd8c0afb6fecf8721b050",
  "contractAddress": "addr_test1wpdhupv52dyg6fvsdfujphlykag07j7cczhmdlk0susmq5qkvz5qs",
  "deployedAt": "2024-01-01T12:00:00.000Z"
}
```

**Notes:**
- `contractId` is the script hash (Cardano standard)
- `compiledCode` is hex-encoded Plutus bytecode
- Use `contractAddress` for locking/invoking operations

#### Lock Funds to Contract
```http
POST /api/contract/lock
Content-Type: application/json

{
  "sessionId": "your-session-id",
  "fromWallet": "alice",
  "contractAddress": "addr_test1w...",
  "amount": "5000000",
  "datum": "42"
}
```

#### Invoke Contract (Unlock Funds)
```http
POST /api/contract/invoke
Content-Type: application/json

{
  "sessionId": "your-session-id", 
  "fromWallet": "alice",
  "contractAddress": "addr_test1w...",
  "redeemer": "42"
}
```

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
- `spend-from-wallet` - Use wallet UTXOs as inputs
- `spend-utxo` - Use specific UTXO by txHash + outputIndex  
- `unlock-utxo` - Unlock contract UTXO with redeemer
- `pay-to-address` - Send to wallet address
- `pay-to-contract` - Lock to contract with datum

### 5. Network Information

#### Get Network Tip
```http
GET /api/network/tip?sessionId=your-session-id
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

### Smart Contract Lifecycle
```javascript
// 1. Deploy contract
const deployResp = await fetch('/api/contract/deploy', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    deployerWallet: 'alice',
    compiledCode: 'your-plutus-bytecode',
    datumSchema: {thing: 'BigInt'},
    redeemerSchema: 'BigInt'
  })
});
const {contractAddress} = await deployResp.json();

// 2. Lock funds with datum
await fetch('/api/contract/lock', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    fromWallet: 'alice', 
    contractAddress,
    amount: '10000000',
    datum: '42'
  })
});

// 3. Unlock funds with matching redeemer
await fetch('/api/contract/invoke', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    fromWallet: 'bob',
    contractAddress, 
    redeemer: '42' // Must match datum for this contract
  })
});
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
// ✅ GOOD - Use contractAddress for operations
const {contractAddress, contractId} = deployResponse;

// Use contractAddress for lock/invoke operations
await fetch('/api/contract/lock', {
  body: JSON.stringify({sessionId, contractAddress, ...})
});

// Use contractId (script hash) for balance queries  
await fetch(`/api/contract/${contractId}/balance?sessionId=${sessionId}`);
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

// ✅ DO use script hashes or addresses
await fetch(`/api/contract/${contractId}/balance`, {...}); // Works
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
await fetch('/api/contract/lock', {
  body: JSON.stringify({sessionId, contractAddress, amount: '1000000', datum: '42'})
});

await fetch('/api/contract/invoke', {
  body: JSON.stringify({sessionId, contractAddress, redeemer: '99'}) // Wrong!
});
// Response: 400 Bad Request {"success": false, "error": "No UTXO found that accepts redeemer '99'"}
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

## Architecture Notes

- Built on **Blaze SDK** for Cardano integration
- Uses **Cardano Emulator** for deterministic blockchain simulation
- **Plutus V3** smart contract support
- **Ed25519** signature scheme for multisig operations
- **Real transaction IDs** - not faked or mocked

---

For bugs or feature requests, see the project repository.