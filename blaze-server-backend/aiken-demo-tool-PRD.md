# Aiken Contract Demo Tool - PRD

## Overview

A lightweight, session-based tool for rapidly prototyping and demonstrating Aiken smart contracts. The tool provides an isolated blockchain environment where developers can quickly set up complex scenarios with multiple wallets and contracts, test interactions, and tear down cleanly - all without the overhead of real network deployment.

## The Problem

Developing and demonstrating Cardano smart contracts is currently expensive and slow:
- **Real network deployment** requires ADA and time
- **Complex scenarios** need multiple wallets, contracts, and state setup
- **Testing interactions** between contracts is difficult
- **Cleanup** after demos is manual and error-prone
- **Reproducible scenarios** are hard to create and share

## The Solution

A server that acts as both **wallet backend** and **Cardano network**, providing:
- **Single demo session**: One active blockchain state at a time
- **Rapid setup**: Pre-configured wallets and contracts
- **Realistic interactions**: Actual transaction execution with state changes
- **Easy reset**: Simple session replacement for fresh demos
- **Reproducible scenarios**: Save and replay complex setups

## Key Use Cases

### 1. Contract Development & Testing
```
Scenario: Testing a governance contract with multiple stakeholders
- Alice (council member) with 1000 ADA
- Bob (voter) with 500 ADA  
- Governance contract deployed
- Test voting, proposal creation, execution
- Clean up and start fresh
```

### 2. Demo Presentations
```
Scenario: Showing a DeFi protocol interaction
- User wallet with 2000 ADA
- Liquidity pool contract deployed
- Staking contract deployed
- Demonstrate deposit, swap, withdraw flows
- Reset for next audience
```

### 3. Educational Workshops
```
Scenario: Teaching Cardano development
- Multiple student wallets
- Simple "Hello World" contract
- Complex multi-step scenario
- Students can experiment safely
- Instructor can reset state easily
```

## Architecture Philosophy

The server plays **multiple roles** to simplify client development:

**🎯 Wallet Backend**: Generates keys, manages balances, signs transactions
**🌐 Cardano Network**: Provides blockchain state, validates transactions  
**📦 Contract Registry**: Deploys and manages available contracts
**🗄️ Session Manager**: Manages current demo session, enables rapid reset

This allows clients to focus on **business logic** rather than infrastructure.

## Architecture

```
┌─────────────────┐    ┌───────────────────┐    ┌─────────────────┐
│   TypeScript    │    │   Node.js         │    ┌   Aiken         │
│     Client      │◄──►│   Backend         │◄──►│   Contracts     │
│   (Builds Tx)   │    │   (Wallet/Network)│    │                 │
│                 │    │   + Ref Scripts    │    │                 │
└─────────────────┘    └───────────────────┘    └─────────────────┘
```

### Reference Script Support

The backend provides **native reference script support** using Blaze SDK:

- **Easy Deployment**: Deploy reference scripts with simple API calls
- **Automatic Management**: Server tracks all deployed reference scripts
- **State Queries**: Find all contracts using a specific reference script
- **Realistic Patterns**: Mirrors how reference scripts work on mainnet

## Backend Server

### Purpose
- Provide wallet services using Blaze SDK's natural patterns
- Provide network services (transaction submission, state queries)
- Run single Cardano emulator instance (Blaze) for current demo session
- Support realistic transaction building workflow
- **Contract Registry**: Automatically compile and load Aiken contracts from the `contracts/` directory at startup

### API Endpoints

#### Session Management
```
POST /api/session/new
Response:
{
  "success": true,
  "sessionId": "sess_abc123",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

**Session Lifecycle:**
- Only one active session at a time
- Creating new session destroys any existing session
- All operations require valid session ID
- Invalid/expired session IDs return error responses
- No public endpoint to retrieve current session - clients must remember their session ID
- If client loses session ID, they must create a new session

#### Wallet Services (Blaze-Native)
```
POST /api/wallet/register
{
  "sessionId": "sess_abc123",
  "name": "alice",
  "initialBalance": "100000000" // 100 ADA in lovelace
}

Response:
{
  "success": true,
  "walletName": "alice",
  "address": "addr_test1...",
  "balance": "100000000"
}
```

```
GET /api/wallet/{walletName}/balance?sessionId=sess_abc123
GET /api/wallet/{walletName}/utxos?sessionId=sess_abc123
```

#### Network Services
```
GET /api/sessions/{sessionId}/network/tip
GET /api/sessions/{sessionId}/network/parameters
```

#### Wallet Signing Services
```
POST /api/sessions/{sessionId}/wallet/{walletName}/sign
{
  "transactionBody": "hex-encoded-cbor-transaction-body"
}

Response:
{
  "success": true,
  "witnesses": ["hex-encoded-witnesses"]
}
```

```
POST /api/sessions/{sessionId}/wallet/{walletName}/sign-and-submit
{
  "transactionBody": "hex-encoded-cbor-transaction-body"
}

Response:
{
  "success": true,
  "txHash": "abc123...",
  "slot": 12345
}
```

#### Contract Services
```
GET /api/sessions/{sessionId}/contracts/available
Response:
{
  "contracts": [
    {
      "name": "hello_world",
      "module": "hello_world", 
      "validator": "hello_world",
      "compiledCode": "hex...",
      "scriptHash": "hex...",
      "address": "addr_test1..."
    }
  ]
}

POST /api/sessions/{sessionId}/contracts/{contractName}/instantiate
{
  "parameters": ["tokenName", "outputReference"],
  "values": ["gift_card_001", {"txHash": "hex...", "outputIndex": 0}]
}

Response:
{
  "success": true,
  "instantiatedValidator": {
    "type": "PlutusV3",
    "script": "hex...",
    "scriptHash": "hex...",
    "address": "addr_test1..."
  },
  "policyId": "hex...",
  "lockAddress": "addr_test1..."
}
```

```
POST /api/sessions/{sessionId}/contracts/estimate-fee
{
  "walletName": "alice",
  "contractId": "addr_test1...",
  "action": "spend",
  "inputs": ["txHash#0"],
  "outputs": [
    {
      "address": "addr_test1...",
      "amount": "1000000"
    }
  ],
  "datum": { "type": "integer", "value": 42 },
  "redeemer": { "type": "integer", "value": 42 }
}

Response:
{
  "success": true,
  "estimatedFee": "170000",
  "minUtxo": "1000000",
  "requiredInputs": ["txHash#0", "txHash#1"]
}

Note: The server performs automatic coin selection from the specified wallet to satisfy transaction requirements. The `requiredInputs` array includes both user-specified inputs and server-selected inputs.
```

#### State Queries
```
GET /api/sessions/{sessionId}/state/utxos
GET /api/sessions/{sessionId}/state/contracts/{contractId}
GET /api/sessions/{sessionId}/state/transactions

GET /api/sessions/{sessionId}/state/contracts/by-script/{scriptHash}
Response:
{
  "contracts": [
    {
      "contractId": "addr_test1...",
      "scriptHash": "hex...",
      "utxos": [
        {
          "txHash": "abc123...",
          "outputIndex": 0,
          "address": "addr_test1...",
          "amount": "1000000",
          "datum": { "type": "bytes", "value": "gift_card_001" }
        }
      ],
      "totalValue": "5000000",
      "lastActivity": "2024-01-15T10:30:00Z"
    }
  ]
}

#### Reference Script Services
```
POST /api/sessions/{sessionId}/reference-scripts/deploy
{
  "scriptHash": "hex...",
  "script": "hex-encoded-cbor-script"
}

Response:
{
  "success": true,
  "referenceScriptId": "ref_abc123",
  "scriptHash": "hex...",
  "deployedAt": "2024-01-15T10:30:00Z"
}
```

```
GET /api/sessions/{sessionId}/reference-scripts
Response:
{
  "referenceScripts": [
    {
      "referenceScriptId": "ref_abc123",
      "scriptHash": "hex...",
      "deployedAt": "2024-01-15T10:30:00Z",
      "usageCount": 5
    }
  ]
}
```

### Server Features
- **Session Isolation**: Each session has its own isolated emulator instance
- **Blaze-Native Wallet Management**: Uses `emulator.register()` and `emulator.as()` patterns
- **Wallet Signing Services**: Provides transaction signing as a wallet backend
- **Network Services**: Transaction submission, state queries, fee estimation
- **Contract Services**: Pre-compiled contracts + parameterization (client-side computation support)
- **Reference Script Support**: Easy deployment and management of reference scripts
- **Per-Contract State Queries**: Find all contracts by script hash with detailed UTXO information
- **Real Emulator**: Uses Blaze Cardano SDK for authentic transaction simulation
- **Error Handling**: Provides clear error messages for failed operations

### Standard Error Response Format
All endpoints return errors in this consistent format:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "A descriptive error message."
  }
}
```

## TypeScript Client

### Purpose
- Build complete transactions locally
- Interact with wallet and network services using Blaze patterns
- Provide type-safe interfaces for all operations
- Handle realistic Cardano development workflow

### Client API

```typescript
interface AikenDemoClient {
  // Session management
  createSession(name: string, description?: string): Promise<SessionInfo>;
  listSessions(): Promise<SessionInfo[]>;
  getSession(sessionId: string): Promise<SessionInfo>;
  deleteSession(sessionId: string): Promise<void>;
  
  // Wallet operations (Blaze-native)
  registerWallet(sessionId: string, name: string, initialBalance?: string): Promise<WalletInfo>;
  getBalance(sessionId: string, walletName: string): Promise<BalanceInfo>;
  getUtxos(sessionId: string, walletName: string): Promise<UtxoInfo[]>;
  
  // Network operations
  getNetworkTip(sessionId: string): Promise<NetworkTip>;
  getNetworkParameters(sessionId: string): Promise<NetworkParameters>;
  
  // Wallet signing services
  signTransaction(sessionId: string, walletName: string, transactionBody: string): Promise<SigningResult>;
  signAndSubmitTransaction(sessionId: string, walletName: string, transactionBody: string): Promise<TransactionResult>;
  
  // Contract operations
  getAvailableContracts(sessionId: string): Promise<ContractInfo[]>;
  instantiateContract(sessionId: string, contractName: string, parameters: string[], values: any[]): Promise<InstantiatedContract>;
  estimateContractFee(sessionId: string, params: EstimateFeeParams): Promise<FeeEstimate>;
  
  // Reference script operations
  deployReferenceScript(sessionId: string, scriptHash: string, script: string): Promise<ReferenceScriptInfo>;
  getReferenceScripts(sessionId: string): Promise<ReferenceScriptInfo[]>;
  
  // State queries
  getState(sessionId: string): Promise<ChainState>;
  getContractState(sessionId: string, contractId: string): Promise<ContractState>;
  getContractsByScript(sessionId: string, scriptHash: string): Promise<ContractState[]>;
}

interface WalletInfo {
  walletName: string;
  address: string;
  balance: string;
}

interface BalanceInfo {
  lovelace: string;
  assets: Record<string, string>;
}

interface SigningResult {
  witnesses: string[];
}

interface FeeEstimate {
  estimatedFee: string;
  minUtxo: string;
  requiredInputs: string[];
}

interface InstantiatedContract {
  success: boolean;
  instantiatedValidator: {
    type: string;
    script: string;
    scriptHash: string;
    address: string;
  };
  policyId?: string;
  lockAddress?: string;
}

interface ContractInfo {
  name: string;
  module: string;
  validator: string;
  compiledCode: string;
  scriptHash: string;
  address: string;
}

interface ContractState {
  contractId: string;
  scriptHash: string;
  utxos: UtxoInfo[];
  totalValue: string;
  lastActivity: string;
}

interface ReferenceScriptInfo {
  referenceScriptId: string;
  scriptHash: string;
  deployedAt: string;
  usageCount: number;
}

interface EstimateFeeParams {
  walletName: string;
  contractId: string;
  action: 'spend' | 'mint' | 'withdraw';
  inputs: string[];
  outputs: TransactionOutput[];
  datum?: any;
  redeemer?: any;
}
```

### Client Features
- **Transaction Building**: Client builds complete transaction bodies locally
- **Blaze-Native Wallet Integration**: Uses `emulator.register()` and `emulator.as()` patterns
- **Wallet Signing Integration**: Gets witnesses from server wallet backend
- **Fee Estimation**: Get accurate fee estimates before submitting
- **Type Safety**: Full TypeScript support with proper interfaces
- **Error Handling**: Graceful error handling with meaningful messages
- **Realistic Workflow**: Mirrors actual Cardano development patterns

## Test Case: Hello World Contract

### Aiken Contract
```aiken
pub fn hello_world(datum: Int, redeemer: Int, context: ScriptContext) -> Bool {
  datum == redeemer
}
```

### Client Usage Example
```typescript
import { AikenDemoClient } from './client';

async function demoHelloWorld() {
  const client = new AikenDemoClient('http://localhost:3031');
  
  // Create a new session (isolated blockchain)
  const session = await client.createSession('hello-world-demo', 'Testing hello world contract');
  console.log('Created session:', session.sessionId);
  
  // Register a wallet using Blaze pattern
  const wallet = await client.registerWallet(session.sessionId, 'alice', '100000000');
  console.log('Registered wallet:', wallet.address);
  
  // Check balance
  const balance = await client.getBalance(session.sessionId, 'alice');
  console.log('Wallet balance:', balance.lovelace);
  
  // Get available contracts
  const contracts = await client.getAvailableContracts(session.sessionId);
  const helloWorldContract = contracts.find(c => c.name === 'hello_world');
  
  // 1. Build a transaction to lock funds at the contract address
  // NOTE: This requires a Cardano transaction building library like CSL or Lucid
  const lockTxBodyCbor = buildLockTx({
    walletUtxos: await client.getUtxos(session.sessionId, 'alice'),
    contractAddress: helloWorldContract.address,
    datum: 42, // An integer datum
    amount: '2000000', // 2 ADA
  });

  // Server signs and submits
  const lockTxResult = await client.signAndSubmitTransaction(
    session.sessionId,
    'alice',
    lockTxBodyCbor // hex-encoded CBOR transaction body
  );
  console.log('Lock transaction submitted:', lockTxResult.txHash);

  // 2. Build a transaction to spend the locked UTXO
  // NOTE: Requires a transaction building library
  const unlockTxBodyCbor = buildUnlockTx({
    contractUtxo: findLockedUtxo(lockTxResult.txHash), // find the UTXO from the lock tx
    walletUtxos: await client.getUtxos(session.sessionId, 'alice'), // for collateral and fees
    redeemer: 42, // The correct redeemer
    script: helloWorldContract.compiledCode
  });

  // Server signs and submits
  const unlockTxResult = await client.signAndSubmitTransaction(
    session.sessionId,
    'alice',
    unlockTxBodyCbor
  );
  console.log('Unlock transaction submitted:', unlockTxResult.txHash);
  
  // Query contracts by script hash
  const contractStates = await client.getContractsByScript(
    session.sessionId, 
    helloWorldContract.scriptHash
  );
  
  console.log('Contracts with this script:', contractStates.length);
  contractStates.forEach(state => {
    console.log(`Contract ${state.contractId}: ${state.utxos.length} UTXOs, ${state.totalValue} lovelace`);
  });
}

// Helper functions (would use a Cardano transaction building library)
function buildLockTx(params: any): string {
  // Implementation would use CSL, Lucid, or similar
  // to build and serialize the transaction body to CBOR
  return "hex-encoded-cbor-transaction-body";
}

function buildUnlockTx(params: any): string {
  // Implementation would use CSL, Lucid, or similar
  // to build and serialize the transaction body to CBOR
  return "hex-encoded-cbor-transaction-body";
}

function findLockedUtxo(txHash: string): any {
  // Implementation to find the UTXO created by the lock transaction
  return { txHash, outputIndex: 0 };
}
}
```

## Project Structure

```
aiken-demo-tool/
├── backend/
│   ├── src/
│   │   ├── server.ts
│   │   ├── services/
│   │   │   ├── SessionManager.ts
│   │   │   ├── WalletService.ts
│   │   │   ├── NetworkService.ts
│   │   │   ├── ContractService.ts
│   │   │   └── EmulatorService.ts
│   │   └── types/
│   │       └── index.ts
│   ├── contracts/
│   │   └── hello_world.ak
│   ├── plutus.json (auto-generated from contracts/)
│   └── package.json
├── client/
│   ├── src/
│   │   ├── AikenDemoClient.ts
│   │   ├── TransactionBuilder.ts
│   │   └── types.ts
│   └── package.json
├── examples/
│   └── hello-world-demo.ts
└── README.md
```

## Success Criteria

1. **✅ Session Management**: Create, list, and delete isolated blockchain sessions
2. **✅ Blaze-Native Wallet Services**: Use `emulator.register()` and `emulator.as()` patterns
3. **✅ Network Services**: Submit transactions, query state, get network info
4. **✅ Contract Services**: List available contracts, estimate fees
5. **✅ Client Transaction Building**: Client builds complete transactions locally
6. **✅ Realistic Workflow**: Mirrors actual Cardano development patterns
7. **✅ Type Safety**: Full TypeScript support with proper error handling

## Assumptions

- Aiken and Blaze SDK work together without API incompatibilities
- No Docker required (direct installation of dependencies)
- Simple, focused scope without complex governance scenarios
- Real emulator behavior (not fake/mock implementations)
- Client handles transaction building (like real Cardano development)
- Blaze SDK's `emulator.register()` and `emulator.as()` patterns are used naturally

## Next Steps

1. Set up project structure
2. Implement session management with isolated emulator instances
3. Implement wallet services using Blaze's `register()` and `as()` patterns
4. Implement network services (transaction submission, state queries)
5. Implement contract services (available contracts, fee estimation)
6. Create TypeScript client with transaction building capabilities
7. Add hello world contract example
8. Test end-to-end workflow with realistic transaction building 

## Suggested Reading

- https://github.com/SundaeSwap-finance/treasury-contracts/blob/ed17bce07fdef56df0d347b1cd806f099ca55434/offchain/src/treasury/fund/index.ts
