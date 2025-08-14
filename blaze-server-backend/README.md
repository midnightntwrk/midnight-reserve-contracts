# Blaze Server Backend

A production-ready HTTP server for Cardano smart contract development using the Blaze SDK and Emulator. Provides a complete API for managing wallets, transactions, and smart contracts in an emulated Cardano environment.

## Quick Start

### Server Installation & Usage
```bash
# Install
npm install aiken-demo-backend

# Start server
npm start
# Server runs on http://localhost:3031

# Or use CLI
npx blaze-server
```

### Client Example
```javascript
// 1. Create session (destroys any existing session)
const session = await fetch('http://localhost:3031/api/session/new', {method: 'POST'});
const {sessionId} = await session.json();

// 2. Register wallet with initial funds
await fetch('http://localhost:3031/api/wallet/register', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    name: 'alice',
    initialBalance: '100000000' // 100 ADA in lovelace
  })
});

// 3. Deploy smart contract
const deployResp = await fetch('http://localhost:3031/api/contract/deploy', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    deployerWallet: 'alice',
    compiledCode: 'your-compiled-plutus-bytecode', // From plutus.json
    datumSchema: {thing: 'BigInt'},
    redeemerSchema: 'BigInt'
  })
});
const {contractAddress} = await deployResp.json();
```

## 🚨 Critical Architecture Constraints

### Single Client Design
- **ONE client at a time** - Server maintains single session
- **Serial sessions** - New session destroys previous one
- **No concurrency** - Not designed for multiple simultaneous clients

### Cardano Standards
- **Script hash identification** - Contracts identified by cryptographic hash, not names
- **Real transaction IDs** - All returned transaction IDs are cryptographically valid
- **Plutus V3** - Smart contract platform version
- **Ed25519** signatures for multisig operations

## Smart Contract Development with Aiken

### Writing Validators

Write validators in the `validators` folder using `.ak` extension:

```aiken
use cardano/transaction.{OutputReference, Transaction}

pub type MyDatum {
  thing: Int,
}

// Simple validator: datum must equal redeemer
validator hello_world {
  spend(
    datum: Option<MyDatum>,
    redeemer: Int,
    _output_ref: OutputReference,
    _context: Transaction,
  ) {
    when datum is {
      None -> False
      Some(d) -> d.thing == redeemer
    }
  }
  
  else(_) {
    fail
  }
}
```

### Building & Compiling

```bash
# Compile Aiken contracts
aiken build

# Generates plutus.json with compiled bytecode
```

### Generating Blueprints
To expose the contract code to the offchain simply run `just build-validators`

Then the validators, datum types, and redeemer types are accessible via
```ts
import { MyDatum, HelloWorldHelloWorldSpend } from "../../utils/contracts";
```

This generates TypeScript bindings in `src/utils/contracts.ts` that provide:
- **Type-safe datum/redeemer structures**
- **Compiled contract classes** 
- **Automatic CBOR serialization**

The compiled bytecode from `plutus.json` is what you use in the deploy API:

```json
{
  "validators": [
    {
      "title": "hello_world.hello_world.spend",
      "compiledCode": "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009",
      "hash": "5b7e059453488d25906a7920dfe4b750ff4bd8c0afb6fecf8721b050"
    }
  ]
}
```

### Testing Aiken Contracts

You can write tests in any module using the `test` keyword. For example:

```aiken
use config

test hello_world_basic() {
  // Test that datum 42 validates with redeemer 42
  let datum = Some(MyDatum { thing: 42 })
  let redeemer = 42
  hello_world.spend(datum, redeemer, test_output_ref, test_context)
}

test hello_world_mismatch() fail {
  // Test that mismatched datum/redeemer fails
  let datum = Some(MyDatum { thing: 42 })
  let redeemer = 99
  hello_world.spend(datum, redeemer, test_output_ref, test_context)
}

test config_check() {
  config.network_id + 1 == 42
}
```

```bash
# Run all Aiken tests
aiken check

# Run specific tests matching string
aiken check -m hello_world

# Run tests matching "foo"
aiken check -m foo
```

### Configuration

**aiken.toml**
```toml
name = "your-project"
version = "0.0.0"
compiler = "v1.1.19"
plutus = "v3"

[config.default]
network_id = 41  # Testnet
```

Or, alternatively, write conditional environment modules under `env`.

### Documentation

If you're writing a library, you might want to generate an HTML documentation for it.

Use:
```bash
aiken docs
```

## Complete Smart Contract Workflow

### 1. Contract Development Cycle
```bash
# 1. Write validator in validators/my_contract.ak
# 2. Test the validator logic
aiken check

# 3. Compile to bytecode
aiken build

# 4. Generate TypeScript bindings
just build-validators

# 5. Extract compiledCode from plutus.json OR use generated classes
# 6. Use in server API calls
```

### 2. Server Integration Example

**Option A: Using plutus.json directly**
```javascript
// Load compiled contract from plutus.json
const plutusJson = require('./plutus.json');
const spendValidator = plutusJson.validators.find(
  v => v.title === 'hello_world.hello_world.spend'
);
const compiledCode = spendValidator.compiledCode;
```

**Option B: Using generated TypeScript bindings (recommended)**
```javascript
// Import generated contract class
import { HelloWorldHelloWorldSpend, MyDatum } from './src/utils/contracts';

// Create contract instance
const contract = new HelloWorldHelloWorldSpend();
const compiledCode = contract.Script.toCbor(); // Get CBOR hex string
```

**Deploy to server:**
```javascript
const deployResp = await fetch('/api/contract/deploy', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    deployerWallet: 'alice',
    compiledCode, // Use the compiled bytecode
    datumSchema: {thing: 'BigInt'},
    redeemerSchema: 'BigInt'
  })
});

const {contractAddress, contractId} = await deployResp.json();
// contractId is the script hash: "5b7e059453488d25906a7920dfe4b750ff4bd8c0afb6fecf8721b050"
```

### 3. Lock & Unlock Pattern
```javascript
// Lock funds with datum
await fetch('/api/contract/lock', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    fromWallet: 'alice',
    contractAddress,
    amount: '10000000', // 10 ADA
    datum: '42' // This value goes into MyDatum.thing
  })
});

// Later: unlock with matching redeemer
await fetch('/api/contract/invoke', {
  method: 'POST', 
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId,
    fromWallet: 'bob',
    contractAddress,
    redeemer: '42' // Must match datum for this validator
  })
});
```

## Key API Endpoints

### Session Management
- `POST /api/session/new` - Create new session (destroys existing)

### Wallet Operations  
- `POST /api/wallet/register` - Create wallet with initial funds
- `POST /api/wallet/transfer` - Transfer between wallets
- `GET /api/wallet/{name}/balance` - Query wallet balance
- `GET /api/wallet/{name}/utxos` - List wallet UTXOs

### Contract Operations
- `POST /api/contract/deploy` - Deploy smart contract from bytecode
- `POST /api/contract/lock` - Lock funds to contract with datum
- `POST /api/contract/invoke` - Unlock contract funds with redeemer
- `GET /api/contract/{scriptHash}/balance` - Query contract balance
- `GET /api/contract/{address}/utxos` - List contract UTXOs

### Advanced Transactions
- `POST /api/transaction/build-and-submit` - Multi-operation transactions

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for complete API reference with examples.

## ✅ Best Practices for Client Developers

### Session Management
```javascript
// ✅ GOOD - One client, one session
const {sessionId} = await createSession();
// Use this sessionId for all operations

// ❌ BAD - Multiple sessions conflict
const session1 = await createSession(); // Client A
const session2 = await createSession(); // Client B destroys A's session!
```

### Contract Identification
```javascript
// ✅ GOOD - Use script hash for balance queries
await fetch(`/api/contract/${contractId}/balance?sessionId=${sessionId}`);

// ✅ GOOD - Use contract address for lock/invoke operations  
await fetch('/api/contract/lock', {
  body: JSON.stringify({sessionId, contractAddress, ...})
});

// ❌ BAD - Contract names don't exist
await fetch('/api/contract/my-contract/balance'); // 404 Not Found
```

### Error Handling
```javascript
// ✅ GOOD - Always check success field
const response = await fetch('/api/wallet/transfer', {...});
const result = await response.json();

if (!result.success) {
  console.error('Transfer failed:', result.error);
  // Handle error (insufficient funds, invalid session, etc.)
  return;
}

// Proceed with successful result
console.log('Transfer successful:', result.transactionId);
```

### Datum/Redeemer Matching
```javascript
// ✅ GOOD - Matching datum and redeemer
await lockFunds({datum: '42'});
await unlockFunds({redeemer: '42'}); // Works!

// ❌ BAD - Mismatched values  
await lockFunds({datum: '42'});
await unlockFunds({redeemer: '99'}); // Fails: "No UTXO found that accepts redeemer '99'"
```

## Transaction Fees & Balances

- Fees automatically calculated (~0.17-0.2 ADA typical)
- Balances in lovelace (1 ADA = 1,000,000 lovelace)
- Always check sufficient funds before operations

## Development Tools

### Aiken Resources
- [Aiken Language Guide](https://aiken-lang.org)
- [Plutus V3 Documentation](https://plutus.readthedocs.io/)
- [Cardano Developer Portal](https://developers.cardano.org/)

### Signature Scheme
If using multisig then make sure to use the Ed25519 Signature Scheme.

### Server Features
- Real transaction IDs (cryptographically valid)
- Deterministic emulator environment  
- Complete UTXO tracking
- Comprehensive error messages

---

**For detailed API documentation with all endpoints, examples, and error codes, see [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)**
