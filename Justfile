validator_json_indices:
    #!/bin/bash
    jq -r '.validators[] | "\(.title)"' plutus.json | nl -v0


build env="default" verbosity="verbose":
    #!/bin/bash
    ./build_contracts.sh {{env}} {{verbosity}}
    bunx @blaze-cardano/blueprint@latest plutus.json -o contract_blueprint.ts


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
