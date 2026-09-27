#!/usr/bin/env bash
# The node repo's local-env stack on a node ref: a local Cardano devnet with
# db-sync and six Midnight nodes, nothing mocked; RPC http://localhost:9945
# (archive). It runs from an export of the ref in .private-net/, since its
# setup rewrites res/ in place, with the contracts commit the ref pins.
# Earthly builds the node repo's working copy, so a missing image needs the
# repo at the ref with no changes.
# Usage: local-env.sh up|down [node repo] [ref]
set -euo pipefail
action=$1
node=$(cd "${2:-../midnight-node}" && pwd)
ref=${3:-kc-beefy-mip-alignment}
work=$PWD/.private-net
tree=$(git -C "$node" rev-parse "$ref^{tree}")
version=$(sed -n 's/^version = "\(.*\)"$/\1/p' "$node/node/Cargo.toml" | head -1)
arch=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')
tag=$version-${tree:0:12}-$arch
export ARCHITECTURE=linux/$arch
export MIDNIGHT_NODE_IMAGE=ghcr.io/midnight-ntwrk/midnight-node:$tag
export TOOLKIT_IMAGE=ghcr.io/midnight-ntwrk/midnight-node-toolkit:$tag
export MIDNIGHT_RESERVE_CONTRACTS_PATH=$work/contracts

build() {
  docker image inspect "$1" >/dev/null 2>&1 && return
  if [ "$(git -C "$node" rev-parse 'HEAD^{tree}')" != "$tree" ] || [ -n "$(git -C "$node" status --porcelain)" ]; then
    echo "$1 is missing, and $node is not $ref with no changes" >&2
    exit 1
  fi
  (cd "$node" && earthly "+$2")
}

case $action in
  up)
    if docker ps --format '{{.Names}}' | grep -qx midnight-node-1; then
      echo "a local-env stack is running; stop it first: just private-net-down" >&2
      exit 1
    fi
    build "$MIDNIGHT_NODE_IMAGE" node-image
    build "$TOOLKIT_IMAGE" toolkit-image
    rm -rf "$work"
    mkdir -p "$work/node" "$work/contracts"
    git -C "$node" archive "$ref" | tar -x -C "$work/node"
    git archive "$(git -C "$node" rev-parse "$ref:midnight-reserve-contracts")" | tar -x -C "$work/contracts"
    cd "$work/node/local-environment"
    npm ci
    npm run run:local-env
    ;;
  down)
    cd "$work/node/local-environment"
    npm run stop:local-env
    ;;
  *)
    echo "usage: local-env.sh up|down [node repo] [ref]" >&2
    exit 1
    ;;
esac
