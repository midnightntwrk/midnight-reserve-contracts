#!/usr/bin/env bash
# Pay NIGHT from the deployer to the rewards pool as one more pool value UTxO (2 ADA,
# inline datum Constr 0 [], as the release's pool output), for a pay the reserve release
# cannot cover: a delegator's first pay after it registers, or a catch-up after a stall.
# The next load, pay or release merges it. It submits right after a release lands,
# when the pump is not spending the deployer's NIGHT UTxO.
# Usage (repo root, stack deployed): demo/pool-topup.sh <whole NIGHT>
set -euo pipefail
amount=$(( $1 * 1000000 ))
demo=$PWD/.private-net/demo
kupo=http://127.0.0.1:1442
deployer=$(sed -n 's/^DEPLOYER_ADDRESS=//p' "$demo/.env")
night=$(curl -s http://127.0.0.1:3001/rewards/config | jq -r '.night.policyId + "." + .night.assetName')
hash_of() { jq -r --arg t "$1" '.validators[] | select(.title == $t) | .hash' "$demo/plutus-local.json"; }
# An enterprise script address on a testnet: header 0x70, then the script hash.
script_address() {
  HASH=$(hash_of "$1") bun -e 'import { bech32 } from "@scure/base";
    console.log(bech32.encode("addr_test", bech32.toWords(Uint8Array.from([0x70, ...Buffer.from(process.env.HASH, "hex")])), false));'
}
in_node() { docker exec -w "$remote" cardano-node-1 sh -ec "magic=\$(jq .networkMagic /shared/shelley/genesis.json); $1"; }
remote=/tmp/pool-topup-$$

work=$(mktemp -d)
printf '{"type":"PaymentSigningKeyShelley_ed25519","description":"","cborHex":"5820%s"}' \
  "$(sed -n 's/^SIGNING_PRIVATE_KEY=//p' "$demo/.env")" > "$work/deployer.skey"
echo '{"constructor":0,"fields":[]}' > "$work/datum.json"
docker cp "$work" "cardano-node-1:$remote" >/dev/null
rm -rf "$work"
trap 'docker exec cardano-node-1 rm -rf "$remote"' EXIT

pool=$(script_address rewards_pool.rewards_pool_forever.else)
reserve=$(script_address reserve.reserve_forever.else)
# The reserve NFT UTxO: the reserve UTxO that holds more than NIGHT.
release_tx() {
  curl -s "$kupo/matches/$reserve?unspent" |
    jq -r --arg n "$night" '[.[] | select(.value.assets | keys | any(. != $n))][0].transaction_id'
}
before=$(release_tx)
echo "Waiting for the next reserve release…"
until [ "$(release_tx)" != "$before" ]; do sleep 1; done

txid=$(in_node "
  tx=\$(cardano-cli conway query utxo --address $deployer --testnet-magic \$magic --output-json |
    jq -r --arg p ${night%.*} --arg a ${night#*.} 'to_entries[] | select(.value.value[\$p][\$a] != null) | .key' | head -1)
  cardano-cli conway transaction build --testnet-magic \$magic --tx-in \$tx \
    --tx-out '$pool+2000000+$amount $night' --tx-out-inline-datum-file datum.json \
    --change-address $deployer --out-file tx.raw >/dev/null
  cardano-cli conway transaction sign --testnet-magic \$magic --tx-body-file tx.raw \
    --signing-key-file deployer.skey --out-file tx.signed
  cardano-cli conway transaction submit --testnet-magic \$magic --tx-file tx.signed >/dev/null
  cardano-cli conway transaction txid --tx-file tx.signed | jq -r .txhash")
until curl -s "$kupo/matches/*@$txid" | jq -e 'length > 0' >/dev/null; do sleep 1; done
echo "Rewards pool top-up of $1 NIGHT landed: $txid"
