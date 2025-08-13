# Complex Transaction Endpoint Design

## Overview

This document outlines the design for adding complex transaction support to the Blaze Demo Backend. Based on analysis of the Blaze SDK and real-world dApp patterns, this design prioritizes **UTXO discovery endpoints** followed by **multi-operation transaction building**.

## Current State

The existing implementation handles simple cases well:
- Single contract invocation
- Simple transfers  
- Individual wallet operations

But real Cardano transactions often involve:
- Multiple contract invocations in one transaction
- Mixing transfers with contract calls
- Multiple inputs and outputs
- Client-controlled UTXO selection

## The UTXO Discovery Problem

**Critical insight**: Clients need to query available UTXOs before building complex transactions.

For complex transactions, clients need to know:
- **Which UTXOs are available** to spend from
- **Which contract UTXOs exist** at specific addresses  
- **What data/value** each UTXO contains
- **Which UTXOs are suitable** for their transaction goals

## Recommended Implementation Plan

### Phase 1: UTXO Discovery Endpoints (PRIORITY)

These endpoints enable clients to discover and inspect available UTXOs before building transactions.

#### 1.1 Wallet UTXO Discovery

```typescript
GET /api/wallet/{walletName}/utxos?sessionId={sessionId}
```

**Response:**
```json
{
  "success": true,
  "utxos": [
    {
      "txHash": "abc123...",
      "outputIndex": 0,
      "address": "addr_test1...",
      "amount": "5000000",
      "assets": {},
      "datum": null
    }
  ]
}
```

**Implementation:**
```typescript
app.get("/api/wallet/:walletName/utxos", async (req, res) => {
  const { walletName } = req.params;
  const { sessionId } = req.query;
  
  const currentSession = sessionManager.getCurrentSession();
  if (!currentSession || currentSession.id !== sessionId) {
    return res.status(400).json({
      success: false,
      error: "Invalid session ID"
    });
  }

  if (!currentSession.emulator.mockedWallets.has(walletName)) {
    return res.status(400).json({
      success: false,
      error: `Wallet '${walletName}' does not exist`
    });
  }
  
  try {
    await currentSession.emulator.as(walletName, async (blaze, addr) => {
      const utxos = await blaze.provider.getUnspentOutputs(addr);
      
      const formattedUtxos = utxos.map(utxo => ({
        txHash: utxo.input().transactionId().toString(),
        outputIndex: utxo.input().index(),
        address: utxo.output().address().toBech32(),
        amount: utxo.output().amount().coin().toString(),
        assets: extractAssets(utxo.output().amount()), // Helper function
        datum: extractDatum(utxo.output().datum()) // Helper function
      }));
      
      res.json({
        success: true,
        utxos: formattedUtxos
      });
    });
  } catch (error) {
    console.log("UTXO discovery error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to discover UTXOs"
    });
  }
});
```

#### 1.2 Contract UTXO Discovery

```typescript
GET /api/contract/{contractAddress}/utxos?sessionId={sessionId}
```

**Response:**
```json
{
  "success": true,
  "utxos": [
    {
      "txHash": "def456...",
      "outputIndex": 1,
      "address": "addr_test1wpd...",
      "amount": "2000000",
      "datum": 42,
      "datumHash": "abcd1234..."
    }
  ]
}
```

**Implementation:**
```typescript
app.get("/api/contract/:contractAddress/utxos", async (req, res) => {
  const { contractAddress } = req.params;
  const { sessionId } = req.query;
  
  const currentSession = sessionManager.getCurrentSession();
  if (!currentSession || currentSession.id !== sessionId) {
    return res.status(400).json({
      success: false,
      error: "Invalid session ID"
    });
  }
  
  try {
    const scriptAddress = Core.addressFromBech32(contractAddress);
    
    // Use any wallet to query the contract address
    const walletName = Array.from(currentSession.emulator.mockedWallets.keys())[0];
    await currentSession.emulator.as(walletName, async (blaze, addr) => {
      const utxos = await blaze.provider.getUnspentOutputs(scriptAddress);
      
      const formattedUtxos = utxos.map(utxo => ({
        txHash: utxo.input().transactionId().toString(),
        outputIndex: utxo.input().index(),
        address: utxo.output().address().toBech32(),
        amount: utxo.output().amount().coin().toString(),
        assets: extractAssets(utxo.output().amount()),
        datum: extractDatum(utxo.output().datum()),
        datumHash: getDatumHash(utxo.output().datum()) // Helper function
      }));
      
      res.json({
        success: true,
        utxos: formattedUtxos
      });
    });
  } catch (error) {
    console.log("Contract UTXO discovery error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to discover contract UTXOs"
    });
  }
});
```

#### 1.3 Helper Functions Needed

```typescript
function extractAssets(value: any): Record<string, string> {
  // Extract native assets from Blaze Value object
  // Return as { "policyId.assetName": "amount" }
  const assets: Record<string, string> = {};
  const multiasset = value.multiasset();
  if (multiasset) {
    // Iterate through multiasset and extract policy/asset names
    // Implementation depends on Blaze's Value structure
  }
  return assets;
}

function extractDatum(datum: any): any {
  // Extract and decode datum from Blaze Datum object
  if (!datum) return null;
  
  try {
    if (datum.asInlineData) {
      const inlineData = datum.asInlineData();
      // Decode the inline data - depends on your datum structure
      return decodeDatum(inlineData);
    }
    return null; // Hash-only datum
  } catch (error) {
    return null;
  }
}

function getDatumHash(datum: any): string | null {
  // Get datum hash if available
  if (!datum) return null;
  
  try {
    if (datum.asDataHash) {
      return datum.asDataHash().toString();
    }
    return null;
  } catch (error) {
    return null;
  }
}
```

### Phase 2: Complex Transaction Builder (AFTER Phase 1)

#### 2.1 Multi-Operation Transaction Endpoint

```typescript
POST /api/transaction/build-and-submit
```

**Request:**
```json
{
  "sessionId": "...",
  "signerWallet": "alice",
  "operations": [
    {
      "type": "spend-utxo",
      "txHash": "abc123...",
      "outputIndex": 0
    },
    {
      "type": "unlock-utxo",
      "txHash": "def456...",
      "outputIndex": 1,
      "redeemer": 42
    },
    {
      "type": "pay-to-address",
      "address": "addr_test1...",
      "amount": "1000000"
    },
    {
      "type": "pay-to-contract",
      "contractAddress": "addr_test1...",
      "amount": "2000000",
      "datum": 100
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "real-tx-hash-using-complete-getId",
  "operationsExecuted": 4
}
```

#### 2.2 Implementation Pattern

```typescript
app.post("/api/transaction/build-and-submit", async (req, res) => {
  const { sessionId, signerWallet, operations } = req.body;
  
  // Standard validation...
  
  try {
    await currentSession.emulator.as(signerWallet, async (blaze, addr) => {
      let tx = blaze.newTransaction();
      
      // Process operations in order
      for (const op of operations) {
        switch(op.type) {
          case 'spend-utxo':
            const utxo = await findUtxo(blaze, op.txHash, op.outputIndex);
            tx = tx.addInput(utxo); // Verify this method exists
            break;
            
          case 'unlock-utxo':
            const scriptUtxo = await findUtxo(blaze, op.txHash, op.outputIndex);
            const script = getScriptForUtxo(scriptUtxo); // Need to implement
            tx = tx.addInput(scriptUtxo, op.redeemer).provideScript(script);
            break;
            
          case 'pay-to-address':
            const output = new Core.TransactionOutput(
              Core.addressFromBech32(op.address),
              makeValue(BigInt(op.amount))
            );
            tx = tx.addOutput(output); // Verify this method exists
            break;
            
          case 'pay-to-contract':
            const scriptAddress = Core.addressFromBech32(op.contractAddress);
            tx = tx.lockAssets(scriptAddress, makeValue(BigInt(op.amount)), op.datum);
            break;
            
          default:
            throw new Error(`Unknown operation type: ${op.type}`);
        }
      }
      
      // Extract real transaction ID
      const realTransactionId = await getTransactionId(tx);
      
      // Submit transaction
      await currentSession.emulator.expectValidTransaction(blaze, tx);
      
      res.json({
        success: true,
        transactionId: realTransactionId,
        operationsExecuted: operations.length
      });
    });
  } catch (error) {
    console.log("Complex transaction error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to build and submit complex transaction"
    });
  }
});
```

## Real Client Workflow

```typescript
// 1. Client discovers available UTXOs
const aliceUtxos = await fetch('/api/wallet/alice/utxos?sessionId=...');
const contractUtxos = await fetch('/api/contract/addr_test1.../utxos?sessionId=...');

// 2. Client selects suitable UTXOs
const spendableUtxo = aliceUtxos.utxos.find(u => BigInt(u.amount) >= 3000000n);
const unlockableUtxo = contractUtxos.utxos.find(u => u.datum === 42);

// 3. Client builds complex transaction
const tx = await fetch('/api/transaction/build-and-submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: "...",
    signerWallet: "alice",
    operations: [
      {
        type: "spend-utxo",
        txHash: spendableUtxo.txHash,
        outputIndex: spendableUtxo.outputIndex
      },
      {
        type: "unlock-utxo", 
        txHash: unlockableUtxo.txHash,
        outputIndex: unlockableUtxo.outputIndex,
        redeemer: 42
      },
      {
        type: "pay-to-address",
        address: "addr_test1...",
        amount: "1000000"
      }
    ]
  })
});
```

## Blaze Transaction Balancing Validation ✅

### **Key Finding: Blaze Handles Complex Multi-Operation Transactions**

**Validation test**: `src/tests/phase1/test-1.5-blaze-transaction-balancing.test.ts`

**Test results confirm Blaze properly handles:**

✅ **Multi-operation transaction building**
- 4 outputs (2 transfers + 2 contract locks) in single transaction
- Automatic input selection (1 input for multiple outputs)
- Proper fee calculation (175,489 lovelace for complex transaction)
- Automatic change output creation (5 total outputs: 4 requested + 1 change)

✅ **Transaction balancing and validation**
- Input value >= Output value + Fees + Change
- Atomic transaction validation (all operations succeed or fail together)
- Proper insufficient funds detection ("UTxO Balance Insufficient")

✅ **API method verification**
```typescript
// These methods are confirmed to work:
const tx = blaze.newTransaction()
  .addOutput(output1)                                    // ✅ Creates new UTXO
  .addOutput(output2)                                    // ✅ Creates another UTXO  
  .lockAssets(scriptAddress, amount, datum)              // ✅ Pay-to-contract
  .lockAssets(scriptAddress2, amount2, datum2);          // ✅ Multiple contracts

// Transaction completion and ID extraction:
const completed = await tx.complete();                   // ✅ Balances transaction
const txId = completed.getId();                          // ✅ Real transaction ID
await emulator.expectValidTransaction(blaze, tx);        // ✅ Submit builder (not completed)
```

✅ **Transaction structure analysis**
- **Inputs**: 1 (automatically selected)
- **Outputs**: 5 (4 requested + 1 change back to sender)
- **Fee**: 175,489 lovelace (~0.175 ADA)
- **Transaction ID**: Real 64-character hex hash

### **Critical Implementation Notes**

1. **Submit transaction builder, not completed transaction**
   ```typescript
   const completed = await tx.complete();                 // For ID extraction
   const txId = completed.getId();                        // Get real tx ID
   await emulator.expectValidTransaction(blaze, tx);      // Submit original builder
   ```

2. **Blaze handles balancing automatically**
   - No need to manually calculate fees
   - No need to manually select change outputs
   - No need to manually validate input/output balance

3. **Complex transaction endpoint is viable**
   - Blaze can handle multiple operations atomically
   - Proper validation and error handling built-in
   - Real transaction IDs available

## Resolved Critical Issues

### **1. ~~Blaze API Method Verification~~** ✅ VERIFIED

**CONFIRMED working methods**:
- ✅ `tx.addOutput(output)` - Creates pay-to-address outputs
- ✅ `tx.lockAssets(scriptAddr, amount, datum)` - Creates pay-to-contract outputs  
- ✅ Multiple operations in single transaction work atomically
- ✅ `completed.getId()` provides real transaction hashes

**Note**: `tx.addInput(utxo)` and contract unlocking patterns need separate validation.

### **2. UTXO Reference Resolution** 

```typescript
async function findUtxo(blaze: any, txHash: string, outputIndex: number): Promise<any> {
  // How to find a specific UTXO by tx hash + index in Blaze?
  // This is not obvious from the API - needs research
}
```

### **3. Script Management**

```typescript
function getScriptForUtxo(utxo: any): any {
  // How to get the script that locks this UTXO?
  // Need to track deployed scripts by address
}
```

## Implementation Priority

1. **Start with Phase 1 (Discovery endpoints)** - these are immediately useful
2. **Test discovery endpoints** with existing simple operations
3. **Research Blaze API methods** for Phase 2 requirements
4. **Implement Phase 2 incrementally** - start with 2 operations max

## Benefits of This Approach

✅ **Discovery endpoints are immediately valuable** - enable better client UX
✅ **Mirrors real Cardano dApp patterns** (query-then-transact)
✅ **Builds on proven working code** (existing simple endpoints)
✅ **Provides explicit UTXO control** instead of server-side magic
✅ **Testable in stages** - each endpoint can be validated independently

## Testing Strategy

### Phase 1 Tests
- Create wallet UTXOs and verify discovery
- Lock funds to contracts and verify contract UTXO discovery
- Test with multiple UTXOs per address
- Test with assets and complex datums

### Phase 2 Tests ✅ PARTIALLY VALIDATED
- ✅ **Multi-operation transactions work** (4 operations tested successfully)
- ✅ **Transaction balancing validated** (automatic fee calculation, change handling)
- ✅ **Failure case validation** (insufficient funds properly detected)
- ✅ **Real transaction IDs confirmed** (64-character hex hashes)
- ⚠️ **Contract unlocking needs validation** (addInput + redeemer patterns)
- ⚠️ **Explicit UTXO selection needs testing** (vs automatic selection)

## Updated Implementation Time Estimates

- **Phase 1 (Discovery)**: 4-6 hours
  - Wallet UTXO endpoint: 1.5 hours
  - Contract UTXO endpoint: 1.5 hours  
  - Helper functions: 1.5 hours
  - Testing: 1.5 hours

- **Phase 2 (Complex transactions)**: 4-6 hours (**REDUCED** due to validation)
  - ✅ **Multi-operation endpoint**: 2 hours (simplified due to proven Blaze balancing)
  - ⚠️ **UTXO resolution**: 2 hours (still needs research)
  - ⚠️ **Script management**: 1 hour (reduced scope)
  - ✅ **Testing**: 1 hour (core patterns validated)

**Total**: 8-12 hours spread over 1-2 weeks (**REDUCED** from 10-14 hours)

**Risk reduction**: Blaze transaction balancing validation significantly reduces implementation complexity and risk.

This design gives clients the **query-then-transact** pattern they need while building on your proven, working foundation.