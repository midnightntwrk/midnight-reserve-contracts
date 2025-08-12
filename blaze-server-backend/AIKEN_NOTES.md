# Aiken Development Notes

## Critical Requirements

### Validator Visibility
**IMPORTANT**: Validators must be marked as `pub` (public) or they won't generate code into `plutus.json`.

```aiken
// ❌ WRONG - will not generate code
validator {
  fn my_validator(datum, redeemer, context) {
    True
  }
}

// ✅ CORRECT - will generate code
pub validator {
  fn my_validator(datum, redeemer, context) {
    True
  }
}
```

### Project Structure
- Aiken contracts should be in the `contracts/` directory
- Each contract should be a `.ak` file
- Compilation generates `plutus.json` in the project root

### Compilation Process
1. Use `aiken build` to compile contracts
2. Output goes to `plutus.json`
3. This file contains the compiled Plutus script bytecode
4. Load this in Node.js to deploy to the emulator

## Common Pitfalls
- Forgetting `pub` on validators (no code generation)
- Missing imports for standard types
- Incorrect project structure

## Tested Patterns
- Simple datum == redeemer validation ✅
- Basic Aiken/Blaze integration ✅
- PRD-compliant hello world validator ✅

## PRD Issues Found
The original PRD validator syntax had several problems:
- Used `pub fn` instead of `validator` block (Aiken v1 syntax)
- Missing imports for ScriptContext
- Incorrect function signature for Aiken v2
- Fixed with proper `validator` block and `Option<Int>` datum pattern