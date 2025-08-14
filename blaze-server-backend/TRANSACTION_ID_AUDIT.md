# Transaction ID Audit

## Endpoints that return transaction IDs:

1. `/api/wallet/transfer` (line 127) - ✅ Tested in test-3.8
2. `/api/contract/lock` (line 277) - ✅ Tested in test-3.9
3. `/api/contract/invoke` (line 399) - ✅ Tested in test-3.10
4. `/api/transaction/build-and-submit` (line 631) - ❓ Need to check

## Test Coverage Analysis:
