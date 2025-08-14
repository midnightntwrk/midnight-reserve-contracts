# Transaction ID Verification Gaps Analysis

## Current State of Transaction ID Tests

### 1. `/api/wallet/transfer` - test-3.8-unfakeable-transaction-id.test.ts
**Rigor Level: MEDIUM** ⚠️
- ✅ Verifies receiver gets UTXO with claimed tx ID
- ✅ Verifies amount matches
- ❌ Doesn't verify sender's balance decreased
- ❌ Doesn't verify sender's UTXOs were consumed

### 2. `/api/contract/lock` - test-3.9-contract-lock-real-ids.test.ts  
**Rigor Level: MEDIUM** ⚠️
- ✅ Verifies contract receives UTXO with claimed tx ID
- ✅ Verifies amount matches
- ❌ Doesn't verify sender's balance decreased
- ❌ Doesn't verify sender's UTXOs were consumed

### 3. `/api/contract/invoke` - test-3.10-contract-invoke-real-ids.test.ts
**Rigor Level: HIGH** ✅
- ✅ Verifies contract UTXO was consumed
- ✅ Verifies sender receives UTXO with claimed tx ID
- ✅ Verifies sender's balance increased by expected amount
- ✅ Comprehensive proof the tx ID is real

### 4. `/api/transaction/build-and-submit` - test-3.6-explicit-utxo-selection.test.ts
**Rigor Level: LOW** ❌
- ✅ Checks transaction ID format (64-char hex)
- ❌ No verification that tx ID corresponds to actual transaction
- ❌ No UTXO consistency checks
- ❌ No balance verification

## Gaps to Address

### Priority 1: `/api/transaction/build-and-submit`
This is the most complex endpoint supporting multiple operation types, but has the weakest test coverage. Needs comprehensive test that:
- Verifies specific UTXOs are consumed (spend-utxo)
- Verifies new UTXOs are created at correct addresses (pay-to-address)
- Verifies contract UTXOs are created/consumed correctly
- Confirms tx ID matches actual transaction

### Priority 2: Strengthen `/api/wallet/transfer` test
Add verification that:
- Alice's balance decreases by transfer amount + fees
- Alice's original UTXOs are consumed
- New change UTXO is created for Alice

### Priority 3: Strengthen `/api/contract/lock` test  
Add verification that:
- Alice's balance decreases by lock amount + fees
- Alice's original UTXOs are consumed
- New change UTXO is created for Alice

## Test Pattern for Rigorous Transaction ID Verification

```typescript
// BEFORE transaction
const senderBalanceBefore = await getBalance(sender);
const senderUtxosBefore = await getUtxos(sender);
const receiverUtxosBefore = await getUtxos(receiver);

// EXECUTE transaction
const { transactionId } = await executeTransaction(...);

// AFTER transaction - comprehensive verification
const senderBalanceAfter = await getBalance(sender);
const senderUtxosAfter = await getUtxos(sender);
const receiverUtxosAfter = await getUtxos(receiver);

// Verify sender's state changed correctly
expect(senderBalanceAfter).toBeLessThan(senderBalanceBefore);
expect(senderUtxosBefore.some(utxo => 
  !senderUtxosAfter.includes(utxo)
)).toBe(true); // Some UTXOs were consumed

// Verify receiver got new UTXO with claimed tx ID
const newUtxo = receiverUtxosAfter.find(
  utxo => utxo.txHash === transactionId
);
expect(newUtxo).toBeDefined();

// Verify change UTXO for sender (if applicable)
const changeUtxo = senderUtxosAfter.find(
  utxo => utxo.txHash === transactionId
);
expect(changeUtxo).toBeDefined();
```

## Recommendation

We should upgrade all transaction ID tests to follow the rigorous pattern used in test-3.10. This ensures:
1. The transaction ID is real (not fake)
2. The transaction ID corresponds to the actual transaction that was executed
3. All expected state changes occurred (balances, UTXOs consumed/created)
4. The system's UTXO accounting remains consistent