# Claude Code Instructions

## CRITICAL: Read TDD Guidelines First
Before ANY development work, you MUST:

1. **Read `TDD_GUIDELINES.md` completely**
2. **Run `bun test` to check current state**  
3. **Fix any failing tests before suggesting new work**

This is MANDATORY and NON-NEGOTIABLE.

## Git Workflow Reminders
- when preparing a commit comment, run 'git status' and make sure you account for everything

## Reference Script Implementation (CIP-33) - Key Idioms

### SundaeSwap Treasury Pattern
The canonical working example of using blaze emulator is here: https://github.com/SundaeSwap-finance/treasury-contracts/blob/ed17bce07fdef56df0d347b1cd806f099ca55434/offchain/src/treasury/fund/index.ts

When implementing reference scripts, follow their proven approach:

1. **Manual UTXO Selection**: Use specific UTXOs instead of automatic coin selection
   - Prevents reference script UTXOs from being consumed accidentally
   - Use operations like `spend-specific-utxos` to control exactly which UTXOs are inputs

2. **Reference Scripts as Read-Only**: 
   - Use `addReferenceInput(utxo)` to provide script without consuming the UTXO
   - Never call `provideScript()` when using reference scripts - they're mutually exclusive
   - Reference script UTXOs remain available for reuse in subsequent transactions

3. **Adequate UTXO Sizing**:
   - Use substantial UTXOs (8+ ADA) to handle collateral requirements (150% of tx fee)
   - Collateral change must meet minimum UTXO requirements (~970k lovelace)
   - Let Blaze handle automatic collateral selection from available UTXOs

4. **Protocol Parameters** (from SundaeSwap treasury tests):
   - `collateralPercentage: 150` (150% of transaction fee)
   - `maxCollateralInputs: 3` (up to 3 UTXOs for collateral)


## Research Approach: Local Code Study
When blocked on Cardano/Blaze implementation details:

1. **Clone canonical examples to ignored folder**:
   ```bash
   mkdir -p .gitignored-repos
   git clone https://github.com/SundaeSwap-finance/treasury-contracts.git .gitignored-repos/sundae-treasury
   ```

2. **Study their patterns locally**:
   - Examine test files to understand UTXO management
   - Trace function calls to see parameter selection
   - Check protocol parameters in emulator setup
   - Copy their successful patterns exactly

3. **Key files to examine**:
   - `/offchain/src/treasury/fund/index.ts` - core implementation
   - `/offchain/tests/treasury/fund.test.ts` - working test patterns  
   - `/offchain/tests/utilities.ts` - emulator setup & protocol params
   - `/offchain/cli/treasury/fund.ts` - CLI UTXO selection

This approach revealed the critical insight that SundaeSwap uses manual UTXO selection with substantial UTXOs rather than fighting automatic coin selection algorithms.