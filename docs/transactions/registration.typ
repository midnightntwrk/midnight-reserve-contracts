// night_registration transactions (staking MIP, PR 421, rules 9-10).
// `just tx-diagrams` renders one SVG per entry of `txs` into svg/.
#import "tx.typ": *

#set page(width: 80em, height: auto, margin: 1.5em, fill: white)
#set text(size: 10pt)

#let node_address = [`night_registration`, no stake part]
#let node_in = [`night_registration`]
#let node_value = (ada: [`n`], "night_registration token": "1")
#let token_mint = "night_registration token (Void)"
/// The withdrawal from night_registration that checks the transaction (user decision, 11-17).
#let gate(action) = [`night_registration`: its balance (0), #action]

/// A Registration datum in the decided field order (user decision, 11-14): the fields a node
/// keeps first, then the fields Deactivate clears.
#let registration(
  prev_pool: [`pp`],
  owner: [`o`],
  rest: ([`k`], [`s`], [`ra`], [`fc`], [`at`]),
) = (
  "Registration": "",
  "active": [`True`],
  "crch": [`cr`],
  "prev_crch": [`pc`],
  "pool_id": [`p`],
  "prev_pool": prev_pool,
  "owner": owner,
  "crch_signature": [`cs`],
  "keys": rest.at(0),
  "signatures": rest.at(1),
  "reward_address": rest.at(2),
  "fixed_cost": rest.at(3),
  "attributes": rest.at(4),
)


#let new_node = (
  name: "New node",
  address: node_address,
  value: node_value,
  datum: (
    "Registration": "",
    "active": [`True`],
    "crch": [`cr`, any length, not `#""`],
    "prev_crch": [`pc`, the crch anchor's old `prev_crch`],
    "pool_id": [`p`, 28 bytes],
    "prev_pool": [`pp`, the pool anchor's old `prev_pool`],
    "owner": [`VerificationKey(h)` | `Script(h)`, 28 bytes],
    "crch_signature": [any length],
    "keys": [any (not checked)],
    "signatures": [any (not checked)],
    "reward_address": [32 bytes],
    "fixed_cost": [0 to $2^128 - 1$],
    "attributes": [any (not checked)],
  ),
)

#let create_tx(title, action, anchors, anchor_outs, notes) = vanilla_transaction(
  title,
  inputs: (
    ..anchors,
    (name: "Pool's funds", address: "any wallet", value: (ada: [`n` + fee (+ `keyDeposit`)])),
  ),
  outputs: (new_node, ..anchor_outs, (name: "Change", address: "any wallet", value: (ada: "rest"))),
  mint: ((token_mint): (qty: 1, variables: (:))),
  withdraws: (gate(raw(action)),),
  certificates: (
    [`DelegateCredential(d, p)`, or],
    [`RegisterAndDelegateCredential(` \ `  d, p, keyDeposit)`],
  ),
  signatures: ([`p`, the pool's cold key], [`d`'s key, if `d` is a key]),
  notes: note[
    Rules 9, 10. The withdrawal's redeemer is #raw(action) (user decision,
    11-17): the redeemer names the action, and each action accepts one
    transaction shape; the mint and the spends need only the withdrawal. The contract checks the order by
    position: the new node, then the crch anchor, then the pool anchor when
    it is a separate UTxO, are the first outputs (user decision, 11-13).
    Change and any other outputs follow; none sits at night_registration's
    address or carries its token. The crch anchor
    is the node after the new one in the crch list, and the pool anchor the
    node after it in the pool list. Each link names the node before; the
    first node of a list links to `#""`. The Tail is always the last node
    of both lists, holds no key and sorts above every key: an anchor is the
    Tail when the new key sorts after the last node of that list. In each
    list the new key sorts above the anchor's old link and below the
    anchor's key, so no node holds `cr` and no active node holds `p`. The
    crch list sorts by length, then by bytes (user decision, 11-18); the
    pool list sorts `pool_id` by bytes. Every node datum, with both links
    set to `#""`, is at most `NODE_DATUM_MAX` (4,500) bytes. The
    transaction carries one certificate that delegates `d` to the pool `p`:
    a delegation certificate or a register-and-delegate certificate (user
    decision, 11-13), whose delegatee is `DelegateBlockProduction(p)` or
    `DelegateBoth(p, _)`. The ledger accepts either only for a registered
    pool. A register-and-delegate certificate also pays `keyDeposit` from
    the pool's funds. #notes \
    The certificate may delegate any stake credential `d`; the contract
    checks only that it names `pool_id`, and the CLI delegates the
    operator's own stake key by default (user decision, 11-14). \
    open: an anchor keeps its value, but its ADA may rise for the longer
    datum. \ #unordered
  ],
)

#let txs = (
  (
    "0-register-credential",
    vanilla_transaction(
      "Register night_registration's stake credential",
      inputs: (
        (name: "Funding", address: "any wallet", value: (ada: [`keyDeposit` + fee])),
      ),
      outputs: (
        (name: "Change", address: "any wallet", value: (ada: "rest")),
      ),
      certificates: (
        [`RegisterCredential(` \ `  Script(night_registration),` \ `  keyDeposit)`, `Void`],
      ),
      signatures: ([the funding key],),
      notes: note[
        The deploy registers night_registration's stake credential once per
        network, before the initialization (user decision, 11-17): every
        transaction at night_registration withdraws 0 from it, and that
        withdrawal runs every rule; the mint and the spends only require it.
        The Conway registration certificate runs night_registration under
        Publishing, which accepts it; the legacy certificate runs no script.
        night_registration refuses every other certificate, vote and
        proposal.
      ],
    ),
  ),
  (
    "6-initialize",
    vanilla_transaction(
      "Initialize the registration set",
      inputs: (
        (
          name: "Initialization UTxO",
          address: "any wallet",
          value: (ada: [`(N + 1) × n` + fee]),
        ),
      ),
      outputs: (
        (
          name: "Reserved c1",
          address: node_address,
          value: node_value,
          datum: ("Reserved": "", "crch": [`c1`], "prev_crch": [`#""`]),
        ),
        (name: "...", dots: true),
        (
          name: "Reserved cN",
          address: node_address,
          value: node_value,
          datum: ("Reserved": "", "crch": [`cN`], "prev_crch": [`c(N−1)`]),
        ),
        (
          name: "Tail",
          address: node_address,
          value: node_value,
          datum: ("Tail": "", "prev_crch": [`cN` (`#""` if `N` = 0)], "prev_pool": [`#""`]),
        ),
        (name: "Change", address: "any wallet", value: (ada: "rest")),
      ),
      mint: ((token_mint): (qty: 1, variables: ("N": 1))),
      withdraws: (gate([`Init`]),),
      signatures: ([the initialization UTxO's key],),
      notes: note[
        Rule 9. The transaction spends the initialization UTxO, the script's
        parameter (aiken.toml), so the transaction can run only once. The
        transaction creates one Reserved node per permissioned candidate and
        the Tail, sorted: `c1 < c2 < ... < cN`, by length, then by bytes
        (user decision, 11-18). Every node holds only ADA and one token with
        the empty name. \
        `prev_pool` is a plain ByteArray on every node (user decision, 11-13;
        the MIP has `Option<ByteArray>`). `#""` is the link of the first node
        of each list, and an inactive node holds `prev_pool = #""` with
        `active: False`. Node addresses have no stake part (rule 9, user
        decision, 11-14). \
        Whoever builds the initialization transaction chooses `c1 ... cN`;
        the CLI reads them from the federated-ops data (user decision,
        11-14). night_registration keeps one parameter, the initialization
        UTxO, and checks only the order and the node shape. \
        The withdrawal's redeemer is `Init` (user decision, 11-17). The contract
        checks the order by position: Reserved `c1 ... cN` are outputs 0 to
        `N − 1` and the Tail is output `N`; change and any other outputs
        follow, and none sits at night_registration's address.
      ],
    ),
  ),
  (
    "7a-create-two-anchors",
    create_tx(
      "Register a pool (Create), two anchors",
      "CreateTwoAnchors",
      (
        (
          name: "crch anchor",
          address: node_in,
          redeemer: [`Void`],
          value: node_value,
          datum: ("Tail, Reserved or any Registration": "", "crch": [`kc` > `cr` (none on the Tail)], "prev_crch": [`pc` < `cr`]),
        ),
        (
          name: "pool anchor",
          address: node_in,
          redeemer: [`Void`],
          value: node_value,
          datum: ("Tail or active Registration": "", "pool_id": [`kp` > `p` (none on the Tail)], "prev_pool": [`pp` < `p`]),
        ),
      ),
      (
        (
          name: "crch anchor",
          address: node_address,
          value: (ada: [$>=$ `n`], "night_registration token": "1"),
          datum: ("prev_crch": [`cr`], "every other field": [unchanged]),
        ),
        (
          name: "pool anchor",
          address: node_address,
          value: (ada: [$>=$ `n`], "night_registration token": "1"),
          datum: ("prev_pool": [`p`], "every other field": [unchanged]),
        ),
      ),
      [The crch anchor and the pool anchor are two different UTxOs here; diagram 7b shows one UTxO that is both. The crch anchor may be the Tail, a Reserved node or a Registration, active or not. The pool anchor may be the Tail or an active Registration.],
    ),
  ),
  (
    "7b-create-one-anchor",
    create_tx(
      "Register a pool (Create), one anchor",
      "CreateOneAnchor",
      (
        (
          name: "Anchor",
          address: node_in,
          redeemer: [`Void`],
          value: node_value,
          datum: (
            "Tail or active Registration": "",
            "crch": [`kc` > `cr` (none on the Tail)],
            "prev_crch": [`pc` < `cr`],
            "pool_id": [`kp` > `p` (none on the Tail)],
            "prev_pool": [`pp` < `p`],
          ),
        ),
      ),
      (
        (
          name: "Anchor",
          address: node_address,
          value: (ada: [$>=$ `n`], "night_registration token": "1"),
          datum: (
            "prev_crch": [`cr`],
            "prev_pool": [`p`],
            "every other field": [unchanged],
          ),
        ),
      ),
      [One UTxO is both the crch anchor and the pool anchor, so the transaction spends that node once, its output carries both link changes, and there is no third node output. Only the Tail or an active Registration can be both, because only those nodes are in both lists. The Tail is the anchor of a new last node, when `cr` and `p` both sort after the last node of their lists. A Reserved node or an inactive Registration is never in the pool list, so when the crch anchor is one of those, the Create needs two anchors (diagram 7a).],
    ),
  ),
  (
    "8-update",
    vanilla_transaction(
      "Update a registration",
      inputs: (
        (
          name: "Node",
          address: node_in,
          redeemer: [`Void`],
          value: node_value,
          datum: registration(),
        ),
        (name: "Fee", address: "any wallet", value: (ada: [`F`])),
      ),
      outputs: (
        (
          name: "Node",
          address: node_address,
          value: (ada: [`n'` $>=$ `n`], "night_registration token": "1"),
          datum: registration(
            owner: [`o'`: `o` unless the cold key signs],
            rest: ([`k'`], [`s'`], [`ra'`], [`fc'`], [`at'`]),
          ),
        ),
        (name: "Change", address: "any wallet", value: (ada: [`n + F − n' − fee`])),
      ),
      signatures: ([`h`, if `o = VerificationKey(h)`; or], [`p`, the cold key]),
      withdraws: (gate([`Update`]), [`h`: any amount ($>=$ 0), if `o = Script(h)`]),
      notes: note[
        Rule 10. The owner `o` (a key by signature, a script by a
        withdrawal) or the cold key `p` may change `keys`, `signatures`,
        `reward_address`, `fixed_cost` and `attributes`. Only the cold key
        may change `owner`. Rule 9's checks apply to the new values; the
        contract checks nothing inside `keys`, `signatures` or `attributes`.
        The node's ADA may rise, never fall (user decision, 11-14). `crch`,
        `crch_signature`, `pool_id`, `active` and both links never change.
        The withdrawal's redeemer is `Update` (user decision, 11-17). The contract
        checks the order by position: the updated node is the first output
        (user decision, 11-14), as in Create and Deactivate; no other output
        sits at the address or carries the token. The transaction mints
        nothing and spends no other node. Only an active node can be updated. \
        #unordered
      ],
    ),
  ),
  (
    "9-deactivate",
    vanilla_transaction(
      "Deactivate a registration",
      inputs: (
        (
          name: "pool anchor",
          address: node_in,
          redeemer: [`Void`],
          value: node_value,
          datum: ("Tail or active Registration": "", "prev_pool": [`p`]),
        ),
        (
          name: "Node",
          address: node_in,
          redeemer: [`Void`],
          value: node_value,
          datum: registration(),
        ),
      ),
      outputs: (
        (
          name: "Node",
          address: node_address,
          value: (ada: [`n'`, the ledger minimum], "night_registration token": "1"),
          datum: (
            "Registration": "",
            "active": [`False`],
            "crch": [`cr`],
            "prev_crch": [`pc`],
            "pool_id": [`#""`],
            "prev_pool": [`#""`],
            "owner": [`VerificationKey(#"")`],
            "crch_signature": [`#""`],
            "keys": [`[]`],
            "signatures": [`[]`],
            "reward_address": [`#""`],
            "fixed_cost": [0],
            "attributes": [`[]`],
          ),
        ),
        (
          name: "pool anchor",
          address: node_address,
          value: node_value,
          datum: ("prev_pool": [`pp`], "every other field": [unchanged]),
        ),
        (name: "Refund", address: "anywhere", value: (ada: [`n − n'` − fee])),
      ),
      signatures: ([`p`, the cold key],),
      withdraws: (gate([`Deactivate`]),),
      notes: note[
        Rule 10. Only the cold key may deactivate a node. The withdrawal's
        redeemer is `Deactivate` (user decision, 11-17). The contract checks the order
        by position: the first two outputs are, in this order (user decision,
        11-13), the deactivated node, then the pool anchor, the node after it
        in the pool list, whose `prev_pool` now skips the node (`pp`, the
        node's old `prev_pool`).
        The transaction always spends these two nodes. The node leaves the
        pool list for good but stays in the crch list, so `cr` stays taken.
        The transaction mints nothing. The deactivated node keeps `active`
        (now `False`), `crch` and `prev_crch`; the rest are cleared, as drawn,
        and the contract checks every cleared field (user decision, 11-14). \
        #unordered
      ],
    ),
  ),
)

#metadata(txs.map(t => t.at(0))) <txs>

#let only = sys.inputs.at("tx", default: none)
#for (name, body) in txs {
  if only == none or only == name {
    body
    pagebreak(weak: true)
  }
}
