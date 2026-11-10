# Code Conventions

## Dependencies

```bash
vp add <package>      # No version - let the package manager (pnpm) pick
vp remove <package>
```

Never manually edit dependency versions in package.json - always use `vp add`.

## Preferred Libraries

| Purpose | Use |
|---------|-----|
| Transactions | @blaze-cardano/sdk |
| Emulator | @blaze-cardano/emulator |
| Data encoding | @blaze-cardano/data |

## Error Handling

Aiken: Use `expect` with descriptive fail traces for exact location on failure.
TypeScript: Throw descriptive errors, let CLI handle formatting.
