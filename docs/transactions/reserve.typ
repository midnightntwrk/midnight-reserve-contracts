// Reserve logic v2 transactions: the Cardano Reserve Release of PR 406
// (midnight-improvement-proposals) as change pmlmqpwo builds it, with the
// 11-12 decisions: no Merge, no Start, the staging NFT read by reference.
// `just tx-diagrams` renders one SVG per entry of `txs` into svg/.
#import "tx.typ": *

#set page(width: 98em, height: auto, margin: 1.5em, fill: white)
#set text(size: 10pt)
#let note = note.with(width: 92em)

#let state_in(datum, forever: "reserve_forever") = (
  name: "Reserve state",
  address: raw(forever),
  redeemer: [`0`, unread],
  value: (ada: [`f`], (forever + " token"): "1"),
  datum: datum,
)

#let state_out(datum, forever: "reserve_forever") = (
  name: "Reserve state",
  address: [#raw(forever), no stake part],
  value: (ada: [$>=$ `f`], (forever + " token"): "1"),
  datum: datum,
)

#let state(c: [`c`], q: [`q`], s: [`s`], paused: [`p`]) = (
  "curve_remaining_star": c,
  "cumulative_released_star": q,
  "next_interval_start_ms": s,
  "paused": paused,
)

#let main_ref = (
  name: "Two-stage main",
  address: [`reserve_two_stage`],
  reference: true,
  value: (ada: "any", "reserve_two_stage \"main\"": "1"),
  datum: (
    "logic": [`reserve_logic_v2`],
    "mitigation_logic": [`ml` (`#""` today)],
    "auth": [`main_gov_auth`],
  ),
)

#let gov_refs(threshold) = (
  (
    name: "Gov threshold",
    address: raw(threshold),
    reference: true,
    value: (ada: "any", (threshold + " token"): "1"),
    datum: ("MultisigThreshold": ""),
  ),
  (
    name: "Technical Authority",
    address: [`technical_authority_forever`],
    reference: true,
    value: (ada: "any", "technical_authority_forever token": "1"),
    datum: ("Versioned<Multisig>": ""),
  ),
  (
    name: "Council",
    address: [`council_forever`],
    reference: true,
    value: (ada: "any", "council_forever token": "1"),
    datum: ("Versioned<Multisig>": ""),
  ),
)

#let funding = (name: "Funding", address: "any wallet", value: (ada: "fee"))
#let change = (name: "Change", address: "any wallet", value: (ada: "rest"))
#let mitigation = [`ml`: 0, if `ml` $!=$ `#""`]

#let gov_mint = (
  "TA native script \"tech-auth-witness\"": (qty: 1, variables: (:)),
  "council native script \"council-auth-witness\"": (qty: 1, variables: (:)),
)
#let gov_signatures = ([Technical Authority keys, to the threshold], [Council keys, to the threshold])
#let gov_change = (
  name: "Change",
  address: "any wallet",
  value: (ada: "rest", "tech-auth-witness": "1", "council-auth-witness": "1"),
)

#let upgrade_state(name, token, redeemer: none, reference: false, datum) = (
  name: name,
  address: [`reserve_two_stage`],
  ..if redeemer != none { (redeemer: redeemer) },
  reference: reference,
  value: (ada: "any", ("reserve_two_stage \"" + token + "\""): "1"),
  datum: datum,
)

#let upgrade_datum(
  logic: [`l`],
  mitigation_logic: [`ml`],
  auth: [`a`],
  mitigation_auth: [`ma`],
  round: [`r`],
  logic_round: [`lr`],
) = (
  "logic": logic,
  "mitigation_logic": mitigation_logic,
  "auth": auth,
  "mitigation_auth": mitigation_auth,
  "round": round,
  "logic_round": logic_round,
)

#let council_main_ref = (
  name: "Council main",
  address: [`council_two_stage`],
  reference: true,
  value: (ada: "any", "council_two_stage \"main\"": "1"),
  datum: ("auth": [`main_gov_auth`]),
)

#let stage_tx(title, field, new_hash, staging_after, notes) = vanilla_transaction(
  title,
  inputs: (
    upgrade_state(
      "Staging",
      "staging",
      redeemer: [`Staging`],
      upgrade_datum(
        logic: [`ls`],
        mitigation_logic: [`mls`],
        auth: [`staging_gov_auth`],
        mitigation_auth: [`sma`],
        round: [`rs`],
        logic_round: [`lrs`],
      ),
    ),
    funding,
    upgrade_state("Main (m)", "main", reference: true, upgrade_datum(auth: [`main_gov_auth`])),
    ..gov_refs("staging_gov_threshold"),
    council_main_ref,
  ),
  outputs: (
    upgrade_state("Staging", "staging", staging_after),
    gov_change,
  ),
  mint: gov_mint,
  withdraws: (
    [`staging_gov_auth`: 0, redeemer unread],
    [`sma`: 0, if set and the field is not `MitigationAuth`],
  ),
  signatures: gov_signatures,
  notes: note[
    Redeemer: `TwoStageRedeemer [`#field`, Staging(m, `#new_hash`)]`, where
    `m` is the main UTxO's output reference. \ #notes \ #unordered
  ],
)

#let promote_tx(title, field, main_before, main_after, staging, notes) = vanilla_transaction(
  title,
  inputs: (
    upgrade_state("Main", "main", redeemer: [`Main`], main_before),
    funding,
    upgrade_state("Staging (st)", "staging", reference: true, staging),
    ..gov_refs("main_gov_threshold"),
  ),
  outputs: (
    upgrade_state("Main", "main", main_after),
    gov_change,
  ),
  mint: gov_mint,
  withdraws: ([`main_gov_auth`: 0, redeemer unread], [`ma`: 0, if `ma` $!=$ `#""`]),
  signatures: gov_signatures,
  notes: note[
    Redeemer: `TwoStageRedeemer [`#field`, Main(st)]`, where `st` is the
    staging UTxO's output reference. \ #notes \ #unordered
  ],
)

#let pause_tx(title, action, after) = vanilla_transaction(
  title,
  inputs: (state_in(state()), funding, main_ref, ..gov_refs("main_gov_threshold")),
  outputs: (state_out(state(paused: after)), gov_change),
  mint: gov_mint,
  withdraws: (
    [`reserve_logic_v2`: 0, #action],
    mitigation,
    [`main_gov_auth`: 0, redeemer unread],
  ),
  signatures: gov_signatures,
  notes: note[
    PR 406, Pause, upgrade, and freeze. Only `paused` changes; no reserve
    NIGHT moves. The pause authority is the reserve two-stage main state's
    `auth`, today main_gov_auth, together with its `mitigation_auth` once
    that is set, as main's `validate_running` requires (user decision,
    11-17). A main_gov_auth withdrawal needs both native-script mints, as
    every governance change does. \
    Output order (user decision, 11-17): the contract checks that the state
    output is outputs[0]; no later output may sit at reserve_forever. \
    Inputs and reference inputs appear in no particular order.
  ],
)

#let init_tokens_in(staging) = (
  name: "Init tokens",
  address: "deploying wallet",
  value: (ada: "min UTxO", "reserve_logic_v2 \"main\"": "1", "reserve_logic_v2 \"staging\"": staging),
)

/// The reserve's NIGHT UTxO that Init reads (user decision, 11-14); not spent.
#let night_ref(forever, night) = (
  name: "Reserve NIGHT",
  address: raw(forever),
  reference: true,
  value: (ada: [`a`], (night): [`R`]),
)

#let init_out = state(
  c: [`release_initial_reserve_star`],
  q: [0],
  s: [`release_anchor_posix_ms`],
  paused: [`False`],
)

#let init_checks = [
  Init checks: the transaction burns exactly one init token of its track; the
  state output datum equals `initial_state()`, a constant that
  reserve_logic_v2 builds from aiken.toml; no NIGHT input at the forever
  address and no other output there; and a reference input at the forever
  address holds exactly `R` = `release_initial_reserve_star` NIGHT, PR 406's
  `initial_reward_reserve` (user decision, 11-14). The NIGHT UTxO stays
  separate from the state UTxO, as in diagram 13. Init does not read the
  state input's datum: it writes `initial_state()` whatever was there (user
  decision, 11-17). Init runs once per track because its init token is
  minted once, against the seed UTxO, and Init burns it. Release, Pause and
  Unpause refuse a state input whose datum is not a `ReserveRewardState`,
  such as the deploy datum, and any mint or burn under reserve_logic_v2's
  policy. The burn (mint purpose, redeemer `BurnInitToken`, user decision,
  11-17) passes only when the transaction's reserve_logic_v2 withdrawal
  carries redeemer `Init` (read from the transaction's redeemers) and the
  policy's whole mint is exactly −1 of that track's token: `"main"` when
  reserve_logic_v2 is the main `logic`, `"staging"` otherwise. So no other
  transaction can burn an init token, and a staging Init or Release cannot
  burn `"main"`. The holder of the init tokens (the deployer) submits Init;
  Init needs no main_gov_auth (user decision, 11-14), because Init writes a
  fixed constant.
]

#let txs = (
  (
    "10-register-credential",
    vanilla_transaction(
      "Register reserve_logic_v2's credential and mint the init tokens",
      inputs: (
        (
          name: "Seed UTxO",
          address: "any wallet",
          value: (ada: [`F`]),
        ),
      ),
      outputs: (
        (name: "Init tokens", address: "deploying wallet", value: (ada: "min UTxO", "reserve_logic_v2 \"main\"": "1", "reserve_logic_v2 \"staging\"": "1")),
        change,
      ),
      mint: (
        "reserve_logic_v2 \"main\" (MintInitTokens)": (qty: 1, variables: (:)),
        "reserve_logic_v2 \"staging\" (MintInitTokens)": (qty: 1, variables: (:)),
      ),
      certificates: ([`RegisterCredential(` \ `  Script(reserve_logic_v2),` \ `  keyDeposit)`, redeemer unread],),
      signatures: ([the seed UTxO's key],),
      notes: note[
        Anyone holding the seed UTxO may submit this transaction, once per
        network, before reserve_logic_v2 is staged. The seed UTxO is
        `reserve_logic_v2_init_one_shot_hash` \#
        `reserve_logic_v2_init_one_shot_index` (aiken.toml), the repo's
        one-shot pattern (user decision, 11-13). The mint purpose, with
        redeemer `MintInitTokens` (user decision, 11-17), accepts
        exactly +1 `"main"` and +1 `"staging"`, nothing else under the
        policy, and only when the transaction spends the seed UTxO; the mint
        does not depend on the certificate. Spending the seed UTxO is possible
        once, so each token is minted once. The publish purpose accepts the
        registration and refuses every other certificate. Init burns `"main"`
        on the main track (diagram 12a) and `"staging"` on the staging track
        (diagram 12b). The deploying wallet keeps both tokens, drawn in one
        UTxO (user decision, 11-14); the contract checks nothing about where
        they go (user decision, 11-17). The tokens are named `"main"`
        and `"staging"`, and the seed UTxO constants are
        `reserve_logic_v2_init_one_shot_hash` and
        `reserve_logic_v2_init_one_shot_index` (user decision, 11-14). \
        Already registered: anyone can register a script credential first
        with Conway's legacy certificate, which states no deposit and runs no
        script, and the ledger then refuses a second registration. In that
        case the deploy leaves the certificate out and only spends the seed
        UTxO and mints the two tokens; nothing else changes.
      ],
    ),
  ),
  (
    "11-staging-params",
    vanilla_transaction(
      "Mint the staging-track params",
      inputs: (
        (
          name: "Seed UTxO",
          address: "any wallet",
          value: (ada: "min UTxO + fee"),
        ),
      ),
      outputs: (
        (
          name: "Staging params",
          address: [`reserve_staging_params`, no stake part],
          value: (ada: "min UTxO", "reserve_staging_params token": "1"),
          datum: (
            "ReserveStagingParams": "",
            "cnight_test_policy": [28 bytes],
            "forever_script_hash": [28 bytes],
            "destination_hash": [28 bytes],
          ),
        ),
        change,
      ),
      mint: ("reserve_staging_params token (unread)": (qty: 1, variables: (:))),
      signatures: ([the seed UTxO's key],),
      notes: note[
        Staging track only. reserve_staging_params, a new test-only contract
        (user decision, 11-14), mints its own NFT with the repo's one-shot
        pattern, as the forevers do (`input_linked_mint`): its mint purpose
        accepts exactly one token with the empty name, only when the
        transaction spends the seed UTxO
        `reserve_staging_params_one_shot_hash` \#
        `reserve_staging_params_one_shot_index` (aiken.toml), and only when
        the token goes, alone with ADA, to reserve_staging_params's own
        address with no stake part and an inline `ReserveStagingParams` of
        three 28-byte hashes (user decision, 11-16). The deployer must choose
        a `destination_hash` different from `forever_script_hash`; the
        contract does not check it. reserve_logic_v2 mints no params token. \
        Output order (user decision, 11-17): the contract checks that the
        params output is outputs[0]. \
        Staging-track transactions read the params from the reference input
        that holds this NFT; reserve_logic_v2 compiles in its policy,
        `reserve_staging_params_hash` (aiken.toml). \
        reserve_staging_params is spendable with a staging_gov_auth withdrawal
        (diagram 11b, user decision, 11-14); the contract exists only to test
        reserve_logic_v2 on the staging track with fake tokens.
      ],
    ),
  ),
  (
    "11b-retire-staging-params",
    vanilla_transaction(
      "Spend the staging params (reserve_staging_params)",
      inputs: (
        (
          name: "Staging params",
          address: [`reserve_staging_params`],
          redeemer: [`Void`, unread],
          value: (ada: "min UTxO", "reserve_staging_params token": "1"),
          datum: ("ReserveStagingParams": ""),
        ),
        funding,
        ..gov_refs("staging_gov_threshold"),
        council_main_ref,
      ),
      outputs: (
        (
          name: "Token out",
          address: "any address",
          value: (ada: "any", "reserve_staging_params token": "1"),
        ),
        gov_change,
      ),
      mint: gov_mint,
      withdraws: ([`staging_gov_auth`: 0, redeemer unread],),
      signatures: gov_signatures,
      notes: note[
        reserve_staging_params, spend purpose: a spend passes only with a
        staging_gov_auth withdrawal, which needs the Technical Authority and
        Council native-script mints to the staging threshold, as diagram 16
        does. Nothing else is checked: the staging params serve tests only,
        and the seed UTxO allows no second params NFT (user decision,
        11-14). \
        #unordered
      ],
    ),
  ),
  (
    "12a-init-main",
    vanilla_transaction(
      "Init on the main track: the first transaction under reserve_logic_v2",
      inputs: (
        state_in(("any datum, unread": [the deploy datum `Constr 0 [0, 0]`])),
        init_tokens_in([`s` (0 or 1)]),
        funding,
        main_ref,
        night_ref("reserve_forever", "NIGHT"),
      ),
      outputs: (
        state_out(init_out),
        (
          name: "Change",
          address: "deploying wallet",
          value: (ada: "rest", "reserve_logic_v2 \"staging\"": [`s`]),
        ),
      ),
      mint: ("reserve_logic_v2 \"main\" (BurnInitToken)": (qty: -1, variables: (:))),
      withdraws: ([`reserve_logic_v2`: 0, `Init`], mitigation),
      signatures: ([the deploying wallet's key],),
      notes: note[
        PR 406, Backwards Compatibility: the migrated state. Init is its own
        redeemer (user decision, 11-13). On the main track (the main `logic`
        is reserve_logic_v2) Init runs after the promote (diagram 17): it
        spends the wallet UTxO holding `"main"` and burns it. The holder of
        the init tokens (the deployer) submits Init, once. \
        Output order (user decision, 11-17): the contract checks that the
        state output is outputs[0]; no later output may sit at
        reserve_forever. The `"staging"` token, if diagram 12b has not burned
        it yet, stays in the deployer's change; the contract checks nothing
        about it (user decision, 11-17). \
        #init_checks \
        Before the promote (diagram 17), the current reserve_logic's Merge
        must gather the reserve's NIGHT into the one UTxO Init reads. \
        Inputs and reference inputs appear in no particular order.
      ],
    ),
  ),
  (
    "12b-init-staging",
    vanilla_transaction(
      "Init on the staging track",
      inputs: (
        state_in(("any datum, unread": [the deploy datum `Constr 0 [0, 0]`]), forever: "reserve_staging_forever"),
        init_tokens_in("1"),
        funding,
        upgrade_state("Two-stage main", "main", reference: true, ("logic": [`reserve_logic`, not v2])),
        upgrade_state(
          "Two-stage staging",
          "staging",
          reference: true,
          ("logic": [`reserve_logic_v2`], "mitigation_logic": [`sml`]),
        ),
        (
          name: "Staging params",
          address: [`reserve_staging_params`],
          reference: true,
          value: (ada: "min UTxO", "reserve_staging_params token": "1"),
          datum: ("ReserveStagingParams": ""),
        ),
        night_ref("reserve_staging_forever", "test NIGHT"),
      ),
      outputs: (
        state_out(init_out, forever: "reserve_staging_forever"),
        (
          name: "Change",
          address: "deploying wallet",
          value: (ada: "rest", "reserve_logic_v2 \"main\"": "1"),
        ),
      ),
      mint: ("reserve_logic_v2 \"staging\" (BurnInitToken)": (qty: -1, variables: (:))),
      withdraws: ([`reserve_logic_v2`: 0, `Init`], [`sml`: 0, if `sml` $!=$ `#""`]),
      signatures: ([the deploying wallet's key],),
      notes: note[
        The same Init code as diagram 12a; only the token differs (user
        decision, 11-13). On the staging track (reserve_logic_v2 is staged,
        not yet on main) Init spends the wallet UTxO from diagram 10, which
        holds both init tokens, and burns `"staging"` against the staging
        test state, reserve_staging_forever's NFT. reserve_staging_forever
        needs the withdrawals of the two-stage staging state's `logic` and
        `mitigation_logic`; the staging params of diagram 11 name the forever
        script, the NIGHT policy and the destination. The main UpgradeState
        shown carries the old `logic`, which tells reserve_logic_v2 it runs on
        the staging track. The holder of the init tokens (the deployer)
        submits Init, once, after diagrams 16 and 11. \
        Output order (user decision, 11-17): the contract checks that the
        state output is outputs[0]; no later output may sit at
        reserve_staging_forever. The `"main"` token stays in the deployer's
        change until diagram 12a burns it; the contract checks nothing about
        it (user decision, 11-17). \
        #init_checks \
        Inputs and reference inputs appear in no particular order.
      ],
    ),
  ),
  (
    "13-release",
    vanilla_transaction(
      "Release one interval to the ICS",
      inputs: (
        state_in(state(c: [`c` > 0], paused: [`False`])),
        (
          name: "Reserve NIGHT",
          address: [`reserve_forever`],
          redeemer: [`0`, unread],
          value: (ada: [`a`], "NIGHT": [`n`]),
        ),
        (name: "Funding", address: "any wallet", value: (ada: "min UTxO + fee")),
        main_ref,
      ),
      outputs: (
        (
          name: "ICS",
          address: [`ics_forever`, no stake part],
          value: (ada: "min UTxO", "NIGHT": [`Δ`]),
          datum: ("inline": [any]),
        ),
        (
          name: "Reserve NIGHT",
          address: [`reserve_forever`, no stake part],
          value: (ada: [$>=$ `a`], "NIGHT": [`n − Δ`]),
          datum: ("none or inline": ""),
        ),
        state_out(state(
          c: [`c − Δ`],
          q: [`q + Δ`],
          s: [`s + release_interval_ms`],
          paused: [`False`],
        )),
        change,
      ),
      withdraws: ([`reserve_logic_v2`: 0, `Release`], mitigation),
      validRange: (
        lower: [`s + release_interval_ms`],
        upper: [`U` ($<=$ lower + `release_max_validity_window_ms`)],
      ),
      notes: note[
        PR 406, rules 1-8. Anyone may submit a release.
        `Δ = min(c, ⌈c × release_factor_n / release_factor_d⌉)`, with the constants from
        aiken.toml. The transaction spends one state input and one NIGHT
        input at reserve_forever. The NIGHT input holds only ADA and NIGHT
        (`cnight_policy`, `cnight_name`). The transaction spends no ICS UTxO,
        so the ICS gains exactly `Δ`. \
        Output order (user decision, 11-17): the contract checks the first
        three outputs by position: the ICS output, then the reserve NIGHT
        output, then the state output; change and any other outputs follow,
        and none of them may sit at the ICS or at reserve_forever. \
        Staging track: reserve_staging_forever replaces reserve_forever, and
        the two-stage staging UTxO and the staging params of diagram 11 join
        the reference inputs. The staging params name the NIGHT policy, the
        forever script and the destination. \
        open: the ICS output's datum; PR 406 leaves its encoding to
        activation. \
        Inputs and reference inputs appear in no particular order.
      ],
    ),
  ),
  ("14-pause", pause_tx("Pause releases", [`Pause`], [`True`])),
  ("15-unpause", pause_tx("Unpause releases", [`Unpause`], [`False`])),
  (
    "16-stage-logic",
    stage_tx(
      "Stage reserve_logic_v2",
      "Logic",
      "reserve_logic_v2",
      upgrade_datum(
        logic: [`reserve_logic_v2`],
        mitigation_logic: [`mls`],
        auth: [`staging_gov_auth`],
        mitigation_auth: [`sma`],
        round: [`rs`],
        logic_round: [`lrs + 1`],
      ),
      [
        Two-stage upgrade, stage. The new hash is 28 bytes. Only `logic` and
        `logic_round` change. The staging output must be the first output at
        reserve_two_stage and keep its token; no script checks its ADA.
        Either the staging `auth` (staging_gov_auth, plus `sma` when set)
        runs, or the main `auth` and `mitigation_auth` run (the recovery
        path). staging_gov_auth checks staging_gov_threshold, or
        main_gov_threshold when staging_gov_auth is the `auth` on the
        council two-stage main UTxO.
      ],
    ),
  ),
  (
    "17-promote-logic",
    promote_tx(
      "Promote reserve_logic_v2 to main",
      "Logic",
      upgrade_datum(logic: [`reserve_logic`], auth: [`main_gov_auth`]),
      upgrade_datum(logic: [`reserve_logic_v2`], auth: [`main_gov_auth`], logic_round: [`lrs + 1`]),
      ("logic": [`reserve_logic_v2`], "logic_round": [`lrs + 1`]),
      [
        Two-stage upgrade, promote. main_gov_auth (the main `auth`) and the
        main `mitigation_auth` (when set) run. `logic` and `logic_round`
        come from the staging UTxO; every other field stays. The main output
        must be the first output at reserve_two_stage. After this promote,
        every spend of the reserve forever needs a reserve_logic_v2
        withdrawal, so reserve_logic stops; diagram 12a comes next.
      ],
    ),
  ),
  (
    "18-stage-freeze",
    stage_tx(
      "Stage the freeze",
      "MitigationAuth",
      "always_fails",
      upgrade_datum(
        logic: [`ls`],
        mitigation_logic: [`mls`],
        auth: [`staging_gov_auth`],
        mitigation_auth: [`always_fails`],
        round: [`rs + 1`],
        logic_round: [`lrs`],
      ),
      [
        PR 406, Freeze: within 90 days of `release_anchor_posix_ms`, the
        two-stage `mitigation_auth` must become always_fails. This stage
        runs only while the main `mitigation_auth` is `#""`, and on the
        staging branch needs staging_gov_auth alone. Only `mitigation_auth`
        and `round` change.
      ],
    ),
  ),
  (
    "19-promote-freeze",
    promote_tx(
      "Promote the freeze",
      "MitigationAuth",
      upgrade_datum(logic: [`reserve_logic_v2`], auth: [`main_gov_auth`], mitigation_auth: [`#""`]),
      upgrade_datum(logic: [`reserve_logic_v2`], auth: [`main_gov_auth`], mitigation_auth: [`always_fails`], round: [`rs + 1`]),
      ("mitigation_auth": [`always_fails`], "round": [`rs + 1`]),
      [
        PR 406, Freeze. This promote runs only while the main
        `mitigation_auth` is `#""`, so main_gov_auth alone runs. Afterwards
        every promote needs an always_fails withdrawal and fails, so the
        main logic is fixed for good. Every stage fails too. The staging
        branch needs the staging `mitigation_auth`, always_fails since
        diagram 18; a `MitigationAuth` stage skips that check but needs the
        main `mitigation_auth` still `#""`. The main branch needs the main
        `mitigation_auth`, now always_fails. Pause and unpause (diagrams 14
        and 15) need the main `mitigation_auth` too, through
        `validate_running`, so after the freeze no one can pause the reserve:
        once tested, the reserve logic is permanent and independent of
        governance, and a rogue governance session cannot stop releases (user
        decision, 11-17).
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
