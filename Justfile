validator_json_indices:
    #!/bin/bash
    jq -r '.validators[] | "\(.title)"' plutus.json | nl -v0


build env="default" verbosity="verbose":
    #!/bin/bash
    ./build_contracts.sh {{env}} {{verbosity}}
    bunx @blaze-cardano/blueprint@latest plutus.json -o contract_blueprint.ts


check verbosity="verbose":
    #!/bin/bash
    aiken check -S -t {{verbosity}}
