validator_json_indices env="default":
    #!/bin/bash
    jq -r '.validators[] | "\(.title)"' plutus-{{env}}.json | nl -v0


build env="default" verbosity="verbose":
    bun cli/index.ts build -n {{env}} --trace {{verbosity}}


aiken-check verbosity="verbose":
    #!/usr/bin/env bash
    aiken check -S -t {{verbosity}}


check: aiken-check
    bun run check


# The test suite plus the chain-facing tests against preview (reads only; needs .env)
test-preview:
    TEST_NETWORK=preview bun test


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
        bun node_modules/.bin/blueprint plutus-{{env}}.json -o contract_blueprint_{{env}}.ts
    fi
    cp contract_blueprint_{{env}}.ts contract_blueprint.ts
    echo "Activated environment: {{env}}"


# The node repo's local-env stack (local Cardano devnet, db-sync, six nodes) on a node ref, sessions of `session_slots` 6 s slots, a Cardano epoch of `mc_epoch` s (a multiple of the session); RPC http://localhost:9945; then the Lace wallet's backend (Blockfrost RYO and the shim, BLOCKFROST_PROXY_URL=http://localhost:3001)
private-net-up node="../midnight-node" ref="kc-block-rewards" session_slots="10" mc_epoch="60":
    demo/local-env.sh up {{node}} {{ref}} {{session_slots}} {{mc_epoch}}
    demo/lace-backend.sh up


private-net-down node="../midnight-node" ref="kc-block-rewards":
    demo/lace-backend.sh down
    demo/local-env.sh down {{node}} {{ref}}


# The rewards demo's Cardano side on the new stack: the committee bridge, the rewards contracts, the reserve on reserve_logic_v2 and one virtual account per permissioned candidate (demo/rewards-deploy.sh)
private-net-deploy:
    demo/rewards-deploy.sh


# The data pump on the deployed stack: each committee handover, reserve release and rewards batch as it falls due
private-net-pump:
    cd .private-net/demo && KUPO_URL=http://127.0.0.1:1442 OGMIOS_URL=ws://127.0.0.1:1337 bun cli/index.ts pump -p kupmios --use-build --rpc http://127.0.0.1:9945


# The transaction viewer on the deployed stack: the Lace wallet's and its account's transactions and any by hash, on http://127.0.0.1:3002
private-net-explorer:
    bun demo/explorer/server.ts
