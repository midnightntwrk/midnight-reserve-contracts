/**
 * An independent reference of rules 1 to 10 of the NIGHT staking MIP (midnight-improvement-proposals
 * PR #421, head 42056a66) and the user's decisions on it, written from that text alone, to check
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

export type Head = { next_crch: Hex; next_pool: Hex };
export type Reserved = { crch: Hex; next_crch: Hex };
/**
 * Field order (user decision 11-14): the fields a node keeps, then those a Deactivate clears. A
 * list ends at "": `next_pool` is a plain ByteArray, "" on the last active node and on every
 * inactive one.
 */
export type Registration = {
  active: boolean;
  crch: Hex;
  next_crch: Hex;
  pool_id: Hex;
  next_pool: Hex;
  owner: Credential;
  crch_signature: Hex;
  keys: Pairs<Hex>;
  signatures: Pairs<Hex>;
  reward_address: Hex;
  fixed_cost: string;
  attributes: Pairs<unknown>;
};
/** A list ends at the empty ByteArray: a `next_crch` or `next_pool` of "" points past the last node. */
export type Node =
  | { Head: Head }
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
export type RegistrationConstants = { script_hash: Hex; init_utxo: OutRef };
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
    // Rule 3 (user decisions 2026-11-13 and 11-17, MIP edit pending): an Update keeps unbond_at
    // None, may change pool_id, reward_address and attributes, and return_address only under its
    // own payment credential; the lock is outputs[0]. A lock whose unbond_at is Some can only be
    // unlocked.
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
      !registered(after.pool_id) ||
      (!same(before.return_address, after.return_address) &&
        !authorizes(tx, before.return_address.payment))
    )
      failed.add(3);
    if (before === null || !authorizes(tx, before.owner)) failed.add(5);
  } else if (redeemer === "Unbond") {
    // Rule 3 (user decisions 2026-11-13 and 11-17, MIP edit pending): an Unbond sets unbond_at from
    // None to a time no earlier than the validity upper bound and changes nothing else but its ADA,
    // which may rise to the new min-UTxO and never falls; the lock is outputs[0].
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
      BigInt(after.unbond_at) < BigInt(upper) ||
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

/** A link of one list: from a node's key (null for the head) to the next key ("" past the end). */
type Edge = [Hex | null, Hex];

const crchEdges = (nodes: Node[]) =>
  nodes.map((n): Edge =>
    "Head" in n
      ? [null, n.Head.next_crch]
      : "Reserved" in n
        ? [n.Reserved.crch, n.Reserved.next_crch]
        : [n.Registration.crch, n.Registration.next_crch],
  );
const poolEdges = (nodes: Node[]) =>
  nodes.flatMap((n): Edge[] =>
    "Head" in n
      ? [[null, n.Head.next_pool]]
      : "Registration" in n && n.Registration.active
        ? [[n.Registration.pool_id, n.Registration.next_pool]]
        : [],
  );

/**
 * Rule 9: the links a transaction writes keep the list whole. The nodes it spends are pieces of a
 * sorted list whose other nodes it cannot see, so the links after must be sorted, give each key at
 * most one link in and one out, and start and end where the links before did.
 */
const intact = (before: Edge[], after: Edge[]) => {
  const from = (es: Edge[]) => es.map(([f]) => f ?? "head");
  const to = (es: Edge[]) => es.map(([, t]) => t);
  const unique = (xs: string[]) => new Set(xs).size === xs.length;
  const outside = (xs: string[], ys: string[]) =>
    xs
      .filter((x) => !ys.includes(x))
      .sort()
      .join();
  return (
    unique(from(after)) &&
    unique(to(after)) &&
    after.every(([f, t]) => f === null || t === "" || f < t) &&
    outside(from(before), to(before)) === outside(from(after), to(after)) &&
    outside(to(before), from(before)) === outside(to(after), from(after))
  );
};

const id = (n: Node) =>
  "Head" in n
    ? "head"
    : "Reserved" in n
      ? n.Reserved.crch
      : n.Registration.crch;
/** A node's kind and fields, with `fixed_cost` as a number so "0" and "00" compare equal. */
const fields = (n: Node): [string, Record<string, unknown>] =>
  "Head" in n
    ? ["Head", n.Head]
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
 * night_registration, rules 9 and 10, in the withdrawal pattern (user decision 11-17): every
 * registration transaction withdraws from Script(night_registration), and that withdrawal's
 * redeemer names the action, each with one transaction shape. The spend and the mint only check the
 * withdrawal; the publish purpose accepts only the plain registration of the credential. `redeemer`
 * is null when the transaction has no withdrawal from the script. The MIP has no gate or
 * certificate rule for night_registration yet, so these fail rule 10 (Changes).
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
  const spent = tx.inputs
    .map((i) => i.output)
    .filter((o) => atAddress(o) && hasToken(o.value))
    .flatMap((o) => (o.datum === null ? [] : [o.datum]));
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
  // and nothing else, and a Registration's fixed fields have their lengths. Nothing inside keys,
  // signatures or attributes is checked: Midnight validates them (user decision 11-14).
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
    if (!("Registration" in n)) continue;
    const r = n.Registration;
    if (
      bytes(r.crch) !== 32 ||
      (r.active &&
        (bytes(r.crch_signature) !== 64 ||
          bytes(r.pool_id) !== 28 ||
          bytes(hashOf(r.owner)) !== 28 ||
          bytes(r.reward_address) !== 32 ||
          BigInt(r.fixed_cost) < 0n))
    )
      failed.add(9);
  }
  // Rule 9: no node is removed and both lists stay whole.
  if (!spent.every((s) => nodes.some((n) => id(n) === id(s)))) failed.add(9);
  const empty: Edge[] = [[null, ""]];
  if (
    !intact(redeemer === "Init" ? empty : crchEdges(spent), crchEdges(nodes)) ||
    !intact(redeemer === "Init" ? empty : poolEdges(spent), poolEdges(nodes))
  )
    failed.add(9);

  if (redeemer === "Init") {
    // Rule 9: the initialization spends the initialization UTxO and creates the head at outputs[0]
    // and the Reserved nodes at outputs[1..N] in crch order, minting one token each, and nothing else
    // (user decision 11-17). Which crch the Reserved nodes hold is left to whoever builds the
    // transaction (the CLI reads the permissioned candidates from the federated-ops data); the
    // script's one parameter is its initialization UTxO, so it checks only order and node shape
    // (user decision 11-14).
    const [head, ...reserved] = nodes;
    if (
      !tx.inputs.some(
        (i) => i.ref.tx === k.init_utxo.tx && i.ref.index === k.init_utxo.index,
      ) ||
      spent.length > 0 ||
      nodes.length !== created.length ||
      tx.outputs.slice(0, created.length).some((o) => !hasToken(o.value)) ||
      head === undefined ||
      !("Head" in head) ||
      !reserved.every(
        (n, i) => "Reserved" in n && (i === 0 || id(reserved[i - 1]) < id(n)),
      ) ||
      !single(mint, BigInt(created.length))
    )
      failed.add(9);
    return verdict(failed);
  }
  const fresh = nodes.filter((n) => !spent.some((s) => id(s) === id(n)));
  // Rule 9: nothing but the initialization creates the head or a Reserved node.
  if (fresh.some((n) => !("Registration" in n))) failed.add(9);
  const cold = (pool_id: Hex) => tx.extra_signatories.includes(pool_id);

  if (redeemer === "CreateTwoAnchors" || redeemer === "CreateOneAnchor") {
    // Create: one new active Registration under the cold key, with a delegation to its pool; the
    // spent nodes change only their links, and an inactive one only its crch link.
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
      !spent.every((s) => {
        const after = nodes.find((m) => id(m) === id(s));
        return (
          after === undefined ||
          sameExcept(
            s,
            after,
            "Head" in s || ("Registration" in s && s.Registration.active)
              ? ["next_crch", "next_pool"]
              : ["next_crch"],
          )
        );
      })
    )
      failed.add(10);
    // Rule 10 (user decisions 2026-11-13, 11-14 and 11-17, MIP edit pending): the transaction's
    // first outputs are the new node, its crch anchor with next_crch pointing at it, then, for
    // CreateTwoAnchors, its pool anchor with next_pool pointing at it; for CreateOneAnchor the one
    // anchor carries both links. The spent anchors may come in any order.
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
      crchEdges([crchAnchor])[0][1] !== id(n) ||
      rest.length > 0 ||
      (poolKey === null
        ? poolAnchor !== undefined
        : !poolEdges([poolAnchor ?? crchAnchor]).some(
            ([, next]) => next === poolKey,
          ))
    )
      failed.add(10);
  } else if (redeemer === "Update") {
    // Update: one active node keeps its crch, crch_signature, pool_id and links; the owner or the
    // cold key signs, and the cold key alone changes the owner. It spends one node, mints nothing,
    // and the updated node is the transaction's first output (user decisions 11-14 and 11-17). Its
    // ADA may rise, never fall (user decision 11-14).
    const [spentOutput] = tx.inputs
      .map((i) => i.output)
      .filter((o) => atAddress(o) && hasToken(o.value));
    const [s] = spent;
    const [after] = nodes;
    if (
      spent.length !== 1 ||
      mint.length > 0 ||
      nodes.length !== 1 ||
      tx.outputs[0] !== created[0] ||
      BigInt(created[0].value.lovelace) < BigInt(spentOutput.value.lovelace) ||
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
    // crch and crch link; its pool-list predecessor changes only its pool link. It spends those two
    // nodes and mints nothing; the transaction's first outputs are the deactivated node, then the
    // predecessor (user decisions 2026-11-13, 11-14 and 11-17); the inputs may come in any order.
    const target = spent.find(
      (s) =>
        "Registration" in s &&
        s.Registration.active &&
        spent.some(
          (p) =>
            p !== s &&
            poolEdges([p]).some(([, next]) => next === s.Registration.pool_id),
        ),
    );
    const before = spent.find((s) => s !== target);
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
      nodes[0] !== targetAfter ||
      nodes[1] !== beforeAfter ||
      !("Registration" in targetAfter) ||
      !sameExcept(
        {
          Registration: {
            ...target.Registration,
            pool_id: "",
            next_pool: "",
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
      !sameExcept(before, beforeAfter, ["next_pool"]) ||
      !cold(target.Registration.pool_id)
    )
      failed.add(10);
  }
  return verdict(failed);
}
