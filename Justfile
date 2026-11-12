validator_json_indices env="default":
    #!/bin/bash
    jq -r '.validators[] | "\(.title)"' plutus-{{env}}.json | nl -v0


build env="default" verbosity="verbose":
    vpx cli/main.ts build -n {{env}} --trace {{verbosity}}


aiken-check verbosity="verbose":
    #!/usr/bin/env bash
    aiken check -S -t {{verbosity}}


check: aiken-check
    vp check
    vp exec tsc --noEmit


lint:
    vp lint


fmt:
    vp fmt
    aiken fmt


fmt-check:
    vp fmt --check
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
        vp exec blueprint plutus-{{env}}.json -o contract_blueprint_{{env}}.ts
    fi
    cp contract_blueprint_{{env}}.ts contract_blueprint.ts
    echo "Activated environment: {{env}}"


cli *args:
    vpx cli/main.ts {{args}}


# One SVG per transaction diagram (docs/transactions/README.md); needs typst.
tx-diagrams:
    #!/usr/bin/env bash
    set -euo pipefail
    cd docs/transactions
    for area in staking registration reserve; do
        for tx in $(typst eval 'query(<txs>).first().value.join(" ")' --in $area.typ | tr -d '"'); do
            typst compile --input tx=$tx $area.typ svg/$area-$tx.svg
        done
    done
