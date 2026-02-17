validator_json_indices env="default":
    #!/bin/bash
    jq -r '.validators[] | "\(.title)"' plutus-{{env}}.json | nl -v0


build env="default" verbosity="verbose":
    #!/usr/bin/env bash
    ./build_contracts.sh {{env}} {{verbosity}}
    bunx @blaze-cardano/blueprint@latest plutus-{{env}}.json -o contract_blueprint_{{env}}.ts
    # Copy to contract_blueprint.ts for CLI and test imports (always uses last-built env)
    cp contract_blueprint_{{env}}.ts contract_blueprint.ts


aiken-check verbosity="verbose":
    #!/usr/bin/env bash
    aiken check -S -t {{verbosity}}


check:
    bun run check


lint:
    bun run lint


fmt:
    bun run fmt
    aiken fmt


fmt-check:
    bun run fmt:check
    aiken fmt --check


use-env env:
    #!/bin/bash
    if [ ! -f "plutus-{{env}}.json" ]; then
        echo "Error: plutus-{{env}}.json not found."
        echo "For deployed environments, extract from deployment commit."
        echo "For new builds, run 'just build {{env}}' first."
        exit 1
    fi
    if [ ! -f "contract_blueprint_{{env}}.ts" ]; then
        echo "Generating contract_blueprint_{{env}}.ts from plutus-{{env}}.json..."
        bunx @blaze-cardano/blueprint@latest plutus-{{env}}.json -o contract_blueprint_{{env}}.ts
    fi
    cp contract_blueprint_{{env}}.ts contract_blueprint.ts
    echo "Activated environment: {{env}}"


cli *args:
    bun cli-yargs/index.ts {{args}}
