/**
 * The Blockfrost-shaped backend the Lace wallet reads for the local devnet,
 * which Lace takes as its Preprod: it calls
 * `<proxy>/extension/preprod/api/v0/<path>`. The shim strips that prefix and
 * proxies to Blockfrost RYO over the stack's db-sync, except what RYO does
 * not serve: tx/submit and utils/txs/evaluate go to Ogmios
 * (submitTransaction, evaluateTransaction, the v6 result Lace parses), and
 * network/eras comes from Ogmios's era summaries, which follow the devnet's
 * systemStart. Every response carries CORS headers for the extension.
 * Env (own names, since bun loads the repo's .env): LACE_SHIM_PORT (3001),
 * LACE_SHIM_RYO_URL (http://127.0.0.1:3000), LACE_SHIM_OGMIOS_URL
 * (http://127.0.0.1:1337, JSON-RPC over HTTP).
 */
const PORT = Number(process.env.LACE_SHIM_PORT ?? 3001);
const RYO = process.env.LACE_SHIM_RYO_URL ?? "http://127.0.0.1:3000";
const OGMIOS = process.env.LACE_SHIM_OGMIOS_URL ?? "http://127.0.0.1:1337";
const PREFIX = "/extension/preprod/api/v0/";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

interface OgmiosReply<A> {
  readonly result?: A;
  readonly error?: unknown;
}

const ogmios = async <A>(
  method: string,
  params?: unknown,
): Promise<OgmiosReply<A>> =>
  (await (
    await fetch(OGMIOS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 0 }),
    })
  ).json()) as OgmiosReply<A>;

/** The transaction CBOR of a request as hex: tx/submit sends raw bytes, utils/txs/evaluate hex text. */
const cborHex = async (request: Request): Promise<string> => {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const text = new TextDecoder().decode(bytes).trim();
  return /^[0-9a-fA-F]+$/.test(text)
    ? text.toLowerCase()
    : Buffer.from(bytes).toString("hex");
};

const submit = async (request: Request) => {
  const reply = await ogmios<{ transaction: { id: string } }>(
    "submitTransaction",
    { transaction: { cbor: await cborHex(request) } },
  );
  return reply.result === undefined
    ? json(
        {
          status_code: 400,
          error: "Bad Request",
          message: JSON.stringify(reply.error),
        },
        400,
      )
    : json(reply.result.transaction.id);
};

const evaluate = async (request: Request) =>
  json(
    await ogmios("evaluateTransaction", {
      transaction: { cbor: await cborHex(request) },
    }),
  );

interface OgmiosBound {
  readonly time: { readonly seconds: number };
  readonly slot: number;
  readonly epoch: number;
}

interface OgmiosEra {
  readonly start: OgmiosBound;
  readonly end: OgmiosBound;
  readonly parameters: {
    readonly epochLength: number;
    readonly slotLength: { readonly milliseconds: number };
    readonly safeZone: number;
  };
}

const bound = (b: OgmiosBound) => ({
  time: b.time.seconds,
  slot: b.slot,
  epoch: b.epoch,
});

const eras = async () => {
  const { result } = await ogmios<OgmiosEra[]>("queryLedgerState/eraSummaries");
  return json(
    (result ?? []).map((era) => ({
      start: bound(era.start),
      end: bound(era.end),
      parameters: {
        epoch_length: era.parameters.epochLength,
        slot_length: era.parameters.slotLength.milliseconds / 1000,
        safe_zone: era.parameters.safeZone,
      },
    })),
  );
};

const proxy = async (request: Request, path: string, search: string) => {
  const reply = await fetch(`${RYO}/${path}${search}`, {
    method: request.method,
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: request.method === "GET" ? undefined : await request.arrayBuffer(),
  });
  return new Response(reply.body, {
    status: reply.status,
    headers: {
      ...CORS,
      "content-type": reply.headers.get("content-type") ?? "application/json",
    },
  });
};

Bun.serve({
  port: PORT,
  fetch: (request) => {
    const url = new URL(request.url);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });
    if (!url.pathname.startsWith(PREFIX))
      return json({ status_code: 404, error: "Not Found" }, 404);
    const path = url.pathname.slice(PREFIX.length);
    if (path === "tx/submit") return submit(request);
    if (path === "utils/txs/evaluate") return evaluate(request);
    if (path === "network/eras") return eras();
    return proxy(request, path, url.search);
  },
});

console.log(`Lace backend shim on http://localhost:${PORT}${PREFIX}`);
