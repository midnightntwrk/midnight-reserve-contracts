#!/bin/bash
set -euo pipefail

# Midnight Reserve Contracts Build Script
#
# This script compiles Aiken contracts in the correct dependency order:
# 1. Two-stage validators (batch update then single compile)
# 2. Forever validators (batch update then single compile)
# 3. Threshold validators (batch update then single compile - depend on forever contracts)
# 4. Committee bridge (single validator for multiple hashes)
#
# Usage: ./build_contracts.sh <default|preview|preprod> [silent|verbose|compact]
#
# Network options:
#   default  - Use for local testing builds
#   preview  - Use for preview testnet (uses hex encoding)
#   preprod  - Use for preprod testnet
#
# Trace options:
#   silent   - Minimal output
#   verbose  - Detailed compilation output
#   compact  - Compact compilation output

# Define files
JSON_FILE="plutus.json"
TOML_FILE="aiken.toml"

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

# Define validator positions and TOML keys in dependency order
# Order: two_stage -> forever -> logic/auth -> thresholds -> committee_bridge

# Two-stage validators (compiled first)
RESERVE_TWO_STAGE_PLUTUS_KEY=".validators.[21].hash"
RESERVE_TWO_STAGE_TOML_KEY="reserve_two_stage_hash"

COUNCIL_TWO_STAGE_PLUTUS_KEY=".validators.[12].hash"
COUNCIL_TWO_STAGE_TOML_KEY="council_two_stage_hash"

ICS_TWO_STAGE_PLUTUS_KEY=".validators.[9].hash"
ICS_TWO_STAGE_TOML_KEY="ics_two_stage_hash"

TECH_AUTH_TWO_STAGE_PLUTUS_KEY=".validators.[18].hash"
TECH_AUTH_TWO_STAGE_TOML_KEY="technical_authority_two_stage_hash"

FEDERATED_OPS_TWO_STAGE_PLUTUS_KEY=".validators.[15].hash"
FEDERATED_OPS_TWO_STAGE_TOML_KEY="federated_operators_two_stage_hash"

# Forever validators (compiled second)
RESERVE_FOREVER_PLUTUS_KEY=".validators.[19].hash"
RESERVE_FOREVER_TOML_KEY="reserve_forever_hash"

COUNCIL_FOREVER_PLUTUS_KEY=".validators.[10].hash"
COUNCIL_FOREVER_TOML_KEY="council_forever_hash"

ICS_FOREVER_PLUTUS_KEY=".validators.[7].hash"
ICS_FOREVER_TOML_KEY="ics_forever_hash"

TECH_AUTH_FOREVER_PLUTUS_KEY=".validators.[16].hash"
TECH_AUTH_FOREVER_TOML_KEY="technical_authority_forever_hash"

FEDERATED_OPS_FOREVER_PLUTUS_KEY=".validators.[13].hash"
FEDERATED_OPS_FOREVER_TOML_KEY="federated_operators_forever_hash"



# Committee Bridge validators
COMMITTEE_BRIDGE_FOREVER_PLUTUS_KEY=".validators.[1].hash"
COMMITTEE_BRIDGE_TWO_STAGE_PLUTUS_KEY=".validators.[3].hash"
COMMITTEE_BRIDGE_TWO_STAGE_TOML_KEY="committee_bridge_two_stage_hash"
COMMITTEE_BRIDGE_FOREVER_TOML_KEY="committee_bridge_forever_hash"

# Threshold validators (compiled last, depend on forever contracts)
MAIN_GOV_THRESHOLD_PLUTUS_KEY=".validators.[24].hash"
MAIN_GOV_THRESHOLD_TOML_KEY="main_gov_threshold_hash"

STAGING_GOV_THRESHOLD_PLUTUS_KEY=".validators.[26].hash"
STAGING_GOV_THRESHOLD_TOML_KEY="staging_gov_threshold_hash"

MAIN_COUNCIL_UPDATE_THRESHOLD_PLUTUS_KEY=".validators.[22].hash"
MAIN_COUNCIL_UPDATE_THRESHOLD_TOML_KEY="main_council_update_threshold_hash"

MAIN_TECH_AUTH_UPDATE_THRESHOLD_PLUTUS_KEY=".validators.[25].hash"
MAIN_TECH_AUTH_UPDATE_THRESHOLD_TOML_KEY="main_tech_auth_update_threshold_hash"

MAIN_FEDERATED_OPS_UPDATE_THRESHOLD_PLUTUS_KEY=".validators.[23].hash"
MAIN_FEDERATED_OPS_UPDATE_THRESHOLD_TOML_KEY="main_federated_ops_update_threshold_hash"

# Help function
show_help() {
    echo "Midnight Reserve Contracts Build Script"
    echo ""
    echo "Usage: $0 <network> [trace_level]"
    echo ""
    echo "Networks:"
    echo "  default   Use for local testing builds"
    echo "  preview   Use for preview testnet (uses hex encoding)"
    echo "  preprod   Use for preprod testnet"
    echo ""
    echo "Trace levels (optional):"
    echo "  silent    Minimal output"
    echo "  verbose   Detailed compilation output"
    echo "  compact   Compact compilation output"
    echo ""
    echo "Examples:"
    echo "  $0 preview"
    echo "  $0 default verbose"
    echo "  $0 preview compact"
}

# Check if help is requested
if [ "$1" == "-h" ] || [ "$1" == "--help" ] || [ "$1" == "help" ]; then
    show_help
    exit 0
fi

# Check if network parameter is provided
if [ $# -lt 1 ]; then
    echo "Error: Network parameter required."
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
    local plutus_key="$1"
    local toml_key="$2"
    local JSON_VALUE
    local NEW_TOML_CONTENT

    # Read value from JSON file
    if ! JSON_VALUE=$(jq -r "$plutus_key" "$JSON_FILE"); then
        echo "Error: Failed to read value from JSON file for key $plutus_key" >&2
        exit 1
    fi

    if [ -z "$JSON_VALUE" ] || [ "$JSON_VALUE" == "null" ]; then
        echo "Error: Key $plutus_key returned no value in $JSON_FILE" >&2
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

# Function to compile once
compile_phase() {
    local description="$1"

    echo "Building $description..."

    local compile_started_at
    compile_started_at=$(current_epoch_seconds)

    if ! aiken build --env "$NETWORK" "${TRACE_ARGS[@]}"; then
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

# Phase 1: Two-stage validators (batch compile)
echo "Phase 1: Setting up two-stage validators..."
compile_phase "Two-Stage Validators"
echo "Updating two-stage validator hashes..."
update_hash "$RESERVE_TWO_STAGE_PLUTUS_KEY" "$RESERVE_TWO_STAGE_TOML_KEY"
update_hash "$COUNCIL_TWO_STAGE_PLUTUS_KEY" "$COUNCIL_TWO_STAGE_TOML_KEY"
update_hash "$ICS_TWO_STAGE_PLUTUS_KEY" "$ICS_TWO_STAGE_TOML_KEY"
update_hash "$TECH_AUTH_TWO_STAGE_PLUTUS_KEY" "$TECH_AUTH_TWO_STAGE_TOML_KEY"
update_hash "$FEDERATED_OPS_TWO_STAGE_PLUTUS_KEY" "$FEDERATED_OPS_TWO_STAGE_TOML_KEY"
update_hash "$COMMITTEE_BRIDGE_TWO_STAGE_PLUTUS_KEY" "$COMMITTEE_BRIDGE_TWO_STAGE_TOML_KEY"

# Phase 2: Forever validators (batch compile)
echo "Phase 2: Setting up forever validators..."
compile_phase "Forever Validators"
echo "Updating forever validator hashes..."
update_hash "$RESERVE_FOREVER_PLUTUS_KEY" "$RESERVE_FOREVER_TOML_KEY"
update_hash "$COUNCIL_FOREVER_PLUTUS_KEY" "$COUNCIL_FOREVER_TOML_KEY"
update_hash "$ICS_FOREVER_PLUTUS_KEY" "$ICS_FOREVER_TOML_KEY"
update_hash "$TECH_AUTH_FOREVER_PLUTUS_KEY" "$TECH_AUTH_FOREVER_TOML_KEY"
update_hash "$FEDERATED_OPS_FOREVER_PLUTUS_KEY" "$FEDERATED_OPS_FOREVER_TOML_KEY"
update_hash "$COMMITTEE_BRIDGE_FOREVER_PLUTUS_KEY" "$COMMITTEE_BRIDGE_FOREVER_TOML_KEY"

# Phase 3: Threshold validators (batch compile - depend on forever contracts)
echo "Phase 3: Setting up threshold validators..."
compile_phase "Threshold Validators"
echo "Updating threshold validator hashes..."
update_hash "$MAIN_GOV_THRESHOLD_PLUTUS_KEY" "$MAIN_GOV_THRESHOLD_TOML_KEY"
update_hash "$STAGING_GOV_THRESHOLD_PLUTUS_KEY" "$STAGING_GOV_THRESHOLD_TOML_KEY"
update_hash "$MAIN_COUNCIL_UPDATE_THRESHOLD_PLUTUS_KEY" "$MAIN_COUNCIL_UPDATE_THRESHOLD_TOML_KEY"
update_hash "$MAIN_TECH_AUTH_UPDATE_THRESHOLD_PLUTUS_KEY" "$MAIN_TECH_AUTH_UPDATE_THRESHOLD_TOML_KEY"
update_hash "$MAIN_FEDERATED_OPS_UPDATE_THRESHOLD_PLUTUS_KEY" "$MAIN_FEDERATED_OPS_UPDATE_THRESHOLD_TOML_KEY"

# Final compilation with all hashes in place
echo "Final compilation..."
final_compile_started_at=$(current_epoch_seconds)
if ! aiken build --env "$NETWORK" "${TRACE_ARGS[@]}"; then
    echo "Error: Failed to perform final build" >&2
    exit 1
fi
ensure_blueprint_is_current "Final compilation" "$final_compile_started_at"

echo "=========================================="
echo "Successfully compiled midnight-reserve-contracts for $NETWORK network."
echo "All validators have been compiled and hashes updated in aiken.toml"

exit 0
