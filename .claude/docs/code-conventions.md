# Code Conventions

## Dependencies

```bash
bun add <package>      # No version - let bun pick
bun remove <package>
```

Never manually edit dependency versions in package.json - always use `bun add`.

## Preferred Libraries

| Purpose | Use |
|---------|-----|
| Transactions | @blaze-cardano/sdk |
| Emulator | @blaze-cardano/emulator |
| Data encoding | @blaze-cardano/data |

## Error Handling

Aiken: Use `expect` with descriptive fail traces for exact location on failure.
TypeScript: Throw descriptive errors, let CLI handle formatting.
