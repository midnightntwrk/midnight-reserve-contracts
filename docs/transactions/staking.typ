// night_staking transactions (staking MIP, PR 421, rules 1-8).
// `just tx-diagrams` renders one SVG per entry of `txs` into svg/.
#import "tx.typ": *

#set page(width: 80em, height: auto, margin: 1.5em, fill: white)
#set text(size: 10pt)

#let lock_address = [`night_staking`, no stake part]

#let lock_datum = (
  "owner": [`o`],
  "pool_id": [`p`],
  "reward_address": [`r`],
  "return_address": [`ret`],
  "unbond_at": [`u`],
  "attributes": [`a`],
)

#let lock_in(datum: lock_datum) = (
  name: "Lock",
  address: lock_address,
  redeemer: [`Void`],
  value: (ada: [`l`], "night_staking token": "1", "cNIGHT": [`c`]),
  datum: datum,
)

#let gate(action) = [`night_staking`: its balance (0), #action]
#let owner_script = [`h`: any amount ($>=$ 0), if `owner = Script(h)`]
#let owner_key = [`h`, if `owner = VerificationKey(h)`]
#let token_mint = "night_staking token (Void)"

/// The pool's node in the registration set, read by a Lock and by an Update that changes
/// pool_id (rules 2 and 3, Output).
#let pool_node(pool, name: "Pool's node") = (
  name: name,
  address: [`night_registration`],
  reference: true,
  value: (ada: "any", "night_registration token": "1"),
  datum: ("Registration": "", "active": [`True`], "pool_id": pool),
)

#let txs = (
  (
    "1-register-credential",
    vanilla_transaction(
      "Register night_staking's stake credential",
      inputs: (
        (name: "Funding", address: "any wallet", value: (ada: [`keyDeposit` + fee])),
      ),
      outputs: (
        (name: "Change", address: "any wallet", value: (ada: "rest")),
      ),
      certificates: (
        [`RegisterCredential(` \ `  Script(night_staking),` \ `  keyDeposit)`, `Void`],
      ),
      signatures: ([the funding key],),
      notes: note[
        Rule 8. Anyone may submit this transaction, once per network, before
        the first Lock. The Conway registration certificate, which states
        the deposit, runs night_staking under Publishing with redeemer
        `Void`; the legacy certificate runs no script. night_staking refuses
        every other certificate, vote and proposal.
      ],
    ),
  ),
  (
    "2-lock",
    vanilla_transaction(
      "Lock",
      inputs: (
        (
          name: "Owner's funds",
          address: "any wallet",
          value: (ada: [`F`], "cNIGHT": [`c` $>=$ 0]),
        ),
        pool_node([`p`]),
      ),
      outputs: (
        (
          name: "Lock",
          address: lock_address,
          value: (
            ada: [`l` $>=$ `lock_deposit_lovelace`],
            "night_staking token": "1",
            "cNIGHT": [`c`],
          ),
          datum: (
            "owner": [`VerificationKey(h)` | `Script(h)`, \ #box(width: 2.4em) 28 bytes, $!=$ `Script(night_staking)`],
            "pool_id": [`p`, 28 bytes],
            "reward_address": [32 bytes],
            "return_address": [`ret`: payment credential 28 bytes, \ #box(width: 2.4em) $!=$ `Script(night_staking)`; stake part any],
            "unbond_at": [`None`],
            "attributes": [any (not checked)],
          ),
        ),
        (name: "Change", address: "any wallet", value: (ada: [`F − l − fee`])),
      ),
      mint: ((token_mint): (qty: 1, variables: (:))),
      withdraws: (gate([`Lock`]), owner_script),
      signatures: (owner_key,),
      notes: note[
        Rules 1, 2, 2a, 5, 6, 7. The transaction spends nothing at
        night_staking and creates one lock there. The lock holds only ADA,
        the token (empty name) and cNIGHT (`cnight_policy`, `cnight_name`);
        `c` may be 0. `lock_deposit_lovelace` is 2 000 000 lovelace, a floor:
        the lock may hold more ADA and must also meet the ledger's min UTxO.
        No other output carries the token. `ret` is the Cardano address that
        receives the cNIGHT at the Unlock (rule 4, diagram 5). \
        Rule 2, Output (user decision, 11-14; MIP 421): a reference input
        at night_registration's address holds the set's token and an active
        Registration whose `pool_id` is the lock's `p`. night_staking compiles
        in night_registration's hash (aiken.toml), so night_registration is
        built first. \
        The withdrawal's redeemer is `Lock` (user decision, 11-17): the
        redeemer names the action, and each action accepts one transaction
        shape. The contract checks the order by position: the lock is the first
        output; change follows. Mint and spend purposes read no redeemer. \
        #unordered
      ],
    ),
  ),
  (
    "3-update",
    vanilla_transaction(
      "Update a lock",
      inputs: (
        lock_in(datum: lock_datum + ("unbond_at": [`None`])),
        (name: "Owner's funds", address: "any wallet", value: (ada: [`F`], "cNIGHT": [`d` $>=$ 0])),
        pool_node([`p'`], name: [Pool's node, if `p'` $!=$ `p`]),
      ),
      outputs: (
        (
          name: "Lock",
          address: lock_address,
          value: (
            ada: [`l'` $>=$ `lock_deposit_lovelace`],
            "night_staking token": "1",
            "cNIGHT": [`c + d`],
          ),
          datum: (
            "owner": [`o`, unchanged],
            "pool_id": [`p'`, 28 bytes],
            "reward_address": [`r'`, 32 bytes],
            "return_address": [`ret'`: `ret` unless `ret`'s payment \ #box(width: 2.4em) credential authorizes],
            "unbond_at": [`None`],
            "attributes": [`a'` (not checked)],
          ),
        ),
        (name: "Change", address: "any wallet", value: (ada: [`l + F − l' − fee`])),
      ),
      withdraws: (gate([`Update`]), owner_script, [`k`: any amount, if `ret'` $!=$ `ret` and \ `ret`'s payment credential is `Script(k)`]),
      signatures: (owner_key, [`k`, if `ret'` $!=$ `ret` and `ret`'s payment \ credential is `VerificationKey(k)`]),
      notes: note[
        Rules 2, 3, 5, 6, 7. An Update may re-point the lock, add cNIGHT, and
        change `reward_address` or `attributes`, in any mix. An Update mints
        nothing, and the cNIGHT never falls. `unbond_at` is `None` on both
        the input and the output, so an unbonded lock can only be unlocked
        (user decision, 11-13; the MIP will say so). The transaction reads
        the active node of the output's pool `p'` only when `p'` differs
        from `p` (rule 3). Unbond and Unlock read no node, so a lock behind
        a pool that deactivates can still leave. \
        Rule 3 (MIP 421): `return_address` changes only if the payment
        credential of the input's `ret` authorizes the transaction, as rule 5
        authorizes an owner, and the owner still authorizes it too. The new
        `ret'` authorizes nothing. \
        The withdrawal's redeemer is `Update` (user decision, 11-17). The
        contract checks the order by position: the new lock is the first
        output. \ #unordered
      ],
    ),
  ),
  (
    "4-unbond",
    vanilla_transaction(
      "Unbond a lock",
      inputs: (
        lock_in(datum: lock_datum + ("unbond_at": [`None`])),
        (name: "Funding", address: "any wallet", value: (ada: [`F`])),
      ),
      outputs: (
        (
          name: "Lock",
          address: lock_address,
          value: (ada: [`l'` $>=$ `l`], "night_staking token": "1", "cNIGHT": [`c`]),
          datum: (
            "owner": [`o`],
            "pool_id": [`p`],
            "reward_address": [`r`],
            "return_address": [`ret`],
            "unbond_at": [`Some(t)`],
            "attributes": [`a`],
          ),
        ),
        (name: "Change", address: "any wallet", value: (ada: [`l + F − l' − fee`])),
      ),
      withdraws: (gate([`Unbond`]), owner_script),
      signatures: (owner_key,),
      validRange: (upper: [`U` $= t$]),
      notes: note[
        Rule 3, Unbond. `unbond_at` goes from `None` to `Some(t)`. The rest
        of the output equals the input: address, token, cNIGHT, `owner`,
        `pool_id`, `reward_address`, `return_address` and `attributes`. Only the ADA may
        change: `l'` is at least `l`, which is at least
        `lock_deposit_lovelace`, and `l'` may rise to the min UTxO of the
        larger datum. `t` is POSIX ms; the upper bound must be finite and
        equal to `t`. After an Unbond the lock can only be unlocked
        (diagram 5); no rule clears `unbond_at` (MIP Open Question 3). \
        The withdrawal's redeemer is `Unbond` (user decision, 11-17). The
        contract checks the order by position: the unbonding lock is the first
        output. \ #unordered
      ],
    ),
  ),
  (
    "5-unlock",
    vanilla_transaction(
      "Unlock a lock",
      inputs: (
        lock_in(datum: lock_datum + ("unbond_at": [`Some(t)`, or any if `c` = 0])),
        (name: "Fee", address: "any wallet", value: (ada: "fee")),
      ),
      outputs: (
        (name: "cNIGHT payout", address: [`ret`, the lock's return address], value: (ada: "min UTxO", "cNIGHT": [$>=$ `c`])),
        (name: "ADA", address: "anywhere", value: (ada: [`l` − min UTxO])),
      ),
      mint: ((token_mint): (qty: -1, variables: (:))),
      withdraws: (gate([`Unlock`]), owner_script),
      signatures: (owner_key,),
      validRange: (lower: [`t + UNBONDING_DELAY`]),
      notes: note[
        Rules 4, 5, 6, 7. The transaction leaves no output at night_staking.
        A lock with cNIGHT (`c` > 0) needs a finite lower bound of at least
        `t + UNBONDING_DELAY`; a lock without cNIGHT needs no bound.
        `UNBONDING_DELAY` is 4 epochs of the network in ms (aiken.toml): 1
        728 000 000 on preprod and mainnet, 345 600 000 on preview. \
        Rule 4 (MIP 421): a lock with cNIGHT pays all of it to one output
        whose address equals `ret`, stake part included, and which holds only
        ADA and cNIGHT (user decision, 11-17); the ADA goes anywhere. A lock
        without cNIGHT has no payout rule. \
        The withdrawal's redeemer is `Unlock` (user decision, 11-17). The
        contract checks the order by position: the cNIGHT payout is the first
        output. \ #unordered
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
