validator_json_indices env="default":
    #!/bin/bash
    jq -r '.validators[] | "\(.title)"' plutus-{{env}}.json | nl -v0


build env="default" verbosity="verbose":
    #!/bin/bash
    ./build_contracts.sh {{env}} {{verbosity}}
    bunx @blaze-cardano/blueprint@latest plutus-{{env}}.json -o contract_blueprint_{{env}}.ts
    # Copy to contract_blueprint.ts for CLI and test imports (always uses last-built env)
    cp contract_blueprint_{{env}}.ts contract_blueprint.ts


aiken-check verbosity="verbose":
    #!/bin/bash
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


cli *args:
    bun cli/index.ts {{args}}
