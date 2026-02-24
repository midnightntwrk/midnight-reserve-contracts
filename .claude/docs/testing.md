# Testing

Tests use Blaze emulator for integration testing. They require compiled validators.

## Running Tests

```bash
just build   # REQUIRED - compile validators first
bun test     # Run all emulator tests
```

Tests depend on one-shot hashes from local build. Always rebuild before testing.

## Updating After Validator Changes

After modifying validators:

```bash
just build   # Regenerates plutus.json and contract_blueprint.ts
bun test     # Verify tests pass with new hashes
```
