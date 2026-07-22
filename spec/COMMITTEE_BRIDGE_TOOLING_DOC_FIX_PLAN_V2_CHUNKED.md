# Committee Bridge Tooling Doc Fix Plan V2 — Chunked Checklist

This plan is an execution checklist derived from the recovered March 15–16 `COMMITTEE_BRIDGE_TOOLING_DOC_FIX_PLAN_V2.md`.

It keeps the same implementation order:
1. fresh claim extraction
2. canonical claim store with relations
3. Python checker pipeline with Z3
4. optional PySwip query layer
5. documentation rewrites driven by tooling outputs

The difference is execution format: this file breaks the work into small, human-readable, diffable chunks. After each chunk, stop, verify, then cut a `jj` changeset boundary so each step can be reviewed independently later.

## Working Rules

- Base this work on admissible evidence only: repository code, relevant tests, upstream BEEFY material, and upstream GRANDPA material only where needed.
- Existing prose is a drift target, not a truth source.
- Keep `spec/committee-bridge-doc-generation.md` as the process source of truth and use this file as the execution checklist.
- Keep the canonical system noun as `BEEFY-backed committee bridge`.
- Keep the bridge boundary narrow: committee-state / authority-set transition verification, not generic block validation and not generic cross-chain message passing.
- Z3 is the primary contradiction / forbidden-inference checker.
- PySwip is optional and secondary. It must query the canonical normalized claim dataset rather than become a second truth source.
- Prefer chunks that touch a small number of files and produce one clear reviewable outcome.
- Do not combine two conceptual steps into one commit just because they are convenient to code together.

## Repository Placement Guidance

Use repo-local paths so the pipeline is easy to rerun and inspect later. A reasonable structure is:
- `tools/committee_bridge/` for Python tooling
- `tools/committee_bridge/schema/` for schemas or rule definitions
- `swarm/committee-bridge-docs/workspace/outputs/final/` as an input reference only
- `spec/` for process specs and final prose targets
- `artifacts/committee_bridge/` or another explicit repo-local output directory for regenerated claim/check outputs, if checked in

If the actual implementation chooses different paths, keep the same chunk boundaries below.

## Definition Of Done

The plan is complete only when all of the following are true:
- a fresh extractor regenerates committee-bridge claims from admissible sources
- the canonical claim store is deterministic and relation-aware
- a derived truth table is produced from the canonical claim store
- the Python checker emits source-backed contradiction / forbidden-inference / prose-alignment outputs
- Z3 diagnostics map back to concrete claim IDs or rule IDs
- any PySwip layer is optional and strictly secondary
- `spec/validators.md` and `spec/upgrade.md` are rewritten from tooling outputs, not hand-wavy paraphrase
- rerunning the tooling against the rewritten docs removes the targeted overclaims

## Chunk 1 — Lock Down Scope And File Layout

### Goal
Choose the repo-local layout for the committee-bridge tooling and outputs before writing extractor or checker logic.

### Why This Is Its Own Chunk
Without explicit paths, later chunks sprawl and mix architecture decisions with implementation. This chunk keeps the rest of the work diffable.

### Work
- Re-read:
  - `spec/committee-bridge-doc-generation.md`
  - `spec/committee-bridge-truth-table.md`
  - current committee-bridge prose in `spec/validators.md`
  - current overview text in `spec/upgrade.md`
- Choose exact repo-local paths for:
  - extractor code
  - claim schema / model definitions
  - relation-building logic
  - Z3 rule/check logic
  - prose-alignment logic
  - generated outputs
  - optional PySwip integration
- Write a short repo-local README or module docstring in the tooling directory that explains the pipeline order and the canonical artifact.

### Deliverable
A minimal scaffolding commit that establishes the tooling directory structure and documents the intended data flow.

### Done When
- another engineer can tell where each later chunk will land
- the canonical artifact location is explicit
- the optional PySwip location is explicit but empty or clearly deferred

### Suggested `jj` Cut
- `jj commit -m "Scaffold committee bridge tooling pipeline"`
- `jj new`

## Chunk 2 — Fresh Claim Extractor

### Goal
Build a fresh extractor that reads admissible committee-bridge evidence and emits normalized claim rows with stable IDs and exact source anchors.

### Work
- Implement extraction from the committee-bridge code paths first:
  - `validators/committee_bridge.ak`
  - relevant helpers under `lib/bridge/`
  - directly referenced types/helpers as needed
- Include support for user-decision rows where the March plan or later user clarifications must be encoded explicitly.
- Every row should carry at least:
  - `claim_id`
  - `claim_text`
  - `exact_quote_or_snippet`
  - `source_class`
  - `source_path_or_url`
  - `source_location`
  - `confidence`
  - `canonical_terms_used`
  - `prerequisites`
  - `exclusions_or_forbidden_inference`
  - `affected_sections`
  - `notes`
- Preserve open questions. Do not flatten uncertainty into fake certainty.

### Deliverable
A runnable extractor that emits a first-pass claim dataset from source evidence.

### Done When
- the extractor can be run from the repo root
- the output contains stable IDs and precise source anchors
- unresolved claims remain visible as unresolved

### Suggested `jj` Cut
- `jj commit -m "Add committee bridge claim extractor"`
- `jj new`

## Chunk 3 — Canonical Claim Store And Relation Graph

### Goal
Turn extractor output into the canonical normalized claim store with explicit relations.

### Work
- Define the canonical machine-readable format for the normalized claim table.
- Add explicit relation support such as:
  - `supports`
  - `contradicts`
  - `depends_on`
  - `duplicates`
  - `supersedes`
- Ensure the same underlying data can serve both row-oriented review and graph-oriented checks.
- Encode the user-approved substantive constraints from the recovered plan where appropriate, including:
  - ceiling threshold wording
  - explicit ECDSA/secp256k1 wording for the current path
  - next-committee payload / hashed SCALE-encoded latest MMR leaf wording
  - no unsupported claim that `Vote.authority_index` or `Vote.vote_strength` are active acceptance checks
  - malformed proof / payload transactions being rejected without producing a valid committee-bridge state update, stated only at the approved operational boundary

### Deliverable
A deterministic canonical claim artifact with relation edges.

### Done When
- repeated runs produce stable ordering and IDs
- relation edges exist in the artifact, not just in memory
- the artifact is diff-friendly enough to review in commits

### Suggested `jj` Cut
- `jj commit -m "Add canonical committee bridge claim store"`
- `jj new`

## Chunk 4 — Truth Table Projection

### Goal
Derive the required reader-facing truth table from the canonical claim store.

### Work
- Implement the projection described by `spec/committee-bridge-truth-table.md`.
- Produce rows for the minimum required bridge statements, including whether the bridge:
  - validates blocks
  - validates committee updates
  - maintains or updates committee state
  - performs generic cross-chain message passing
  - derives future trusted committee data from accepted proof material
  - implies broader finality or chain correctness than the cited sources support
- Ensure every truth-table row points back to the canonical claim store and its evidence.
- Keep the truth table explicitly derived, not hand-authored.

### Deliverable
A generated truth-table artifact with traceable rows.

### Done When
- the truth table is generated from the canonical dataset, not manually written
- each row has a bounded classification and evidence trail
- the truth table does not become a second canonical store

### Suggested `jj` Cut
- `jj commit -m "Add committee bridge truth table projection"`
- `jj new`

## Chunk 5 — Z3 Checker Core

### Goal
Add the primary machine checker for contradiction and forbidden-inference detection.

### Work
- Build the Python checker layer that loads the canonical claim artifact.
- Use Z3 as the primary engine.
- Add tracked assertions so reports can point back to concrete claim IDs and rule IDs.
- Implement at minimum:
  - unsupported-claim check
  - contradiction check
  - forbidden-inference check
- The forbidden-inference rules must especially guard against overclaims about:
  - generic block validation
  - generic bridging / message passing
  - stronger trust / honesty claims than evidence supports
  - broader finality or proof guarantees than evidence supports

### Deliverable
A runnable checker that emits machine-readable contradiction and forbidden-inference outputs.

### Done When
- unsat or conflict reports name the relevant claim IDs or rule IDs
- over-broad bridge claims are machine-detectable
- the checker can be rerun without hand-editing inputs

### Suggested `jj` Cut
- `jj commit -m "Add Z3 committee bridge consistency checks"`
- `jj new`

## Chunk 6 — Prose Alignment Checker

### Goal
Compare the current docs against the canonical claim store so doc edits are driven by reports instead of intuition.

### Work
- Add prose-alignment checks at least for:
  - `spec/validators.md`
  - `spec/upgrade.md`
- Emit statuses such as:
  - `supported`
  - `missing`
  - `broader-than-supported`
  - `contradicted`
  - `open-question`
- Keep the alignment reports scoped to the committee-bridge surface so the first pass does not balloon into unrelated spec cleanup.

### Deliverable
A machine-readable alignment report for the current committee-bridge prose.

### Done When
- the report identifies exactly where current prose is too broad
- the report is narrow enough to drive targeted doc rewrites
- the report distinguishes unsupported wording from unresolved open questions

### Suggested `jj` Cut
- `jj commit -m "Add committee bridge prose alignment reports"`
- `jj new`

## Chunk 7 — Optional PySwip Query Layer

### Goal
Add optional Prolog-like query ergonomics without changing the canonical truth model.

### Work
- Add PySwip only after chunks 2 through 6 work.
- Expose convenience queries over the normalized claim dataset and relation edges.
- Keep PySwip read-oriented: query the canonical dataset, do not redefine truth in a separate rule base that can drift.
- Keep this chunk isolated enough that it can be omitted entirely if it adds dependency pain without enough review value.

### Deliverable
An optional query layer that helps inspect the canonical dataset.

### Done When
- PySwip is clearly secondary to the Python + Z3 pipeline
- the canonical artifact remains the sole source of truth
- the project still works cleanly if this layer is skipped or deferred

### Suggested `jj` Cut
- `jj commit -m "Add optional PySwip committee bridge queries"`
- `jj new`

## Chunk 8 — Rewrite `spec/validators.md`

### Goal
Use the generated reports to rewrite the committee-bridge section in `spec/validators.md`.

### Work
- Tighten the opening framing so it is explicitly about committee-state / authority-set transition verification.
- Remove wording that implies:
  - generic block validation
  - generic cross-chain message passing
  - stronger trust or finality guarantees than evidence supports
- Preserve source-backed anchors such as:
  - current or next authority-set selection depending on `validator_set_id`
  - next-committee payload check against the hashed SCALE-encoded latest MMR leaf
  - ECDSA/secp256k1 signature verification in the current path
  - equality check between derived state and output state
- Keep GRANDPA constrained to prerequisite/background context only where needed.
- Do not claim that `Vote.authority_index` or `Vote.vote_strength` are active acceptance checks unless the evidence has changed.

### Deliverable
A rewritten committee-bridge section in `spec/validators.md` driven by the alignment and checker outputs.

### Done When
- the section is narrower and more precise
- the section no longer overstates bridge scope
- every normative statement is traceable to claim rows or explicit user decisions

### Suggested `jj` Cut
- `jj commit -m "Rewrite committee bridge validator spec from reports"`
- `jj new`

## Chunk 9 — Tighten `spec/upgrade.md`

### Goal
Fix the top-level overview text in `spec/upgrade.md` so it stays an architecture statement and does not accidentally serve as behavioral proof for committee-bridge semantics.

### Work
- Reword only the parts that over-generalize the committee bridge.
- Preserve the valid shared forever / two-stage / logic upgrade architecture description.
- Keep this chunk narrowly scoped. Do not let it expand into repo-wide prose cleanup.

### Deliverable
A bounded `spec/upgrade.md` correction that removes committee-bridge overclaim risk.

### Done When
- `spec/upgrade.md` remains correct as upgrade architecture documentation
- it no longer reads as evidence for broader bridge runtime semantics
- the diff stays small and easy to review

### Suggested `jj` Cut
- `jj commit -m "Tighten committee bridge upgrade overview wording"`
- `jj new`

## Chunk 10 — Regenerate And Recheck

### Goal
Prove the rewritten docs are now aligned with the generated evidence package.

### Work
- Rerun the extractor, canonicalization, truth-table generation, Z3 checks, and prose-alignment checks.
- Confirm the targeted overclaims are gone from:
  - `spec/validators.md`
  - `spec/upgrade.md`
- If any necessary sentence still depends on unresolved evidence, stop and surface it explicitly instead of guessing.

### Deliverable
A final verification pass with regenerated outputs showing the target drift was removed.

### Done When
- the checker and alignment outputs reflect the updated docs
- no targeted committee-bridge overclaim remains
- remaining gaps, if any, are explicit open questions rather than silent guesses

### Suggested `jj` Cut
- `jj commit -m "Verify committee bridge docs against regenerated checks"`
- `jj new`

## Review Order

If reviewing later, review in this order:
1. chunk 1 for architecture sanity
2. chunks 2 through 4 for artifact correctness
3. chunks 5 and 6 for checker truthfulness
4. chunk 7 only if PySwip is actually added
5. chunks 8 and 9 for prose quality and boundary discipline
6. chunk 10 for proof that the pipeline catches the intended doc drift

## Explicit Non-Goals For The First Pass

- no repo-wide documentation cleanup
- no making PySwip canonical
- no replacing Z3 with a Prolog-like engine
- no hand-authored truth table disconnected from claim rows
- no broadening the bridge into generic block validation or generic message passing
- no undocumented compatibility layer between two competing truth representations
