#!/usr/bin/env bash
# The rewards demo's Cardano side on a fresh local-env stack (just private-net-up):
# the committee bridge (bootstrapped at BEEFY's finalized block, pool funded), the
# rewards contracts (first epoch two after the current one), the reserve moved to
# reserve_logic_v2, and one virtual account per permissioned candidate, registered
# with its sidechain key and a new stake key; then pool1's operator account (its reward
# key) and a delegator: the Lace wallet of LACE_PHRASE, funded and delegated to pool1 but
# not registered, as the demo registers it in Lace. Each registered account routes all
# its rewards to one DUST address (kind 0x00): an operator's from its sidechain secret
# and pool1's from its reward key. The CLI runs from .private-net/demo,
# a copy of the contract compiler's workspace: the pinned contracts with the deployed
# local profile and the local-env keys. Afterwards `just private-net-pump` runs the pump there.
# Usage: rewards-deploy.sh
set -euo pipefail
repo=$PWD
demo=$repo/.private-net/demo
configurations=$repo/.private-net/node/local-environment/src/networks/local-env/configurations
nodes=$configurations/midnight-nodes
candidates=$repo/.private-net/node/res/local/permissioned-candidates-config.json
rpc=http://127.0.0.1:9945
export KUPO_URL=http://127.0.0.1:1442 OGMIOS_URL=ws://127.0.0.1:1337
# The demo delegator's wallet; devnet only. Lace restores it from this phrase.
LACE_PHRASE="flip album cattle distance master jacket horror drink they frequent rough rapid ramp celery deputy all subject rate they ignore bird plastic future switch"

cli() { bun cli/index.ts "$@"; }
# Kupo lags a confirmed transaction; the next build waits for it.
submit() { cli sign-and-submit -p kupmios "$1"; sleep 8; }
call() {
  curl -s -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" $rpc
}
block_number() { echo $(( $(call chain_getHeader "[\"$1\"]" | jq -r .result.number) )); }
# A pure-ADA deployer UTxO to pay a governance fee.
fee_utxo() {
  curl -s "$KUPO_URL/matches/$deployer?unspent" | jq -r '[.[]
    | select(.script_hash == null and (.value.assets | length) == 0 and .value.coins >= 500000000)][0]
    | "\(.transaction_id) \(.output_index)"'
}

# Run a cardano-cli transaction script in cardano-node-1 over the files in $1 (moved
# there); the script sees $magic and $deposit and writes tx.signed. Prints the
# transaction id once Kupo has it.
cardano_tx() {
  local txid
  docker exec cardano-node-1 rm -rf /tmp/rewards-deploy
  docker cp "$1" cardano-node-1:/tmp/rewards-deploy >/dev/null
  rm -rf "$1"
  txid=$(docker exec -w /tmp/rewards-deploy cardano-node-1 sh -ec "
    magic=\$(jq .networkMagic /shared/shelley/genesis.json)
    deposit=\$(cardano-cli conway query protocol-parameters --testnet-magic \$magic | jq .stakeAddressDeposit)
    $2
    cardano-cli conway transaction submit --testnet-magic \$magic --tx-file tx.signed >/dev/null
    cardano-cli conway transaction txid --tx-file tx.signed | jq -r .txhash")
  until curl -s "$KUPO_URL/matches/*@$txid" | jq -e 'length > 0' >/dev/null; do sleep 2; done
  sleep 8
  echo "$txid"
}
# A cardano-cli signing key file of type $1 and CBOR $2.
key_file() { printf '{"type":"%s","description":"","cborHex":"%s"}' "$1" "$2"; }

# Register a script's stake credential. The CLI cannot see stake registrations on
# local (Ogmios lists only delegated reward accounts), so promote-upgrade does not
# register the promoted logic here.
register_stake() {
  local work
  work=$(mktemp -d)
  jq --arg t "$1" '{type: "PlutusScriptV3", description: "",
    cborHex: (.validators[] | select(.title == $t) | .compiledCode)}' plutus-local.json > "$work/logic.plutus"
  key_file PaymentSigningKeyShelley_ed25519 "5820$(sed -n 's/^SIGNING_PRIVATE_KEY=//p' .env)" > "$work/deployer.skey"
  read -r tx ix < <(fee_utxo)
  echo "Registered the stake credential of $1: $(cardano_tx "$work" "
    cardano-cli conway stake-address registration-certificate --stake-script-file logic.plutus \\
      --key-reg-deposit-amt \$deposit --out-file reg.cert
    cardano-cli conway transaction build --testnet-magic \$magic --tx-in $tx#$ix --tx-in-collateral $tx#$ix \\
      --certificate-file reg.cert --certificate-script-file logic.plutus --certificate-redeemer-value 0 \\
      --change-address $deployer --out-file tx.raw >/dev/null
    cardano-cli conway transaction sign --testnet-magic \$magic --tx-body-file tx.raw \\
      --signing-key-file deployer.skey --out-file tx.signed")"
}

# Register the Lace wallet's stake key and delegate it to pool1, paid from the wallet.
delegate_to_pool1() {
  local work address stake_address
  work=$(mktemp -d)
  address=$(sed -n 's/^LACE_ADDRESS=//p' .env)
  stake_address=$(sed -n 's/^LACE_STAKE_ADDRESS=//p' .env)
  key_file PaymentExtendedSigningKeyShelley_ed25519_bip32 "$(sed -n 's/^LACE_PAYMENT_XSK=//p' .env)" > "$work/payment.xsk"
  key_file StakeExtendedSigningKeyShelley_ed25519_bip32 "$(sed -n 's/^LACE_STAKE_XSK=//p' .env)" > "$work/stake.xsk"
  read -r tx ix < <(curl -s "$KUPO_URL/matches/$address?unspent" | jq -r '.[0] | "\(.transaction_id) \(.output_index)"')
  echo "Delegated $stake_address to pool1: $(cardano_tx "$work" "
    pool=\$(cardano-cli conway stake-pool id --cold-verification-key-file /keys/cold.vkey --output-format hex)
    cardano-cli conway stake-address registration-certificate --stake-address $stake_address \\
      --key-reg-deposit-amt \$deposit --out-file reg.cert
    cardano-cli conway stake-address stake-delegation-certificate --stake-address $stake_address \\
      --stake-pool-id \$pool --out-file deleg.cert
    cardano-cli conway transaction build --testnet-magic \$magic --tx-in $tx#$ix \\
      --certificate-file reg.cert --certificate-file deleg.cert --change-address $address --out-file tx.raw >/dev/null
    cardano-cli conway transaction sign --testnet-magic \$magic --tx-body-file tx.raw \\
      --signing-key-file payment.xsk --signing-key-file stake.xsk --out-file tx.signed")"
}

# The DUST public key bytes (a designation's dust_address) of a Midnight wallet seed,
# hex or a BIP39 phrase, derived as Lace derives its first account.
dust_bytes() {
  local image
  image=$(docker inspect midnight-node-1 --format '{{.Config.Image}}')
  docker run --rm "${image/midnight-node:/midnight-node-toolkit:}" \
    show-address --network local --seed "$1" --dust-public
}

# Each permissioned candidate's sidechain secret: every seed local-env gives its nodes
# (keystore SURIs, seed files, the dev names), derived and matched to the chain spec.
operator_secrets() {
  local image
  image=$(docker inspect midnight-node-1 --format '{{.Config.Image}}')
  {
    for f in "$nodes"/*/keystore/63726368*; do jq -r . "$f"; done
    for f in "$nodes"/*/seeds/cross_chain.seed; do cat "$f"; echo; done
    printf '//%s\n' Alice Bob Charlie Dave Eve Ferdie
  } | docker run --rm -i --entrypoint sh "$image" -c \
    'while IFS= read -r s; do [ -n "$s" ] && /midnight-node key inspect --scheme ecdsa --output-type json "$s"; done' \
    | jq -rs --argjson wanted "$(jq '[.initial_permissioned_candidates[].sidechain_pub_key]' "$candidates")" \
      'map(select(.publicKey as $k | $wanted | index($k))) | unique_by(.publicKey) | .[].secretSeed[2:]'
}

if [ -e "$demo" ]; then
  echo "$demo exists: this stack is deployed already; just private-net-up makes a new one" >&2
  exit 1
fi

echo "=== Workspace: the contract compiler's contracts in $demo"
docker cp contract-compiler:/tmp/contracts "$demo"
cd "$demo"
rm -rf node_modules
bun install >/dev/null
deployer=$(sed -n 's/^DEPLOYER_ADDRESS=//p' .env)

echo "=== Committee bridge"
until h=$(call beefy_getFinalizedHead '[]' | jq -r '.result // empty') && [ -n "$h" ] \
  && [ "$(block_number "$h")" -ge 2 ]; do sleep 5; done
activation=$(block_number "$h")
cli bridge-bootstrap --rpc $rpc --activation "$activation" | tee bridge-bootstrap.txt
{
  echo
  echo "# rewards-deploy: the committee bridge from block $activation"
  grep '^BRIDGE_' bridge-bootstrap.txt
  echo BRIDGE_MAX_FEE_BASE=650000
  echo BRIDGE_MAX_FEE_PER_SIGNER=13000
} >> .env
cli deploy -p kupmios --components committee-bridge,committee-bridge-threshold,committee-bridge-scripts
submit deployments/local/deployment-transactions.json
cli bridge-topup -p kupmios --use-build --lovelace 50000000
submit deployments/local/bridge-topup.json

echo "=== Rewards contracts"
epoch=$(call sidechain_getStatus '[]' | jq -r .result.sidechain.epoch)
printf '\n# rewards-deploy: the batcher loads from this Midnight epoch\nREWARDS_FIRST_EPOCH=%s\n' $((epoch + 2)) >> .env
cli deploy -p kupmios --components rewards-pool,rewards-batcher,virtual-account-stake,virtual-account
submit deployments/local/deployment-transactions.json
# One deploy run with both reference-script components spends one wallet input twice.
for component in rewards-batcher-script rewards-scripts; do
  cli deploy -p kupmios --components $component
  submit deployments/local/deployment-transactions.json
done

echo "=== Reserve to reserve_logic_v2"
v2=$(jq -r '.validators[] | select(.title == "reserve_v2.reserve_logic_v2.else") | .hash' plutus-local.json)
read -r tx ix < <(fee_utxo)
cli stage-upgrade -p kupmios --use-build -v reserve --new-logic-hash "$v2" --tx-hash "$tx" --tx-index "$ix"
submit deployments/local/stage-upgrade-tx.json
read -r tx ix < <(fee_utxo)
cli promote-upgrade -p kupmios --use-build -v reserve --tx-hash "$tx" --tx-index "$ix"
submit deployments/local/promote-upgrade-tx.json
register_stake reserve_v2.reserve_logic_v2.else

echo "=== Virtual accounts, one per permissioned candidate"
echo "# rewards-deploy: each operator's sidechain secret and stake key" >> .env
i=0
for secret in $(operator_secrets); do
  i=$((i + 1))
  stake=$(cli generate-key -n local | sed -n 's/^SIGNING_PRIVATE_KEY=//p')
  dust=$(dust_bytes "$secret")
  printf 'SIDECHAIN_KEY_%s=%s\nREWARDS_STAKE_KEY_%s=%s\n' $i "$secret" $i "$stake" >> .env
  cli rewards-register -p kupmios --use-build --stake-key REWARDS_STAKE_KEY_$i --sidechain-key SIDECHAIN_KEY_$i \
    --destinations "00$dust:1000" --payout-threshold 0
  submit deployments/local/rewards-register.json
done
[ "$i" -gt 0 ] || { echo "no sidechain secret matches a permissioned candidate" >&2; exit 1; }

echo "=== pool1's operator account, at its reward key"
pool1_key=$(jq -r '.cborHex[4:]' "$configurations/cardano/keys/reward.skey")
dust=$(dust_bytes "$pool1_key")
printf '# rewards-deploy: pool1 reward key\nPOOL1_REWARD_KEY=%s\n' "$pool1_key" >> .env
cli rewards-register -p kupmios --use-build --stake-key POOL1_REWARD_KEY \
  --destinations "00$dust:1000" --payout-threshold 0
submit deployments/local/rewards-register.json

echo "=== The Lace delegator: funded, delegated to pool1, not registered"
echo "# rewards-deploy: the Lace wallet of LACE_PHRASE" >> .env
printf '%s' "$LACE_PHRASE" | bun "$repo/demo/wallet-keys.ts" 0 | sed 's/^/LACE_/' >> .env
lace_address=$(sed -n 's/^LACE_ADDRESS=//p' .env)
# Two UTxOs: Lace holds one back as collateral.
cli simple-tx -p kupmios --to "$lace_address" --amount 500000000000 --count 2
submit deployments/local/simple-tx.json
delegate_to_pool1
image=$(docker inspect midnight-node-1 --format '{{.Config.Image}}')
lace_dust=$(docker run --rm "${image/midnight-node:/midnight-node-toolkit:}" \
  show-address --network local --seed "$LACE_PHRASE" --dust)

echo "=== Deployed: $i operator accounts, pool1's operator and the Lace delegator"
echo "Lace: restore the recovery phrase below; its wallet holds 1,000,000 ADA in two UTxOs, delegated to pool1"
echo "$LACE_PHRASE"
echo "Register it in Lace with its DUST address: $lace_dust"
echo "Run just private-net-pump"
