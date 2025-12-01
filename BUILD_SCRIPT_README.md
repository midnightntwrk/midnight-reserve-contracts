# Midnight Reserve Contracts Build Script

This repository contains a build script that compiles Aiken smart contracts in the correct dependency order for the Midnight Reserve project.

## Overview

The build script (`build_contracts.sh`) handles the complex dependency chain between validators by compiling them in phases:

1. **Two-stage validators** - Independent validators compiled together
2. **Forever validators** - Depend on two-stage validators
3. **Threshold validators** - Depend on forever validators

## Usage

```bash
./build_contracts.sh [network] [trace_level]
```

### Networks

- `default` - Use for local test builds (uses hex encoding for validator hashes)
- `preview` - Use for preview testnet (uses hex encoding for validator hashes)
- `preprod` - Use for preprod testnet (uses hex encoding for validator hashes)
- `mainnet` - Use for preprod testnet (uses hex encoding for validator hashes)

### Trace Levels (Optional)

- `silent` - Minimal output during compilation
- `verbose` - Detailed compilation output
- `compact` - Compact compilation output

### Examples

```bash
# Build for preview network
./build_contracts.sh preview

# Build for mainnet with verbose output
./build_contracts.sh default verbose

# Build for preview with compact output
./build_contracts.sh preview compact
```

## How It Works

The script follows this process:

1. **Set static configuration** - Sets `cnight_policy` and one-shot parameters
2. **Phase 1: Two-stage validators** - Compiles all two-stage upgrade validators in one build
3. **Phase 2: Forever validators** - Compiles all forever validators that depend on two-stage
4. **Phase 3: Threshold validators** - Compiles threshold validators that depend on forever contracts
5. **Final compilation** - One final build with all hashes in place

## Configuration Management

The script automatically:

- Updates validator hashes in `aiken.toml` after each compilation phase
- Uses hex encoding format for validator hashes on all networks
- Sets proper integer values for indexes (not strings)
- Maintains consistent configuration format across all networks
- Handles both direct key-value pairs (one_shot_hash, one_shot_index) and hex-encoded table entries (two_stage_hash, forever_hash, threshold_hash)
- Refreshes the committee signer (`bridge_signer_threshold_hash`) entry so those script IDs stay synchronised across every environment

## Prerequisites

The script requires the following tools to be installed:

- `aiken` - Aiken smart contract compiler
- `jq` - JSON processor for reading plutus.json
- `toml` (toml-cli) - TOML file processor for updating aiken.toml

## Files Modified

The script reads from:

- `aiken.toml` - Aiken configuration file

The script modifies:

- `aiken.toml` - Updates validator hashes in the appropriate network configuration section
- `plutus.json` - Generates a new plutus.json file

## Dependency Order

The dependency relationships are:

- **Two-stage → Forever → Threshold validators → Logic/Gov validators**

This ensures that when a validator references another validator's hash, that hash is already available in the configuration.

## Configuration Format

The script maintains a consistent format in `aiken.toml`:

- **Direct key-value pairs** for one-shot parameters:

  ```toml
  reserve_one_shot_index = 1

  [config.default.reserve_one_shot_hash]
  bytes = "0000000000000000000000000000000000000000000000000000000000000001"
  encoding = "hex"
  ```

- **Hex-encoded table entries** for validator hashes:
  ```toml
  [config.default.reserve_two_stage_hash]
  bytes = "a6363ea32a27257273c5cab9468da56d25fe146a1dd22057af17f602"
  encoding = "hex"
  ```

## Troubleshooting

If the build fails:

1. **Type mismatch errors** - Usually indicates integer values are being treated as strings. The script handles this automatically, but manual `aiken.toml` edits might cause issues.

2. **Missing dependencies** - Ensure `aiken`, `jq`, and `toml-cli` are installed and in your PATH.

3. **Permission errors** - Ensure the script is executable (`chmod +x build_contracts.sh`) and you have write permissions for `aiken.toml`.

4. **Network configuration** - Ensure the specified network configuration section exists in `aiken.toml`.

## Verification

After the final compilation the script confirms that all logic validators embed the refreshed threshold hashes (council, tech-auth, federated-ops, and main-governance flows) and that the `bridge_signer_threshold_hash` entry in `aiken.toml` matches the hash emitted for `thresholds.beefy_signer_threshold.else`.

## Help

Run the script with `--help` for usage information:

```bash
./build_contracts.sh --help
```
