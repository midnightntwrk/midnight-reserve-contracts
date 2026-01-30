#!/bin/bash
set -euo pipefail

# Midnight Reserve Contracts Build Script
#
# This script compiles Aiken contracts in the correct dependency order:
# 1. Two-stage validators (batch update then single compile)
# 2. Forever validators (batch update then single compile)
# 3. Threshold validators (batch update then single compile - depend on forever contracts)
#
# Usage: ./build_contracts.sh <env> [silent|verbose|compact]
#
# Environment options:
#   default     - Use for local testing builds
#   preview     - Use for preview testnet
#   qanet       - Use for Midnight QA environment (Cardano Preview)
#   govnet      - Use for Midnight Governance environment (Cardano Preview)
#   node-dev-01 - Use for node dev environment (Cardano Preview)
#   preprod     - Use for preprod testnet
#   mainnet     - Use for mainnet
#
# Trace options:
#   silent   - Minimal output
#   verbose  - Detailed compilation output
#   compact  - Compact compilation output

# Define files
# JSON_FILE is set after NETWORK is parsed (see below)
TOML_FILE="aiken.toml"
LOCK_FILE="build/aiken-compile.lock"

current_epoch_seconds() {
    date +%s
}

file_mtime() {
    local file="$1"
    if stat -f %m "$file" >/dev/null 2>&1; then
        stat -f %m "$file"
    else
        stat -c %Y "$file"
    fi
}

ensure_blueprint_is_current() {
    local description="$1"
    local started_at="$2"

    if [ ! -f "$JSON_FILE" ]; then
        echo "Error: $JSON_FILE not found after $description." >&2
        exit 1
    fi

    local blueprint_mtime
    blueprint_mtime=$(file_mtime "$JSON_FILE")

    if [ "$blueprint_mtime" -lt "$started_at" ]; then
        echo "Error: $JSON_FILE was not refreshed after $description." >&2
        exit 1
    fi

    if ! jq empty "$JSON_FILE" >/dev/null 2>&1; then
        echo "Error: $JSON_FILE could not be parsed after $description." >&2
        exit 1
    fi
}

write_toml_content() {
    local content="$1"
    local tmp_file
    tmp_file=$(mktemp "${TOML_FILE}.XXXXXX")
    printf '%s' "$content" > "$tmp_file"
    chmod 644 "$tmp_file"
    mv "$tmp_file" "$TOML_FILE"
}

reset_build_lock() {
    if [ -f "$LOCK_FILE" ]; then
        rm -f "$LOCK_FILE"
    fi
}

validator_hash_by_title() {
    local validator_title="$1"
    jq -r --arg title "$validator_title" '.validators[] | select(.title==$title) | .hash' "$JSON_FILE"
}

validator_compiled_code() {
    local validator_title="$1"
    jq -r --arg title "$validator_title" '.validators[] | select(.title==$title) | .compiledCode' "$JSON_FILE"
}

toml_bytes_value() {
    local toml_key="$1"
    toml get "$TOML_FILE" "config.$NETWORK.$toml_key.bytes" 2>/dev/null | tr -d '"'
}

verify_logic_dependency() {
    local logic_validator="$1"
    local dependency_validator="$2"

    local dependency_hash compiled_code
    dependency_hash=$(validator_hash_by_title "$dependency_validator")
    if [ -z "$dependency_hash" ] || [ "$dependency_hash" == "null" ]; then
        echo "Error: Dependency $dependency_validator not found in $JSON_FILE" >&2
        return 1
    fi

    compiled_code=$(validator_compiled_code "$logic_validator")
    if [ -z "$compiled_code" ] || [ "$compiled_code" == "null" ]; then
        echo "Error: Validator $logic_validator not found in $JSON_FILE" >&2
        return 1
    fi

    local dependency_lower compiled_lower
    dependency_lower=$(echo "$dependency_hash" | tr '[:upper:]' '[:lower:]')
    compiled_lower=$(echo "$compiled_code" | tr '[:upper:]' '[:lower:]')

    if ! grep -q "$dependency_lower" <<<"$compiled_lower"; then
        echo "Error: $logic_validator does not embed dependency $dependency_validator" >&2
        return 1
    fi

    return 0
}

verify_threshold_config_entry() {
    local display_name="$1"
    local toml_key="$2"
    local validator_title="$3"

    local expected_hash
    expected_hash=$(validator_hash_by_title "$validator_title")
    if [ -z "$expected_hash" ] || [ "$expected_hash" == "null" ]; then
        echo "Error: Validator $validator_title not found in $JSON_FILE" >&2
        return 1
    fi

    local toml_hash
    toml_hash=$(toml_bytes_value "$toml_key")
    if [ -z "$toml_hash" ] || [ "$toml_hash" == "null" ]; then
        echo "Error: Failed to read $display_name hash for $NETWORK from $TOML_FILE" >&2
        return 1
    fi

    if [ "$toml_hash" != "$expected_hash" ]; then
        echo "Error: $display_name hash mismatch ($toml_hash != $expected_hash)" >&2
        return 1
    fi

    return 0
}

verify_logic_dependencies() {
    echo "Verifying logic validators reference updated threshold hashes..."
    verify_logic_dependency "permissioned.council_logic.else" "thresholds.main_council_update_threshold.else" || return 1
    verify_logic_dependency "permissioned.tech_auth_logic.else" "thresholds.main_tech_auth_update_threshold.else" || return 1
    verify_logic_dependency "permissioned.federated_ops_logic.else" "thresholds.main_federated_ops_update_threshold.else" || return 1
    verify_logic_dependency "gov_auth.main_gov_auth.else" "thresholds.main_gov_threshold.else" || return 1
    verify_threshold_config_entry "committee_signer_threshold" "bridge_signer_threshold_hash" "thresholds.beefy_signer_threshold.else" || return 1
    return 0
}

final_compile_run() {
    local description="Final compilation"
    local compile_started_at
    compile_started_at=$(current_epoch_seconds)

    if ! aiken build -S --env "$NETWORK" -o "$JSON_FILE" "${TRACE_ARGS[@]}"; then
        echo "Error: Failed to perform final build" >&2
        exit 1
    fi
    ensure_blueprint_is_current "$description" "$compile_started_at"
}

# Define validator positions and TOML keys in dependency order
# Order: two_stage -> forever -> logic/auth -> thresholds -> committee_bridge

# Two-stage validators (compiled first)
RESERVE_TWO_STAGE_TITLE="reserve.reserve_two_stage_upgrade.else"
RESERVE_TWO_STAGE_TOML_KEY="reserve_two_stage_hash"

COUNCIL_TWO_STAGE_TITLE="permissioned.council_two_stage_upgrade.else"
COUNCIL_TWO_STAGE_TOML_KEY="council_two_stage_hash"

ICS_TWO_STAGE_TITLE="illiquid_circulation_supply.ics_two_stage_upgrade.else"
ICS_TWO_STAGE_TOML_KEY="ics_two_stage_hash"

TECH_AUTH_TWO_STAGE_TITLE="permissioned.tech_auth_two_stage_upgrade.else"
TECH_AUTH_TWO_STAGE_TOML_KEY="technical_authority_two_stage_hash"

FEDERATED_OPS_TWO_STAGE_TITLE="permissioned.federated_ops_two_stage_upgrade.else"
FEDERATED_OPS_TWO_STAGE_TOML_KEY="federated_operators_two_stage_hash"

TERMS_AND_CONDITIONS_TWO_STAGE_TITLE="terms_and_conditions.terms_and_conditions_two_stage_upgrade.else"
TERMS_AND_CONDITIONS_TWO_STAGE_TOML_KEY="terms_and_conditions_two_stage_hash"

# Forever validators (compiled second)
RESERVE_FOREVER_TITLE="reserve.reserve_forever.else"
RESERVE_FOREVER_TOML_KEY="reserve_forever_hash"

COUNCIL_FOREVER_TITLE="permissioned.council_forever.else"
COUNCIL_FOREVER_TOML_KEY="council_forever_hash"

ICS_FOREVER_TITLE="illiquid_circulation_supply.ics_forever.else"
ICS_FOREVER_TOML_KEY="ics_forever_hash"

TECH_AUTH_FOREVER_TITLE="permissioned.tech_auth_forever.else"
TECH_AUTH_FOREVER_TOML_KEY="technical_authority_forever_hash"

FEDERATED_OPS_FOREVER_TITLE="permissioned.federated_ops_forever.else"
FEDERATED_OPS_FOREVER_TOML_KEY="federated_operators_forever_hash"

TERMS_AND_CONDITIONS_FOREVER_TITLE="terms_and_conditions.terms_and_conditions_forever.else"
TERMS_AND_CONDITIONS_FOREVER_TOML_KEY="terms_and_conditions_forever_hash"

# Committee Bridge validators
COMMITTEE_BRIDGE_FOREVER_TITLE="committee_bridge.committee_bridge_forever.else"
COMMITTEE_BRIDGE_TWO_STAGE_TITLE="committee_bridge.committee_bridge_two_stage_upgrade.else"
COMMITTEE_BRIDGE_TWO_STAGE_TOML_KEY="committee_bridge_two_stage_hash"
COMMITTEE_BRIDGE_FOREVER_TOML_KEY="committee_bridge_forever_hash"

# CNIGHT Minting validators
CNIGHT_MINT_TWO_STAGE_TITLE="cnight_minting.cnight_mint_two_stage_upgrade.else"
CNIGHT_MINT_TWO_STAGE_TOML_KEY="cnight_minting_two_stage_hash"

CNIGHT_MINT_FOREVER_TITLE="cnight_minting.cnight_mint_forever.else"
CNIGHT_MINT_FOREVER_TOML_KEY="cnight_minting_forever_hash"

# Threshold validators (compiled last, depend on forever contracts)
MAIN_GOV_THRESHOLD_TITLE="thresholds.main_gov_threshold.else"
MAIN_GOV_THRESHOLD_TOML_KEY="main_gov_threshold_hash"

STAGING_GOV_THRESHOLD_TITLE="thresholds.staging_gov_threshold.else"
STAGING_GOV_THRESHOLD_TOML_KEY="staging_gov_threshold_hash"

MAIN_COUNCIL_UPDATE_THRESHOLD_TITLE="thresholds.main_council_update_threshold.else"
MAIN_COUNCIL_UPDATE_THRESHOLD_TOML_KEY="main_council_update_threshold_hash"

MAIN_TECH_AUTH_UPDATE_THRESHOLD_TITLE="thresholds.main_tech_auth_update_threshold.else"
MAIN_TECH_AUTH_UPDATE_THRESHOLD_TOML_KEY="main_tech_auth_update_threshold_hash"

MAIN_FEDERATED_OPS_UPDATE_THRESHOLD_TITLE="thresholds.main_federated_ops_update_threshold.else"
MAIN_FEDERATED_OPS_UPDATE_THRESHOLD_TOML_KEY="main_federated_ops_update_threshold_hash"

BRIDGE_SIGNER_THRESHOLD_TITLE="thresholds.beefy_signer_threshold.else"
BRIDGE_SIGNER_THRESHOLD_TOML_KEY="bridge_signer_threshold_hash"

TERMS_AND_CONDITIONS_THRESHOLD_TITLE="thresholds.terms_and_conditions_threshold.else"
TERMS_AND_CONDITIONS_THRESHOLD_TOML_KEY="terms_and_conditions_threshold_hash"

# Help function
show_help() {
    echo "Midnight Reserve Contracts Build Script"
    echo ""
    echo "Usage: $0 <env> [trace_level]"
    echo ""
    echo "Environments:"
    echo "  default      Use for local testing builds"
    echo "  preview      Use for preview testnet"
    echo "  qanet        Use for Midnight QA environment (Cardano Preview)"
    echo "  govnet       Use for Midnight Governance environment (Cardano Preview)"
    echo "  node-dev-01  Use for node dev environment (Cardano Preview)"
    echo "  preprod      Use for preprod testnet"
    echo "  mainnet      Use for mainnet"
    echo ""
    echo "Trace levels (optional):"
    echo "  silent    Minimal output"
    echo "  verbose   Detailed compilation output"
    echo "  compact   Compact compilation output"
    echo ""
    echo "Examples:"
    echo "  $0 preview"
    echo "  $0 qanet verbose"
    echo "  $0 node-dev-01 compact"
}

# Check if help is requested
if [ "$1" == "-h" ] || [ "$1" == "--help" ] || [ "$1" == "help" ]; then
    show_help
    exit 0
fi

# Check if environment parameter is provided
if [ $# -lt 1 ]; then
    echo "Error: Environment parameter required."
    echo ""
    show_help
    exit 1
fi

if [ $# -gt 2 ]; then
    echo "Error: Too many arguments provided."
    echo ""
    show_help
    exit 1
fi

# Convert parameter to lowercase for consistent comparison
NETWORK=$(echo "$1" | tr '[:upper:]' '[:lower:]')

# Set output file based on network for multi-env support
JSON_FILE="plutus-${NETWORK}.json"

TRACE_ARGS=()
if [ $# -ge 2 ]; then
    TRACE_ARGS=(-t "$2")
fi

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if required commands are available
if ! command_exists aiken; then
    echo "Error: aiken is not installed. Please install aiken first."
    exit 1
fi

if ! command_exists jq; then
    echo "Error: jq is not installed. Please install jq first."
    exit 1
fi

if ! command_exists toml; then
    echo "Error: toml-cli is not installed. Please install toml-cli first."
    exit 1
fi

# Function to update hash in TOML file
update_hash() {
    local validator_title="$1"
    local toml_key="$2"
    local JSON_VALUE
    local NEW_TOML_CONTENT

    # Read value from JSON file
    if ! JSON_VALUE=$(validator_hash_by_title "$validator_title"); then
        echo "Error: Failed to read value from JSON file for validator $validator_title" >&2
        exit 1
    fi

    if [ -z "$JSON_VALUE" ] || [ "$JSON_VALUE" == "null" ]; then
        echo "Error: Validator $validator_title returned no hash in $JSON_FILE" >&2
        exit 1
    fi

    # Write value to TOML file using hex encoding format for all networks
    if ! NEW_TOML_CONTENT=$(toml set "$TOML_FILE" "config.$NETWORK.$toml_key.bytes" "$JSON_VALUE"); then
        echo "Error: Failed to write value to TOML file for key $toml_key" >&2
        exit 1
    fi
    write_toml_content "$NEW_TOML_CONTENT"

    if ! NEW_TOML_CONTENT=$(toml set "$TOML_FILE" "config.$NETWORK.$toml_key.encoding" "hex"); then
        echo "Error: Failed to set encoding for key $toml_key" >&2
        exit 1
    fi
    write_toml_content "$NEW_TOML_CONTENT"
}

# Function to set static config value
set_config_value() {
    local toml_key="$1"
    local value="$2"
    local value_type="$3"  # "hex", "string", or "number"
    local NEW_TOML_CONTENT

    if [ "$value_type" == "hex" ]; then
        # Use hex encoding format for all networks
        if ! NEW_TOML_CONTENT=$(toml set "$TOML_FILE" "config.$NETWORK.$toml_key.bytes" "$value"); then
            echo "Error: Failed to set hex value for key $toml_key" >&2
            exit 1
        fi
        write_toml_content "$NEW_TOML_CONTENT"

        if ! NEW_TOML_CONTENT=$(toml set "$TOML_FILE" "config.$NETWORK.$toml_key.encoding" "hex"); then
            echo "Error: Failed to set encoding for key $toml_key" >&2
            exit 1
        fi
        write_toml_content "$NEW_TOML_CONTENT"
    elif [ "$value_type" == "number" ]; then
        # Use sed to set integer values to avoid toml-cli string conversion
        if sed -i '' "s/${toml_key} = \"[^\"]*\"/${toml_key} = ${value}/g" "$TOML_FILE"; then
            # Also handle cases where the value might already be an integer
            sed -i '' "s/${toml_key} = [0-9]*/${toml_key} = ${value}/g" "$TOML_FILE"
        else
            echo "Error: Failed to set number value for key $toml_key" >&2
            exit 1
        fi
    else  # string
        if ! NEW_TOML_CONTENT=$(toml set "$TOML_FILE" "config.$NETWORK.$toml_key" "$value"); then
            echo "Error: Failed to set string value for key $toml_key" >&2
            exit 1
        fi
        write_toml_content "$NEW_TOML_CONTENT"
    fi
}

# Function to update cnight_policy for non-mainnet networks
# Uses the tcnight_mint_infinite validator hash for testing
# Mainnet cnight_policy is managed separately and should never be auto-updated
update_cnight_policy_if_not_mainnet() {
    if [ "$NETWORK" == "mainnet" ]; then
        echo "Skipping cnight_policy update for mainnet (managed separately)"
        return 0
    fi

    # Use the tcnight_mint_infinite validator hash for test networks
    local tcnight_hash
    tcnight_hash=$(validator_hash_by_title "test_cnight_no_audit.tcnight_mint_infinite.else")

    if [ -z "$tcnight_hash" ] || [ "$tcnight_hash" == "null" ]; then
        echo "Warning: Could not get tcnight_mint_infinite hash, keeping existing cnight_policy"
        return 0
    fi

    echo "Updating cnight_policy for $NETWORK network to tcnight_mint_infinite hash..."
    set_config_value "cnight_policy" "$tcnight_hash" "hex"
}

update_two_stage_hashes() {
    update_hash "$RESERVE_TWO_STAGE_TITLE" "$RESERVE_TWO_STAGE_TOML_KEY"
    update_hash "$COUNCIL_TWO_STAGE_TITLE" "$COUNCIL_TWO_STAGE_TOML_KEY"
    update_hash "$ICS_TWO_STAGE_TITLE" "$ICS_TWO_STAGE_TOML_KEY"
    update_hash "$TECH_AUTH_TWO_STAGE_TITLE" "$TECH_AUTH_TWO_STAGE_TOML_KEY"
    update_hash "$FEDERATED_OPS_TWO_STAGE_TITLE" "$FEDERATED_OPS_TWO_STAGE_TOML_KEY"
    update_hash "$TERMS_AND_CONDITIONS_TWO_STAGE_TITLE" "$TERMS_AND_CONDITIONS_TWO_STAGE_TOML_KEY"
    update_hash "$COMMITTEE_BRIDGE_TWO_STAGE_TITLE" "$COMMITTEE_BRIDGE_TWO_STAGE_TOML_KEY"
    update_hash "$CNIGHT_MINT_TWO_STAGE_TITLE" "$CNIGHT_MINT_TWO_STAGE_TOML_KEY"
}

update_forever_hashes() {
    update_hash "$RESERVE_FOREVER_TITLE" "$RESERVE_FOREVER_TOML_KEY"
    update_hash "$COUNCIL_FOREVER_TITLE" "$COUNCIL_FOREVER_TOML_KEY"
    update_hash "$ICS_FOREVER_TITLE" "$ICS_FOREVER_TOML_KEY"
    update_hash "$TECH_AUTH_FOREVER_TITLE" "$TECH_AUTH_FOREVER_TOML_KEY"
    update_hash "$FEDERATED_OPS_FOREVER_TITLE" "$FEDERATED_OPS_FOREVER_TOML_KEY"
    update_hash "$TERMS_AND_CONDITIONS_FOREVER_TITLE" "$TERMS_AND_CONDITIONS_FOREVER_TOML_KEY"
    update_hash "$COMMITTEE_BRIDGE_FOREVER_TITLE" "$COMMITTEE_BRIDGE_FOREVER_TOML_KEY"
    update_hash "$CNIGHT_MINT_FOREVER_TITLE" "$CNIGHT_MINT_FOREVER_TOML_KEY"
}

update_threshold_hashes() {
    update_hash "$MAIN_GOV_THRESHOLD_TITLE" "$MAIN_GOV_THRESHOLD_TOML_KEY"
    update_hash "$STAGING_GOV_THRESHOLD_TITLE" "$STAGING_GOV_THRESHOLD_TOML_KEY"
    update_hash "$MAIN_COUNCIL_UPDATE_THRESHOLD_TITLE" "$MAIN_COUNCIL_UPDATE_THRESHOLD_TOML_KEY"
    update_hash "$MAIN_TECH_AUTH_UPDATE_THRESHOLD_TITLE" "$MAIN_TECH_AUTH_UPDATE_THRESHOLD_TOML_KEY"
    update_hash "$MAIN_FEDERATED_OPS_UPDATE_THRESHOLD_TITLE" "$MAIN_FEDERATED_OPS_UPDATE_THRESHOLD_TOML_KEY"
    update_hash "$BRIDGE_SIGNER_THRESHOLD_TITLE" "$BRIDGE_SIGNER_THRESHOLD_TOML_KEY"
    update_hash "$TERMS_AND_CONDITIONS_THRESHOLD_TITLE" "$TERMS_AND_CONDITIONS_THRESHOLD_TOML_KEY"
}

refresh_all_validator_hashes() {
    echo "Refreshing validator hashes from current blueprint..."
    update_two_stage_hashes
    update_forever_hashes
    update_threshold_hashes
}

# Function to compile once
compile_phase() {
    local description="$1"

    echo "Building $description..."

    local compile_started_at
    compile_started_at=$(current_epoch_seconds)

    if ! aiken build -S --env "$NETWORK" -o "$JSON_FILE" "${TRACE_ARGS[@]}"; then
        echo "Error: Failed to build aiken for $description" >&2
        exit 1
    fi

    ensure_blueprint_is_current "$description" "$compile_started_at"
}

# Check if files exist
if [ ! -f "$TOML_FILE" ]; then
    echo "Error: TOML file '$TOML_FILE' not found."
    exit 1
fi

if [ ! -r "$TOML_FILE" ]; then
    echo "Error: Cannot read TOML file '$TOML_FILE'. Check permissions."
    exit 1
fi

echo "Starting compilation for network: $NETWORK"
echo "=========================================="

# Initial compile to get tcnight_mint_infinite hash for cnight_policy
echo "Initial compilation for cnight_policy..."
compile_phase "Initial Build"
update_cnight_policy_if_not_mainnet

# Phase 1: Two-stage validators (batch compile)
echo "Phase 1: Setting up two-stage validators..."
compile_phase "Two-Stage Validators"
echo "Updating two-stage validator hashes..."
update_two_stage_hashes

# Phase 2: Forever validators (batch compile)
echo "Phase 2: Setting up forever validators..."
compile_phase "Forever Validators"
echo "Updating forever validator hashes..."
update_forever_hashes

# Phase 3: Threshold validators (batch compile - depend on forever contracts)
echo "Phase 3: Setting up threshold validators..."
compile_phase "Threshold Validators"
echo "Updating threshold validator hashes..."
update_threshold_hashes

# Final compilation with all hashes in place
echo "Final compilation..."
final_compile_run
refresh_all_validator_hashes

MAX_VERIFY_ATTEMPTS=2
verify_attempt=1
while ! verify_logic_dependencies; do
    if [ $verify_attempt -ge $MAX_VERIFY_ATTEMPTS ]; then
        echo "Error: Logic validators still reference stale threshold hashes." >&2
        exit 1
    fi

    echo "Detected stale logic bytecode; rebuilding with refreshed hashes..."
    reset_build_lock
    rm -f "$JSON_FILE"
    final_compile_run
    refresh_all_validator_hashes
    verify_attempt=$((verify_attempt + 1))
done

echo "=========================================="
echo "Successfully compiled midnight-reserve-contracts for $NETWORK network."
echo "Blueprint written to: $JSON_FILE"
echo "All validators have been compiled and hashes updated in aiken.toml"

exit 0
