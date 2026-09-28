#!/usr/bin/env bash
# The Lace wallet's backend for the local devnet, beside local-env: Blockfrost
# RYO over the stack's db-sync (the devnet's Shelley genesis as a custom
# network, read from the running stack since systemStart changes each run)
# and tests/private-net/lace-shim.ts on http://localhost:3001, which Lace
# takes as its Blockfrost proxy for Preprod. `up` needs a running local-env;
# `down` stops both. Usage: lace-backend.sh up|down
set -euo pipefail
action=$1
work=$PWD/.private-net/lace-backend
ryo_image=blockfrost/backend-ryo:v6.6.1

# Run `$@` until it succeeds, at most `$1` tries a second apart.
wait_for() {
  local tries=$1
  shift
  until "$@" >/dev/null 2>&1; do
    tries=$((tries - 1))
    [ "$tries" -gt 0 ] || { echo "timed out waiting for: $*" >&2; exit 1; }
    sleep 1
  done
}

case $action in
  up)
    mkdir -p "$work/genesis"
    # cardano.ready comes after the entrypoint rewrites systemStart.
    wait_for 600 docker exec cardano-node-1 test -f /shared/cardano.ready
    docker exec cardano-node-1 cat /shared/shelley/genesis.json | jq '{
      active_slots_coefficient: .activeSlotsCoeff,
      update_quorum: .updateQuorum,
      max_lovelace_supply: (.maxLovelaceSupply | tostring),
      network_magic: .networkMagic,
      epoch_length: .epochLength,
      system_start: (.systemStart | fromdateiso8601),
      slots_per_kes_period: .slotsPerKESPeriod,
      slot_length: .slotLength,
      max_kes_evolutions: .maxKESEvolutions,
      security_param: .securityParam
    }' > "$work/genesis/genesis.json"
    # The devnet forks past Byron at slot 0: a Byron era of no epochs.
    echo '{"epoch_length": 60, "slot_length": 1, "safe_zone": 15, "end_epoch": 0}' > "$work/genesis/byron_genesis.json"
    password=$(docker inspect postgres --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_PASSWORD=//p')
    network=$(docker inspect postgres --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}')
    docker rm -f blockfrost-ryo >/dev/null 2>&1 || true
    docker run -d --name blockfrost-ryo --platform linux/amd64 --network "$network" -p 3000:3000 \
      -e BLOCKFROST_CONFIG_SERVER_LISTEN_ADDRESS=0.0.0.0 \
      -e BLOCKFROST_CONFIG_NETWORK=custom \
      -e BLOCKFROST_CONFIG_GENESIS_DATA_FOLDER=/genesis \
      -e BLOCKFROST_CONFIG_DBSYNC_HOST=postgres \
      -e BLOCKFROST_CONFIG_DBSYNC_PORT=5432 \
      -e BLOCKFROST_CONFIG_DBSYNC_USER=postgres \
      -e BLOCKFROST_CONFIG_DBSYNC_DATABASE=cexplorer \
      -e BLOCKFROST_CONFIG_DBSYNC_PASSWORD="$password" \
      -e BLOCKFROST_CONFIG_DBSYNC_MAX_CONN=4 \
      -e BLOCKFROST_PM2_INSTANCE_COUNT=2 \
      -e BLOCKFROST_CONFIG_TOKEN_REGISTRY_ENABLED=false \
      -e BLOCKFROST_CONFIG_TOKEN_REGISTRY_URL=http://localhost \
      -e BLOCKFROST_MITHRIL_ENABLED=false \
      -v "$work/genesis:/genesis:ro" \
      "$ryo_image" >/dev/null
    wait_for 600 curl -fs http://localhost:3000/health
    nohup bun tests/private-net/lace-shim.ts > "$work/shim.log" 2>&1 &
    echo $! > "$work/shim.pid"
    wait_for 30 curl -fs http://localhost:3001/extension/preprod/api/v0/health
    echo "Lace backend: http://localhost:3001 (BLOCKFROST_PROXY_URL); RYO on :3000"
    ;;
  down)
    if [ -f "$work/shim.pid" ]; then
      kill "$(cat "$work/shim.pid")" 2>/dev/null || true
      rm -f "$work/shim.pid"
    fi
    docker rm -f blockfrost-ryo >/dev/null 2>&1 || true
    ;;
  *)
    echo "usage: lace-backend.sh up|down" >&2
    exit 1
    ;;
esac
