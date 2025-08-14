# Emulator Capabilities Research Report: Recommended New Endpoints

## Executive Summary

This report analyzes the current server capabilities, examines Sundae Treasury's advanced emulator usage patterns, and recommends new endpoints to enhance the demo tool's functionality. A critical finding is that the current time advancement approach is extremely inefficient and should be replaced with direct emulator time manipulation.

## Current Server Capabilities Analysis

### **Currently Exposed Endpoints:**
1. **Session Management**: `/api/session/new`
2. **Wallet Operations**: `/api/wallet/register`, `/api/wallet/transfer`, `/api/wallet/:walletName/balance`, `/api/wallet/:walletName/utxos`
3. **Contract Operations**: `/api/contract/deploy`, `/api/contract/lock`, `/api/contract/invoke`, `/api/contract/:scriptHash/balance`, `/api/contract/:contractAddress/utxos`
4. **Transaction Building**: `/api/transaction/build-and-submit`
5. **Network Info**: `/api/network/tip`

### **Current Emulator Usage:**
- `emulator.register()` - Wallet registration
- `emulator.as()` - Context switching
- `emulator.expectValidTransaction()` - Transaction submission
- `emulator.clock.slot` - Current slot access
- `emulator.mockedWallets` - Wallet tracking
- `blaze.provider.getUnspentOutputs()` - UTXO queries

## Sundae Treasury Emulator Tricks Analysis

### **Advanced Emulator Capabilities Used:**
1. **`emulator.fund()`** - Direct funding without registration
2. **`emulator.publishScript()`** - Script publication for reference
3. **`emulator.lookupScript()`** - Script retrieval by hash
4. **`emulator.stepForwardToUnix()`** - Time advancement to specific Unix timestamp
5. **`emulator.accounts.set()`** - Direct reward account funding
6. **`emulator.addUtxo()`** - Manual UTXO creation
7. **`emulator.utxos()`** - Direct UTXO access
8. **`emulator.unixToSlot()`** - Time conversion utilities

## Critical Finding: Time Advancement Inefficiency

### **Current Time Advancement (What We Have) - INEFFICIENT**

**Method**: Using transactions to advance time
- **Approach**: Submit empty or minimal transactions to trigger slot advancement
- **Efficiency**: ~1 slot per transaction (extremely inefficient)
- **Example**: To advance 1 week (604,800 slots) requires ~604,800 transactions
- **Performance**: Extremely slow for large time advances

**Current Implementation**:
```typescript
// Current approach: Submit transactions to advance time
const tx = blaze.newTransaction().payLovelace(addr, 1n);
await emulator.expectValidTransaction(blaze, tx);
// This advances 1 slot per transaction
```

### **Recommended Time Advancement (What We Should Have) - EFFICIENT**

**Method**: Direct emulator time manipulation
- **Approach**: Use `emulator.stepForwardToUnix()` or `emulator.stepForwardToSlot()`
- **Efficiency**: Instant time advancement to any target
- **Example**: `emulator.stepForwardToUnix(1704067200000)` instantly advances to that timestamp
- **Performance**: O(1) time complexity regardless of target

**Recommended Implementation**:
```typescript
// Recommended approach: Direct time manipulation
emulator.stepForwardToUnix(targetUnixTime); // Instant
// or
emulator.stepForwardToSlot(targetSlot); // Instant
```

### **Performance Comparison**

| Aspect | Current (Transaction-based) | Recommended (Direct) |
|--------|---------------------------|---------------------|
| **Speed** | Very slow (1 slot/tx) | Instant |
| **Scalability** | Poor (linear scaling) | Excellent (constant time) |
| **Resource Usage** | High (creates UTXOs) | Minimal |
| **Precision** | Slot-based only | Unix timestamp precision |
| **Use Case** | Demo only | Production-like testing |
| **1 Week Advancement** | ~604,800 transactions | 1 API call |

**The current approach is 604,800x slower for 1 week advancement and should be replaced immediately.**

## Recommended New Endpoints

### **1. Time Management Endpoints** ⭐⭐⭐⭐⭐
**Priority: CRITICAL** - Replace inefficient transaction-based time advancement

```typescript
// Time advancement (REPLACE CURRENT INEFFICIENT APPROACH)
POST /api/emulator/advance-time
{
  "sessionId": "string",
  "targetUnixTime": "number", // Unix timestamp in milliseconds
  "mode": "sync" | "async"
}

// Time querying
GET /api/emulator/current-time?sessionId=string
// Returns: { currentSlot, currentUnixTime, slotLength }

// Time conversion utilities
POST /api/emulator/convert-time
{
  "sessionId": "string",
  "fromSlot": "number",
  "toUnixTime": true
}
```

### **2. Advanced Wallet Management** ⭐⭐⭐
**Priority: MEDIUM** - Sundae Treasury uses direct funding

```typescript
// Direct funding (bypasses registration)
POST /api/wallet/fund
{
  "sessionId": "string",
  "walletName": "string",
  "amount": "string",
  "assets": [{"policyId": "string", "assetName": "string", "quantity": "string"}]
}
```

### **3. Script Management Endpoints** ⭐⭐⭐⭐
**Priority: HIGH** - Essential for reference scripts

```typescript
// Script publication
POST /api/script/publish
{
  "sessionId": "string",
  "compiledCode": "string",
  "scriptType": "PlutusV3"
}

// Script lookup
GET /api/script/:scriptHash?sessionId=string
// Returns: { scriptHash, compiledCode, scriptType, publishedAt }

// Script listing
GET /api/script/list?sessionId=string
// Returns: { scripts: [{ scriptHash, scriptType, publishedAt }] }
```

### **4. Advanced UTXO Management** ⭐⭐⭐
**Priority: MEDIUM** - Sundae Treasury uses manual UTXO creation

```typescript
// Manual UTXO creation
POST /api/utxo/create
{
  "sessionId": "string",
  "address": "string",
  "amount": "string",
  "datum": "string", // Optional
  "assets": [{"policyId": "string", "assetName": "string", "quantity": "string"}] // Optional
}

// UTXO manipulation
DELETE /api/utxo/:txHash/:outputIndex?sessionId=string
// Remove specific UTXO (for testing edge cases)

// UTXO search with filters
GET /api/utxo/search?sessionId=string&address=string&minAmount=string&hasDatum=true
```

### **5. Protocol Parameters Management** ⭐⭐⭐
**Priority: MEDIUM** - Sundae Treasury uses custom parameters

```typescript
// Protocol parameters query
GET /api/emulator/protocol-parameters?sessionId=string
// Returns: { coinsPerUtxoByte, minFeeCoefficient, maxTxSize, etc. }

// Protocol parameters update
POST /api/emulator/protocol-parameters
{
  "sessionId": "string",
  "parameters": {
    "coinsPerUtxoByte": "number",
    "minFeeCoefficient": "number",
    // ... other parameters
  }
}
```

### **6. Advanced Transaction Features** ⭐⭐⭐
**Priority: MEDIUM** - Sundae Treasury uses complex transactions

```typescript
// Transaction validation without submission
POST /api/transaction/validate
{
  "sessionId": "string",
  "operations": [...], // Same as build-and-submit
  "signerWallet": "string"
}
// Returns: { isValid, errors, estimatedFee, estimatedSize }

// Transaction simulation
POST /api/transaction/simulate
{
  "sessionId": "string",
  "operations": [...],
  "signerWallet": "string"
}
// Returns: { success, executionUnits, logs, finalBalances }
```

### **7. Multi-Asset Support** ⭐⭐
**Priority: LOW** - Sundae Treasury uses native assets extensively

```typescript
// Asset creation
POST /api/asset/mint
{
  "sessionId": "string",
  "walletName": "string",
  "policyId": "string",
  "assetName": "string",
  "quantity": "string"
}

// Asset burning
POST /api/asset/burn
{
  "sessionId": "string",
  "walletName": "string",
  "policyId": "string",
  "assetName": "string",
  "quantity": "string"
}

// Asset balance query
GET /api/wallet/:walletName/assets?sessionId=string
// Returns: { assets: [{ policyId, assetName, quantity }] }
```

## Implementation Priority

### **Phase 1 (Immediate - Critical)**
1. **Time Management** - Replace inefficient transaction-based time advancement with direct emulator time manipulation
2. **Script Management** - Essential for reference script workflows

### **Phase 2 (Short-term)**
3. **Advanced Wallet Management** - Direct funding capabilities
4. **Advanced UTXO Management** - Manual UTXO creation for edge case testing
5. **Protocol Parameters** - Custom parameter testing

### **Phase 3 (Long-term)**
6. **Advanced Transaction Features** - Validation and simulation
7. **Multi-Asset Support** - Native asset operations
8. **Reward Account Operations** - Staking and reward management (low priority - not needed for current system)

## Key Insights from Sundae Treasury

1. **Time-sensitive testing is crucial** - Many contracts have expiration logic
2. **Reference scripts are fundamental** - Not just a convenience feature
3. **Direct UTXO manipulation** - Essential for testing edge cases
4. **Reward account operations** - Important for treasury-like contracts (low priority for current system)
5. **Custom protocol parameters** - Needed for realistic testing scenarios
6. **Direct time manipulation is essential** - Transaction-based advancement is impractical

## Migration Strategy for Time Advancement

### **Immediate Action Required**
1. **Implement direct time advancement endpoints** using `emulator.stepForwardToUnix()`
2. **Deprecate transaction-based time advancement** in documentation
3. **Update all tests** to use direct time manipulation
4. **Remove time advancement from transaction endpoints** to prevent confusion

### **Benefits of Migration**
- **604,800x performance improvement** for 1 week advancement
- **Production-like testing** capabilities
- **Reduced resource usage** (no unnecessary UTXOs)
- **Better precision** (Unix timestamp vs slot-based)
- **Consistency with Sundae Treasury** patterns

## Conclusion

The current server implementation provides a solid foundation but lacks several critical capabilities that would make it production-ready for testing complex Cardano contracts. The most critical gap is the inefficient time advancement system, which should be replaced immediately with direct emulator time manipulation.

Implementing these recommended endpoints would transform the demo tool from a basic prototype into a comprehensive testing platform capable of handling production-like scenarios, as demonstrated by Sundae Treasury's sophisticated testing patterns.

**Priority Recommendation**: Implement direct time advancement endpoints immediately to replace the current inefficient transaction-based approach.
