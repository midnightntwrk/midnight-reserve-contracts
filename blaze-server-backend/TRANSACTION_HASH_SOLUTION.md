# Transaction Hash Extraction Solution

## Problem
The current implementation returns fake transaction IDs like `"tx-" + Date.now()` instead of real transaction hashes from the Blaze emulator.

## Solution Found ✅

Through experimentation, I discovered that **real transaction IDs can be extracted** using the native Blaze SDK:

```typescript
async function getTransactionId(txBuilder: any): Promise<string> {
  // Complete the transaction to get a Transaction object
  const completed = await txBuilder.complete();
  
  // Get the real transaction ID using Blaze SDK
  return completed.getId();
}
```

## Key Findings

1. **`emulator.expectValidTransaction()` returns `undefined`** - No transaction info
2. **`txBuilder.complete().getId()` works perfectly** - Native Blaze SDK method
3. **Works for ALL transaction types**:
   - Transfers
   - Contract locking
   - Contract unlocking
   - Multiple operations

## Implementation Strategy

### Step 1: Add utility function to server.ts

```typescript
async function getTransactionId(txBuilder: any): Promise<string> {
  const completed = await txBuilder.complete();
  return completed.getId();
}
```

### Step 2: Update endpoints to extract real transaction IDs

For **transfers** (server.ts:107-115):
```typescript
// Build transaction
const output = new Core.TransactionOutput(toAddress, makeValue(BigInt(amount)));
const txBuilder = blaze.newTransaction().addOutput(output);

// Extract REAL transaction ID (native SDK approach)
const realTransactionId = await getTransactionId(txBuilder);

// Submit transaction  
await currentSession.emulator.expectValidTransaction(blaze, txBuilder);

// Return real ID
res.json({
  success: true,
  fromWallet,
  toWallet,
  amount,
  transactionId: realTransactionId // ✅ REAL ID
});
```

For **contract locking** (server.ts:244-252):
```typescript
const txBuilder = blaze.newTransaction().lockAssets(
  scriptAddress,
  makeValue(BigInt(amount)),
  Data.serialize(MyDatum, { thing: BigInt(datum) })
);

// Extract REAL transaction ID
const realTransactionId = getTransactionId(txBuilder);

await currentSession.emulator.expectValidTransaction(blaze, txBuilder);

// Return real ID
res.json({
  // ...
  transactionId: realTransactionId // ✅ REAL ID
});
```

For **contract unlocking** (server.ts:343-348):
```typescript
const txBuilder = blaze.newTransaction()
  .addInput(utxo, Data.serialize(Data.BigInt(), BigInt(redeemer)))
  .provideScript(script);

// Extract REAL transaction ID
const realTransactionId = getTransactionId(txBuilder);

await currentSession.emulator.expectValidTransaction(blaze, txBuilder);

// Return real ID
res.json({
  // ...
  transactionId: realTransactionId // ✅ REAL ID
});
```

## Validation Results

✅ **Transfer transactions**: Real IDs extracted (64-char hex)
✅ **Contract lock transactions**: Real IDs extracted  
✅ **Contract unlock transactions**: Real IDs extracted
✅ **All IDs are unique** between different transactions
✅ **No changes to existing patterns** - just extract ID before submission

**Working test validation**: See `src/tests/phase1/test-1.4-transaction-hash-extraction.test.ts` for complete working examples that demonstrate the solution for all transaction types.

## Benefits

1. **Real transaction hashes** instead of fake timestamps
2. **Native Blaze SDK method** - no manual cryptography needed
3. **Minimal code changes** - just add utility function and extract before submission
4. **Works with ALL transaction types** in the current implementation
5. **No external dependencies** - uses built-in Blaze SDK functionality

## Implementation Time Estimate

- **15 minutes** to add utility function and update 3 endpoints
- **5 minutes** to test and verify
- **Total: 20 minutes**

## Next Steps

1. Add `getTransactionId()` utility function to server.ts
2. Update `/api/wallet/transfer` endpoint 
3. Update `/api/contract/lock` endpoint
4. Update `/api/contract/invoke` endpoint
5. Run tests to verify real transaction IDs are returned
6. Update the skipped tests in `test-2.4-transaction-validation.test.ts`

This solves the "TECHNICAL DEBT" issue completely and provides real transaction hashes for all operations.