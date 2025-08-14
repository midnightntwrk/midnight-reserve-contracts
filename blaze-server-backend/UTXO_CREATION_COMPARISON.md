# UTXO Creation Approach Comparison

## Transaction-Based Approach (Old)

From `test-3.7-contract-utxo-unlocking.test.ts`:

### Setup Steps Required:
1. Create session and register wallets
2. Get wallet address
3. **Transaction 1**: Create reference script + spending UTXOs
   - Pay-to-address with reference script (2 ADA)
   - Pay-to-address for spending funds (8 ADA) 
   - Wait for transaction completion
   - Extract specific UTXOs from transaction results
4. **Transaction 2**: Lock funds to contract
   - Spend specific UTXO from step 3
   - Pay-to-contract with compiledCode
   - Wait for transaction completion
5. Now ready for actual test logic

### Code Complexity:
- ~85 lines just for setup
- 2 separate transactions with waiting
- Complex UTXO management and extraction
- Manual tracking of specific UTXOs by amount matching
- Error-prone UTXO selection logic

### Performance:
- 2 full transaction processing cycles
- Network/emulator overhead for each transaction
- Complex state management between transactions

---

## Direct UTXO Creation Approach (New)

From `test-4.3-direct-utxo-creation.test.ts`:

### Setup Steps Required:
1. Create session and register wallet
2. Get wallet address
3. **Direct UTXO Creation**: Create UTXOs directly
   - Create wallet UTXO with `amount: "5000000"`
   - Create contract UTXO with `amount: "3000000", datum: 42`
4. **Immediate verification**: UTXOs exist and ready for use

### Code Complexity:
- ~25 lines for complete setup
- 2 direct API calls (no transaction complexity)
- Simple JSON payloads
- No UTXO extraction or tracking needed
- Clear, readable setup logic

### Performance:
- Zero transaction processing overhead
- Immediate UTXO availability
- Direct emulator state manipulation

---

## Key Benefits of Direct Approach

### 1. **Simplicity**: 70% reduction in setup code
- Old: ~85 lines of complex transaction logic
- New: ~25 lines of straightforward API calls

### 2. **Performance**: Elimination of transaction overhead
- Old: 2 full transaction cycles with emulator processing
- New: Direct emulator state manipulation (instant)

### 3. **Reliability**: Removal of transaction dependency chains
- Old: Transaction 2 depends on Transaction 1 success + UTXO extraction
- New: Independent UTXO creation with guaranteed outcomes

### 4. **Clarity**: Explicit test setup intentions
- Old: Test setup buried in transaction complexity
- New: Clear mapping of test requirements to UTXO creation

### 5. **Phase Separation**: Clean separation of concerns
- Direct UTXO creation only available in setup phase
- Transaction logic remains pure and focused on actual test behavior
- Phase validation prevents accidental state corruption

---

## SundaeSwap Treasury Pattern Applied

The implementation follows the exact pattern used by SundaeSwap Treasury:

```typescript
// SundaeSwap pattern from fund.test.ts:89-97
scriptInput = new Core.TransactionUnspentOutput(
  new Core.TransactionInput(Core.TransactionId("1".repeat(64)), 0n),
  new Core.TransactionOutput(treasuryScriptAddress, makeValue(500_000_000_000n)),
);
scriptInput.output().setDatum(Core.Datum.newInlineData(Data.Void()));
emulator.addUtxo(scriptInput);
```

This proven approach enables direct emulator state manipulation for test setup while maintaining full transaction simulation capability for actual test logic.

---

## When to Use Each Approach

### Use Direct UTXO Creation When:
- Setting up test fixtures quickly
- Creating known contract states
- Establishing baseline conditions
- Performance-sensitive test suites

### Use Transaction-Based Approach When:  
- Testing actual transaction logic
- Validating real-world transaction flows
- Testing transaction composition and dependencies
- Production-like integration testing

The direct approach complements rather than replaces transaction-based testing - it provides efficient test setup while preserving full transaction testing capabilities for the actual test scenarios.