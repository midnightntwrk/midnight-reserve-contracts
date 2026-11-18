/**
 * An independent reference of rules 1 to 10 of the NIGHT staking MIP (midnight-improvement-proposals
 * PR #421, head ab25a20d) and the user's decisions on it, written from that text alone, to check
 * the Aiken contracts night_staking and night_registration against. Each check takes a transaction
 * as the scripts see it and returns accept, or reject with every rule the transaction breaks. Bytes
 * are lowercase hex, amounts and POSIX times in milliseconds are decimal strings.
 */

export type Hex = string;
export type Credential = { VerificationKey: Hex } | { Script: Hex };
export type Address = { payment: Credential; stake: Credential | null };
export type Asset = { policy: Hex; name: Hex; quantity: string };
export type Value = { lovelace: string; assets: Asset[] };
export type OutRef = { tx: Hex; index: number };
/** `datum` is the inline datum, or null when the output has none of the contract's type. */
export type Output<D> = { address: Address; value: Value; datum: D | null };
export type Input<D> = { ref: OutRef; output: Output<D> };
/** `pool` null is a vote-only delegation. */
export type Certificate =
  | { kind: "register" | "unregister"; credential: Credential }
  | {
      kind: "delegate" | "register_and_delegate";
      credential: Credential;
      pool: Hex | null;
    };
export type Tx<D> = {
  inputs: Input<D>[];
  /** Read, not spent. night_staking reads a registration node here (user decision 11-14). */
  reference_inputs: Input<Node>[];
  outputs: Output<D>[];
  mint: Asset[];
  withdrawals: { credential: Credential; amount: string }[];
  certificates: Certificate[];
  /** The credential of each voter; a script voter runs that script's vote purpose. */
  voters: Credential[];
  /** The guardrail script hash of each proposal that names one; it runs that script's propose purpose. */
  guardrails: Hex[];
  extra_signatories: Hex[];
  /** The validity interval as POSIX milliseconds; null is an open bound. */
  validity: { lower: string | null; upper: string | null };
};
/** An open map entry: a name and a Plutus Data value the contracts never read. */
export type Pairs<V> = [Hex, V][];

export type DelegationLock = {
  owner: Credential;
  pool_id: Hex;
  reward_address: Hex;
  /** The Cardano address that receives the cNIGHT at an Unlock (MIP #421, rule 4). */
  return_address: Address;
  unbond_at: string | null;
  attributes: Pairs<unknown>;
};

/** The last node of both lists; its links name the last node of each, "" while that list is empty. */
export type Tail = { prev_crch: Hex; prev_pool: Hex };
export type Reserved = { crch: Hex; prev_crch: Hex };
/**
 * Field order (MIP #421 ab25a20d): the fields a node keeps, then those a Deactivate clears. Each
 * link names the node before, the next smaller key; "" on the first node of a list, and
 * `prev_pool` is "" on an inactive node.
 */
export type Registration = {
  active: boolean;
  crch: Hex;
  prev_crch: Hex;
  pool_id: Hex;
  prev_pool: Hex;
  owner: Credential;
  crch_signature: Hex;
  keys: Pairs<Hex>;
  signatures: Pairs<Hex>;
  reward_address: Hex;
  fixed_cost: string;
  attributes: Pairs<unknown>;
};
export type Node =
  | { Tail: Tail }
  | { Reserved: Reserved }
  | { Registration: Registration };

export type StakingConstants = {
  script_hash: Hex;
  cnight_policy: Hex;
  cnight_name: Hex;
  /** The floor of ADA in a lock: 2,000,000 lovelace, decided by the user 2026-11-13. */
  lock_deposit_lovelace: string;
  /** night_registration's script hash, compiled into night_staking (user decision 11-14). */
  registration_script_hash: Hex;
  unbonding_delay_ms: string;
};
export type RegistrationConstants = {
  script_hash: Hex;
  init_utxo: OutRef;
  /** The most bytes a node's datum holds with both links "" (MIP #421 ab25a20d, rule 9). */
  node_datum_max: string;
};
export type Result =
  | { result: "accept" }
  | { result: "reject"; rules: number[] };

const bytes = (hex: Hex) => hex.length / 2;
/** Equal as data: object keys in any order. */
const same = (a: unknown, b: unknown) => {
  const canonical = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(canonical)
      : x !== null && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x)
              .sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))
              .map(([key, value]) => [key, canonical(value)]),
          )
        : x;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
};
const hashOf = (c: Credential) =>
  "VerificationKey" in c ? c.VerificationKey : c.Script;
/** Exactly one asset, with the empty name and the given quantity. */
const single = (assets: Asset[], quantity: bigint) =>
  assets.length === 1 &&
  assets[0].name === "" &&
  BigInt(assets[0].quantity) === quantity;
/** Rule 5: a key credential by its hash in extra_signatories, a script credential by a withdrawal from it. */
const authorizes = (tx: Tx<unknown>, owner: Credential) =>
  "VerificationKey" in owner
    ? tx.extra_signatories.includes(owner.VerificationKey)
    : tx.withdrawals.some((w) => same(w.credential, owner));
const verdict = (failed: Set<number>): Result =>
  failed.size === 0
    ? { result: "accept" }
    : { result: "reject", rules: [...failed].sort((a, b) => a - b) };

/** The night_staking withdrawal redeemer: the action, which accepts exactly one transaction shape. */
export type StakingRedeemer = "Lock" | "Update" | "Unbond" | "Unlock";

/**
 * night_staking, rules 1 to 8. A transaction is at the address when the payment credential is the
 * script, whatever its stake part. The withdrawal redeemer names the action, Lock, Update, Unbond or
 * Unlock, and each accepts one transaction shape (user decision 11-17; it replaces the MIP's reading
 * of the kind from the shape, rule 7). `redeemer` is null when the transaction has no withdrawal
 * from the script.
 */
export function checkStaking(
  tx: Tx<DelegationLock>,
  redeemer: StakingRedeemer | null,
  k: StakingConstants,
): Result {
  const failed = new Set<number>();
  const self: Credential = { Script: k.script_hash };
  const atAddress = (o: Output<DelegationLock>) =>
    same(o.address.payment, self);
  const tokens = (assets: Asset[]) =>
    assets.filter((a) => a.policy === k.script_hash);
  const cnight = (v: Value) =>
    v.assets
      .filter((a) => a.policy === k.cnight_policy && a.name === k.cnight_name)
      .reduce((sum, a) => sum + BigInt(a.quantity), 0n);
  const ins = tx.inputs.map((i) => i.output).filter(atAddress);
  const outs = tx.outputs.filter(atAddress);
  const mint = tokens(tx.mint);
  const gate = tx.withdrawals.some((w) => same(w.credential, self));
  // Lock and Update name a pool whose active registration node is a reference input: a UTxO at the
  // night_registration address that holds the set's token and nothing but ADA besides (user
  // decisions 11-14 and 11-17). Rule 2 checks it for a Lock and rule 3 for an Update; Unbond and
  // Unlock need no reference.
  const registered = (pool_id: Hex) =>
    tx.reference_inputs.some(
      ({ output: o }) =>
        same(o.address.payment, { Script: k.registration_script_hash }) &&
        single(o.value.assets, 1n) &&
        o.value.assets[0].policy === k.registration_script_hash &&
        o.datum !== null &&
        "Registration" in o.datum &&
        o.datum.Registration.active &&
        o.datum.Registration.pool_id === pool_id,
    );
  /**
   * A lock's value is exactly ADA, one lock token with the empty name, and cNIGHT if any (user
   * decision 11-17: exact shape).
   */
  const lockValue = (v: Value) =>
    single(tokens(v.assets), 1n) &&
    v.assets.every(
      (a) =>
        (a.policy === k.script_hash && a.name === "") ||
        (a.policy === k.cnight_policy && a.name === k.cnight_name),
    );

  // Rule 8, the publish purpose: a registration of the script's credential and nothing else.
  if (
    tx.certificates.some(
      (c) => same(c.credential, self) && c.kind !== "register",
    )
  )
    failed.add(8);
  // Rule 8: the vote and propose purposes always fail.
  if (
    tx.voters.some((v) => same(v, self)) ||
    tx.guardrails.includes(k.script_hash)
  )
    failed.add(8);
  // Rule 6, the spending and minting purposes.
  if ((ins.length > 0 || mint.length > 0) && !gate) failed.add(6);
  if (!gate) return verdict(failed);

  // Rule 7, the withdrawal purpose: one lock event, the token only at the address, every input at
  // the address a lock of exactly ADA, one token and cNIGHT (user decisions 11-14 and 11-17), and
  // the one shape of the redeemer (user decision 11-17).
  const shape = {
    Lock: ins.length === 0 && outs.length === 1 && mint.length > 0,
    Update: ins.length === 1 && outs.length === 1 && mint.length === 0,
    Unbond: ins.length === 1 && outs.length === 1 && mint.length === 0,
    Unlock: ins.length === 1 && outs.length === 0 && mint.length > 0,
  };
  if (
    redeemer === null ||
    !shape[redeemer] ||
    ins.some((o) => !lockValue(o.value)) ||
    tx.outputs.some((o) => !atAddress(o) && tokens(o.value.assets).length > 0)
  ) {
    failed.add(7);
    return verdict(failed);
  }
  const [input] = ins;
  const [output] = outs;

  /** Rule 2, Output; rule 3 lets `unbond_at` be Some. `attributes` is not checked (user decision 2026-11-13). */
  const lockOk = (o: Output<DelegationLock>, unbond: boolean) => {
    const d = o.datum;
    return (
      d !== null &&
      o.address.stake === null &&
      bytes(hashOf(d.owner)) === 28 &&
      !same(d.owner, self) &&
      bytes(d.pool_id) === 28 &&
      bytes(d.reward_address) === 32 &&
      bytes(hashOf(d.return_address.payment)) === 28 &&
      !same(d.return_address.payment, self) &&
      (unbond || d.unbond_at === null) &&
      lockValue(o.value) &&
      BigInt(o.value.lovelace) >= BigInt(k.lock_deposit_lovelace)
    );
  };

  if (redeemer === "Lock") {
    // Lock (the MIP's Create, renamed by the user 2026-11-13). The lock is outputs[0] (user
    // decision 11-17).
    if (!single(mint, 1n)) failed.add(1);
    if (
      tx.outputs[0] !== output ||
      !lockOk(output, false) ||
      output.datum === null ||
      !registered(output.datum.pool_id)
    )
      failed.add(2);
    if (output.datum !== null && !authorizes(tx, output.datum.owner))
      failed.add(5);
  } else if (redeemer === "Update") {
    // Rule 3: an Update keeps unbond_at None, may change pool_id, reward_address and attributes, and
    // return_address only under its own payment credential; it needs the pool's node as a
    // reference input only when pool_id changes; the lock is outputs[0]. A lock whose unbond_at is
    // Some can only be unlocked.
    const before = input.datum;
    const after = output.datum;
    if (
      tx.outputs[0] !== output ||
      !lockOk(output, false) ||
      before === null ||
      after === null ||
      before.unbond_at !== null ||
      !same(before.owner, after.owner) ||
      cnight(output.value) < cnight(input.value) ||
      (!same(before.pool_id, after.pool_id) && !registered(after.pool_id)) ||
      (!same(before.return_address, after.return_address) &&
        !authorizes(tx, before.return_address.payment))
    )
      failed.add(3);
    if (before === null || !authorizes(tx, before.owner)) failed.add(5);
  } else if (redeemer === "Unbond") {
    // Rule 3: an Unbond sets unbond_at from None to exactly the validity upper bound and changes
    // nothing else but its ADA, which may rise to the new min-UTxO and never falls; the lock is
    // outputs[0].
    const before = input.datum;
    const after = output.datum;
    const upper = tx.validity.upper;
    /** A value's assets as the ledger sees them: summed per policy and name, zeros dropped, sorted. */
    const assets = (v: Value) => {
      const sums = new Map<string, bigint>();
      for (const a of v.assets) {
        const key = `${a.policy}.${a.name}`;
        sums.set(key, (sums.get(key) ?? 0n) + BigInt(a.quantity));
      }
      return [...sums]
        .filter(([, q]) => q !== 0n)
        .map(([key, q]) => `${key}:${q}`)
        .sort()
        .join();
    };
    if (
      tx.outputs[0] !== output ||
      !lockOk(output, true) ||
      before === null ||
      after === null ||
      before.unbond_at !== null ||
      after.unbond_at === null ||
      upper === null ||
      BigInt(after.unbond_at) !== BigInt(upper) ||
      // The token and the cNIGHT stay the same; the ADA may only rise.
      BigInt(output.value.lovelace) < BigInt(input.value.lovelace) ||
      assets(output.value) !== assets(input.value) ||
      !same(before.owner, after.owner) ||
      !same(before.pool_id, after.pool_id) ||
      !same(before.reward_address, after.reward_address) ||
      !same(before.return_address, after.return_address) ||
      !same(before.attributes, after.attributes)
    )
      failed.add(3);
    if (before === null || !authorizes(tx, before.owner)) failed.add(5);
  } else {
    // Unlock (the MIP's Remove, renamed by the user 2026-11-13): rule 4, Burn.
    const lock = input.datum;
    const lower = tx.validity.lower;
    if (!single(mint, -1n)) failed.add(4);
    if (
      cnight(input.value) > 0n &&
      (lock === null ||
        lock.unbond_at === null ||
        lower === null ||
        BigInt(lock.unbond_at) > BigInt(lower) - BigInt(k.unbonding_delay_ms))
    )
      failed.add(4);
    // The cNIGHT goes to the input datum's return_address (MIP #421, rule 4) in outputs[0], which
    // holds nothing but ADA and cNIGHT (user decision 11-17).
    const payout = tx.outputs[0];
    if (
      cnight(input.value) > 0n &&
      (lock === null ||
        payout === undefined ||
        !same(payout.address, lock.return_address) ||
        !payout.value.assets.every(
          (a) => a.policy === k.cnight_policy && a.name === k.cnight_name,
        ) ||
        cnight(payout.value) < cnight(input.value))
    )
      failed.add(4);
    if (lock === null || !authorizes(tx, lock.owner)) failed.add(5);
  }
  return verdict(failed);
}

/** Plutus data, as `serialise_data` encodes it. */
type PlutusData =
  | { int: bigint }
  | { bytes: Hex }
  | { list: PlutusData[] }
  | { map: [PlutusData, PlutusData][] }
  | { constr: number; fields: PlutusData[] };

/**
 * The Plutus CBOR encoding of `serialise_data`: minimal heads; integers outside 64 bits as
 * bignum tags; byte strings over 64 bytes as indefinite 64-byte chunks; a non-empty list or
 * constructor field list indefinite, an empty one definite; maps definite; constructors 0 to 6 as
 * tags 121 to 127, 7 to 127 as tags 1280 onward, any other as tag 102.
 */
const cbor = (d: PlutusData): Hex => {
  const head = (major: number, n: bigint) => {
    const initial = (extra: number) =>
      (major * 32 + extra).toString(16).padStart(2, "0");
    const width =
      n < 24n
        ? 0
        : n < 0x100n
          ? 1
          : n < 0x10000n
            ? 2
            : n < 0x100000000n
              ? 4
              : 8;
    return width === 0
      ? initial(Number(n))
      : initial({ 1: 24, 2: 25, 4: 26, 8: 27 }[width]!) +
          n.toString(16).padStart(width * 2, "0");
  };
  const bytestring = (h: Hex): Hex =>
    h.length <= 128
      ? head(2, BigInt(h.length / 2)) + h
      : "5f" +
        (h.match(/.{1,128}/g) ?? [])
          .map((c) => head(2, BigInt(c.length / 2)) + c)
          .join("") +
        "ff";
  const items = (xs: PlutusData[]) =>
    xs.length === 0 ? "80" : "9f" + xs.map(cbor).join("") + "ff";
  if ("int" in d) {
    const n = d.int;
    if (n >= 0n && n < 2n ** 64n) return head(0, n);
    if (n < 0n && n >= -(2n ** 64n)) return head(1, -1n - n);
    const magnitude = (n >= 0n ? n : -1n - n).toString(16);
    return (
      head(6, n >= 0n ? 2n : 3n) +
      bytestring(magnitude.length % 2 === 0 ? magnitude : "0" + magnitude)
    );
  }
  if ("bytes" in d) return bytestring(d.bytes);
  if ("list" in d) return items(d.list);
  if ("map" in d)
    return (
      head(5, BigInt(d.map.length)) +
      d.map.map(([key, value]) => cbor(key) + cbor(value)).join("")
    );
  return d.constr <= 6
    ? head(6, BigInt(121 + d.constr)) + items(d.fields)
    : d.constr <= 127
      ? head(6, BigInt(1280 + d.constr - 7)) + items(d.fields)
      : head(6, 102n) + "82" + head(0, BigInt(d.constr)) + items(d.fields);
};

/** An attribute value, in the detailed JSON schema the vectors write. */
const detailed = (x: unknown): PlutusData => {
  const d = x as Record<string, unknown>;
  return "int" in d
    ? { int: BigInt(d.int as string) }
    : "bytes" in d
      ? { bytes: d.bytes as Hex }
      : "list" in d
        ? { list: (d.list as unknown[]).map(detailed) }
        : "map" in d
          ? {
              map: (d.map as { k: unknown; v: unknown }[]).map(
                (e): [PlutusData, PlutusData] => [detailed(e.k), detailed(e.v)],
              ),
            }
          : {
              constr: Number(d.constructor),
              fields: (d.fields as unknown[]).map(detailed),
            };
};

/**
 * Rule 9: the bytes of a node's datum with both links "", as `serialise_data` encodes the Node
 * type: Tail 0, Reserved 1, Registration 2 with its fields in order; False 0 and True 1;
 * VerificationKey 0 and Script 1.
 */
const unlinkedSize = (n: Node) => {
  const b = (bytes: Hex): PlutusData => ({ bytes });
  const map = (entries: Pairs<unknown>): PlutusData => ({
    map: entries.map(([name, value]): [PlutusData, PlutusData] => [
      b(name),
      typeof value === "string" ? b(value) : detailed(value),
    ]),
  });
  const data: PlutusData =
    "Tail" in n
      ? { constr: 0, fields: [b(""), b("")] }
      : "Reserved" in n
        ? { constr: 1, fields: [b(n.Reserved.crch), b("")] }
        : {
            constr: 2,
            fields: [
              { constr: n.Registration.active ? 1 : 0, fields: [] },
              b(n.Registration.crch),
              b(""),
              b(n.Registration.pool_id),
              b(""),
              {
                constr: "VerificationKey" in n.Registration.owner ? 0 : 1,
                fields: [b(hashOf(n.Registration.owner))],
              },
              b(n.Registration.crch_signature),
              map(n.Registration.keys),
              map(n.Registration.signatures),
              b(n.Registration.reward_address),
              { int: BigInt(n.Registration.fixed_cost) },
              map(n.Registration.attributes),
            ],
          };
  return BigInt(cbor(data).length / 2);
};

/**
 * The key order of the crch list: by length, then by bytes, so "" is the smallest key (user
 * decision 11-18; the MIP says bytes). The pool list orders its 28-byte keys by bytes.
 */
const crchBelow = (a: Hex, b: Hex) =>
  a.length < b.length || (a.length === b.length && a < b);
const poolBelow = (a: Hex, b: Hex) => a < b;

/** A link of one list: from the key before (the link) to a node's key, null for the Tail. */
type Edge = [Hex, Hex | null];

const crchEdges = (nodes: Node[]) =>
  nodes.map((n): Edge =>
    "Tail" in n
      ? [n.Tail.prev_crch, null]
      : "Reserved" in n
        ? [n.Reserved.prev_crch, n.Reserved.crch]
        : [n.Registration.prev_crch, n.Registration.crch],
  );
const poolEdges = (nodes: Node[]) =>
  nodes.flatMap((n): Edge[] =>
    "Tail" in n
      ? [[n.Tail.prev_pool, null]]
      : "Registration" in n && n.Registration.active
        ? [[n.Registration.prev_pool, n.Registration.pool_id]]
        : [],
  );

/**
 * Rule 9: the links a transaction writes keep the list whole. The nodes it spends are pieces of a
 * sorted list whose other nodes it cannot see, so the links after must be sorted, give each key at
 * most one link in and one out, and start and end where the links before did.
 */
const intact = (
  below: (a: Hex, b: Hex) => boolean,
  before: Edge[],
  after: Edge[],
) => {
  const links = (es: Edge[]) => es.map(([link]) => link);
  const keys = (es: Edge[]) => es.map(([, key]) => key ?? "tail");
  const unique = (xs: string[]) => new Set(xs).size === xs.length;
  const outside = (xs: string[], ys: string[]) =>
    xs
      .filter((x) => !ys.includes(x))
      .sort()
      .join();
  return (
    unique(links(after)) &&
    unique(keys(after)) &&
    after.every(([link, key]) => key === null || below(link, key)) &&
    outside(links(before), keys(before)) ===
      outside(links(after), keys(after)) &&
    outside(keys(before), links(before)) === outside(keys(after), links(after))
  );
};

const id = (n: Node) =>
  "Tail" in n
    ? "tail"
    : "Reserved" in n
      ? n.Reserved.crch
      : n.Registration.crch;
/** A node's kind and fields, with `fixed_cost` as a number so "0" and "00" compare equal. */
const fields = (n: Node): [string, Record<string, unknown>] =>
  "Tail" in n
    ? ["Tail", n.Tail]
    : "Reserved" in n
      ? ["Reserved", n.Reserved]
      : [
          "Registration",
          {
            ...n.Registration,
            fixed_cost: BigInt(n.Registration.fixed_cost).toString(),
          },
        ];
/** The same kind of node with the same fields, except those named. */
const sameExcept = (a: Node, b: Node, free: string[]) => {
  const [kindA, fa] = fields(a);
  const [kindB, fb] = fields(b);
  return (
    kindA === kindB &&
    Object.keys({ ...fa, ...fb }).every(
      (f) => free.includes(f) || same(fa[f], fb[f]),
    )
  );
};

/**
 * The night_registration redeemer: the action, which accepts exactly one transaction shape. A
 * Create is CreateTwoAnchors when it spends two anchors, one per list, and CreateOneAnchor when one
 * anchor serves both lists (user decision 11-17).
 */
export type RegistrationRedeemer =
  | "Init"
  | "CreateTwoAnchors"
  | "CreateOneAnchor"
  | "Update"
  | "Deactivate";

/**
 * night_registration, rules 9 and 10, in the withdrawal pattern (MIP #421 ab25a20d, rule 10): every
 * registration transaction withdraws from Script(night_registration), and that withdrawal's
 * redeemer names the action, each with one transaction shape. The spend and the mint only check the
 * withdrawal; the publish purpose accepts only the plain registration of the credential.
 * `redeemer` is null when the transaction has no withdrawal from the script. Gate and certificate
 * failures are rule 10, which names them.
 */
export function checkRegistration(
  tx: Tx<Node>,
  redeemer: RegistrationRedeemer | null,
  k: RegistrationConstants,
): Result {
  const failed = new Set<number>();
  const atAddress = (o: Output<Node>) =>
    same(o.address.payment, { Script: k.script_hash });
  const hasToken = (v: Value) =>
    v.assets.some((a) => a.policy === k.script_hash);
  const spentOutputs = tx.inputs
    .map((i) => i.output)
    .filter((o) => atAddress(o) && hasToken(o.value));
  const spent = spentOutputs.flatMap((o) =>
    o.datum === null ? [] : [o.datum],
  );
  const created = tx.outputs.filter((o) => hasToken(o.value));
  const nodes = created.flatMap((o) => (o.datum === null ? [] : [o.datum]));
  const mint = tx.mint.filter((a) => a.policy === k.script_hash);
  const self: Credential = { Script: k.script_hash };
  const gate = tx.withdrawals.some((w) => same(w.credential, self));
  // The publish purpose: a registration of the script's credential and nothing else; the vote and
  // propose purposes always fail (as night_staking rule 8).
  if (
    tx.certificates.some(
      (c) => same(c.credential, self) && c.kind !== "register",
    ) ||
    tx.voters.some((v) => same(v, self)) ||
    tx.guardrails.includes(k.script_hash)
  )
    failed.add(10);
  // The spending and minting purposes check only the withdrawal (as night_staking rule 6).
  if ((tx.inputs.some((i) => atAddress(i.output)) || mint.length > 0) && !gate)
    failed.add(10);
  if (!gate || redeemer === null) return verdict(failed);

  // Rule 9: a UTxO at the address is spendable only if it holds the set's token (exactly one, empty
  // name) and nothing but ADA besides (user decisions 11-16 and 11-17).
  if (
    tx.inputs.some(
      (i) =>
        atAddress(i.output) &&
        !(
          single(i.output.value.assets, 1n) &&
          i.output.value.assets[0].policy === k.script_hash
        ),
    )
  ) {
    failed.add(9);
    return verdict(failed);
  }

  // Rule 9: a node is at the address with ADA, one token with the empty name, an inline Node datum
  // and nothing else, and an active Registration's fixed fields hold their lengths and range. No
  // length is checked for crch or crch_signature, and nothing inside keys, signatures or
  // attributes: Midnight validates them.
  if (
    created.some(
      (o) =>
        !atAddress(o) ||
        o.address.stake !== null ||
        o.datum === null ||
        !single(o.value.assets, 1n),
    )
  )
    failed.add(9);
  // Rule 9: each redeemer's shape has nothing at the address but its nodes, so an output there
  // without the token fails (user decision 11-17).
  if (tx.outputs.some((o) => atAddress(o) && !hasToken(o.value))) failed.add(9);
  for (const n of nodes) {
    // Rule 9: a node's datum with both links "" holds at most NODE_DATUM_MAX bytes.
    if (unlinkedSize(n) > BigInt(k.node_datum_max)) failed.add(9);
    if (!("Registration" in n)) continue;
    const r = n.Registration;
    if (
      r.active &&
      (bytes(r.pool_id) !== 28 ||
        bytes(hashOf(r.owner)) !== 28 ||
        bytes(r.reward_address) !== 32 ||
        BigInt(r.fixed_cost) < 0n ||
        BigInt(r.fixed_cost) > 2n ** 128n - 1n)
    )
      failed.add(9);
  }
  // Rule 9: no node is removed and both lists stay whole.
  if (!spent.every((s) => nodes.some((n) => id(n) === id(s)))) failed.add(9);
  const empty: Edge[] = [["", null]];
  if (
    !intact(
      crchBelow,
      redeemer === "Init" ? empty : crchEdges(spent),
      crchEdges(nodes),
    ) ||
    !intact(
      poolBelow,
      redeemer === "Init" ? empty : poolEdges(spent),
      poolEdges(nodes),
    )
  )
    failed.add(9);
  /** Rule 10: a spent node comes back with no less ADA. */
  const keepsAda = (s: Output<Node>) => {
    const after = created.find(
      (o) =>
        o.datum !== null && s.datum !== null && id(o.datum) === id(s.datum),
    );
    return (
      after === undefined ||
      BigInt(after.value.lovelace) >= BigInt(s.value.lovelace)
    );
  };

  if (redeemer === "Init") {
    // Rule 9: the initialization spends the initialization UTxO and its first outputs are the
    // Reserved nodes in ascending crch order and then the Tail, minting one token each, and nothing
    // else. Which crch the Reserved nodes hold is left to whoever builds the transaction; the
    // script's one parameter is its initialization UTxO, so it checks only order and node shape.
    const tail = nodes[nodes.length - 1];
    const reserved = nodes.slice(0, -1);
    if (
      !tx.inputs.some(
        (i) => i.ref.tx === k.init_utxo.tx && i.ref.index === k.init_utxo.index,
      ) ||
      spent.length > 0 ||
      nodes.length !== created.length ||
      tx.outputs.slice(0, created.length).some((o) => !hasToken(o.value)) ||
      tail === undefined ||
      !("Tail" in tail) ||
      !reserved.every(
        (n, i) =>
          "Reserved" in n && (i === 0 || crchBelow(id(reserved[i - 1]), id(n))),
      ) ||
      !single(mint, BigInt(created.length))
    )
      failed.add(9);
    return verdict(failed);
  }
  const fresh = nodes.filter((n) => !spent.some((s) => id(s) === id(n)));
  // Rule 9: nothing but the initialization creates the Tail or a Reserved node.
  if (fresh.some((n) => !("Registration" in n))) failed.add(9);
  const cold = (pool_id: Hex) => tx.extra_signatories.includes(pool_id);

  if (redeemer === "CreateTwoAnchors" || redeemer === "CreateOneAnchor") {
    // Create: one new active Registration under the cold key, with a delegation to its pool; the
    // anchors change only their links, an inactive one or a Reserved node only its crch link, and
    // keep their ADA.
    const twoAnchors = redeemer === "CreateTwoAnchors";
    const [n] = fresh;
    if (!single(mint, 1n) || fresh.length !== 1) failed.add(10);
    if (
      n !== undefined &&
      "Registration" in n &&
      (!n.Registration.active ||
        !cold(n.Registration.pool_id) ||
        !tx.certificates.some(
          (c) =>
            (c.kind === "delegate" || c.kind === "register_and_delegate") &&
            c.pool === n.Registration.pool_id,
        ))
    )
      failed.add(10);
    if (
      !spentOutputs.every(keepsAda) ||
      !spent.every((s) => {
        const after = nodes.find((m) => id(m) === id(s));
        return (
          after === undefined ||
          sameExcept(
            s,
            after,
            "Tail" in s || ("Registration" in s && s.Registration.active)
              ? ["prev_crch", "prev_pool"]
              : ["prev_crch"],
          )
        );
      })
    )
      failed.add(10);
    // Rule 10: the transaction's first outputs are the new node, its crch anchor (the node after it
    // in the crch list) with prev_crch now the new crch, then, for CreateTwoAnchors, its pool anchor
    // with prev_pool now the new pool_id; for CreateOneAnchor the one anchor carries both links.
    // The spent anchors may come in any order.
    const [first, crchAnchor, poolAnchor, ...rest] = nodes;
    const poolKey =
      n !== undefined && "Registration" in n ? n.Registration.pool_id : null;
    if (
      n === undefined ||
      first !== n ||
      spent.length !== (twoAnchors ? 2 : 1) ||
      (poolAnchor !== undefined) !== twoAnchors ||
      tx.outputs.slice(0, created.length).some((o) => !hasToken(o.value)) ||
      crchAnchor === undefined ||
      crchEdges([crchAnchor])[0][0] !== id(n) ||
      rest.length > 0 ||
      (poolKey === null
        ? poolAnchor !== undefined
        : !poolEdges([poolAnchor ?? crchAnchor]).some(
            ([link]) => link === poolKey,
          ))
    )
      failed.add(10);
  } else if (redeemer === "Update") {
    // Update: one active node keeps its crch, crch_signature, pool_id and links; the owner or the
    // cold key signs, and the cold key alone changes the owner. It spends one node, mints nothing,
    // the updated node is the transaction's first output, and its ADA may rise, never fall.
    const [s] = spent;
    const [after] = nodes;
    if (
      spent.length !== 1 ||
      mint.length > 0 ||
      nodes.length !== 1 ||
      tx.outputs[0] !== created[0] ||
      !spentOutputs.every(keepsAda) ||
      !("Registration" in s) ||
      !s.Registration.active ||
      !("Registration" in after) ||
      !after.Registration.active ||
      !sameExcept(s, after, [
        "owner",
        "keys",
        "signatures",
        "reward_address",
        "fixed_cost",
        "attributes",
      ])
    )
      failed.add(10);
    if (s !== undefined && "Registration" in s) {
      const owner = s.Registration.owner;
      const ownerChanged =
        after !== undefined &&
        "Registration" in after &&
        !same(after.Registration.owner, owner);
      if (
        !cold(s.Registration.pool_id) &&
        (ownerChanged || !authorizes(tx, owner))
      )
        failed.add(10);
    }
  } else {
    // Deactivate, under the cold key: the target leaves the pool list for good and keeps only its
    // crch and crch link; its pool anchor, the node after it in the pool list, takes the target's
    // old prev_pool, changes nothing else and keeps its ADA. It spends those two nodes and mints
    // nothing; the transaction's first outputs are the deactivated node, then the pool anchor; the
    // inputs may come in any order.
    const target = spent.find(
      (s) =>
        "Registration" in s &&
        s.Registration.active &&
        spent.some(
          (p) =>
            p !== s &&
            poolEdges([p]).some(([link]) => link === s.Registration.pool_id),
        ),
    );
    const before = spent.find((s) => s !== target);
    const beforeOutput = spentOutputs.find((o) => o.datum === before);
    const targetAfter = nodes.find((n) => target && id(n) === id(target));
    const beforeAfter = nodes.find((n) => before && id(n) === id(before));
    if (
      spent.length !== 2 ||
      mint.length > 0 ||
      target === undefined ||
      !("Registration" in target) ||
      before === undefined ||
      targetAfter === undefined ||
      beforeAfter === undefined ||
      nodes.length !== 2 ||
      tx.outputs.slice(0, created.length).some((o) => !hasToken(o.value)) ||
      beforeOutput === undefined ||
      !keepsAda(beforeOutput) ||
      nodes[0] !== targetAfter ||
      nodes[1] !== beforeAfter ||
      !("Registration" in targetAfter) ||
      !sameExcept(
        {
          Registration: {
            ...target.Registration,
            pool_id: "",
            prev_pool: "",
            owner: { VerificationKey: "" },
            crch_signature: "",
            keys: [],
            signatures: [],
            reward_address: "",
            fixed_cost: "0",
            attributes: [],
            active: false,
          },
        },
        targetAfter,
        [],
      ) ||
      !sameExcept(before, beforeAfter, ["prev_pool"]) ||
      !cold(target.Registration.pool_id)
    )
      failed.add(10);
  }
  return verdict(failed);
}
