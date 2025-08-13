# Unfakeable Transaction ID Proof (Pushed to Stack)

## Status: BLOCKED - Waiting for Complex Transaction Support

This exploration contains a partially completed unfakeable transaction ID proof that was discovered to require multi-input contract validation support.

## What Works:
- ✅ Aiken `double_value_checker` contract (compiled and tested)
- ✅ TypeScript contract bindings
- ✅ Basic contract deployment and UTXO creation
- ✅ Contract hash verification proves opaque bytecode handling

## What's Missing:
- ❌ Multi-input contract validation API
- ❌ Endpoint to consume multiple specific UTXOs in single transaction
- ❌ Real transaction ID extraction (currently uses fake IDs)

## Dependency:
This work is **blocked** by the need for complex transaction support. Once the server supports multi-input contract validation, this unfakeable proof can be completed.

## The Unfakeable Strategy:
1. Deploy opaque contract that validates double-value relationship between 2 inputs
2. Create UTXOs with various amounts (some form valid pairs)  
3. Attempt to unlock pairs - only mathematically correct pairs should succeed
4. This proves server cannot fake transaction IDs since it can't predict validation

## Files:
- `validators/double_value_checker.ak` - Aiken contract requiring 2 inputs with double-value relationship
- `validators/double_value_checker.test.ak` - Unit tests (6/6 passing)
- `tests/phase3/test-3.1-unfakeable-transaction-ids.test.ts` - Integration test (currently limited by API)

## Next Steps:
1. Implement complex transaction support in server API
2. Resume this unfakeable transaction ID proof
3. Complete the cryptographic proof that server uses real blockchain data