/**
 * A read-only transaction viewer for the rewards demo's Cardano devnet: the
 * Lace wallet's and its virtual account's recent transactions, and any
 * transaction by hash, read from Blockfrost RYO. Address and script labels
 * come from the deployed blueprint and three .env addresses; no key leaves
 * the .env. GET only, on 127.0.0.1.
 * Usage (repo root): bun demo/explorer/server.ts
 */
import { bech32 } from "@scure/base";

const RYO = "http://127.0.0.1:3000";
const SHIM = "http://127.0.0.1:3001";
const PORT = 3002;
const demo = `${import.meta.dir}/../../.private-net/demo`;

const env = new Map(
  (await Bun.file(`${demo}/.env`).text())
    .split("\n")
    .map((line) =>
      /^(LACE_ADDRESS|LACE_STAKE_KEY_HASH|DEPLOYER_ADDRESS)=(\S+)$/.exec(line),
    )
    .filter((m) => m !== null)
    .map((m) => [m[1], m[2]] as const),
);
const blueprint = (await Bun.file(`${demo}/plutus-local.json`).json()) as {
  validators: { title: string; hash: string }[];
};
const config = (await (await fetch(`${SHIM}/rewards/config`)).json()) as {
  night: { policyId: string; assetName: string };
};

const LABELS: Record<string, string> = {
  "virtual_account.virtual_account.else": "Virtual account",
  "rewards_pool.rewards_pool_forever.else": "Rewards pool",
  "rewards_batcher.rewards_batcher.else": "Batcher state",
  "illiquid_circulation_supply.ics_forever.else": "ICS (treasury)",
  "reserve.reserve_forever.else": "Reserve",
  "committee_bridge_pool.committee_bridge_pool.spend": "Bridge pool",
};
const hashOf = (title: string) => {
  const found = blueprint.validators.find((v) => v.title === title);
  if (!found) throw new Error(`${title} is not in the deployed blueprint`);
  return found.hash;
};
// An enterprise script address on a testnet: header 0x70, then the script hash.
const scriptAddress = (hash: string) =>
  bech32.encode(
    "addr_test",
    bech32.toWords(Uint8Array.from([0x70, ...Buffer.from(hash, "hex")])),
    false,
  );

const meta = {
  lace: env.get("LACE_ADDRESS"),
  laceOwner: env.get("LACE_STAKE_KEY_HASH"),
  accountPolicy: hashOf("virtual_account.virtual_account.else"),
  night: config.night.policyId + config.night.assetName,
  addresses: {
    [env.get("LACE_ADDRESS") ?? ""]: "Lace wallet",
    [env.get("DEPLOYER_ADDRESS") ?? ""]: "Deployer (pump)",
    ...Object.fromEntries(
      Object.entries(LABELS).map(([title, label]) => [
        scriptAddress(hashOf(title)),
        label,
      ]),
    ),
  },
  // A script's purposes share its hash; the labelled title wins.
  scripts: Object.fromEntries(
    blueprint.validators
      .toSorted((a, b) => Number(a.title in LABELS) - Number(b.title in LABELS))
      .map((v) => [
        v.hash,
        LABELS[v.title] ?? v.title.split(".").slice(0, 2).join("."),
      ]),
  ),
};

const ROUTES = [
  /^blocks\/latest$/,
  /^txs\/[0-9a-f]{64}(\/(utxos|redeemers|withdrawals))?$/,
  /^addresses\/addr_test1[0-9a-z]+\/transactions$/,
  /^assets\/[0-9a-f]{56,120}\/transactions$/,
];
const PARAMS = ["order", "count", "page"];
const page = Bun.file(`${import.meta.dir}/index.html`);

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET")
      return new Response("read-only", { status: 405 });
    if (url.pathname === "/") return new Response(page);
    if (url.pathname === "/meta") return Response.json(meta);
    const path = url.pathname.replace(/^\/api\//, "");
    if (!url.pathname.startsWith("/api/") || !ROUTES.some((r) => r.test(path)))
      return new Response("not found", { status: 404 });
    const query = new URLSearchParams(
      [...url.searchParams].filter(([k]) => PARAMS.includes(k)),
    );
    const reply = await fetch(`${RYO}/${path}?${query}`);
    return new Response(reply.body, {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  },
});
console.log(`Devnet transactions: http://127.0.0.1:${PORT}`);
