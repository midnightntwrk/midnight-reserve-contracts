# Committee Bridge Tooling

This directory holds the repo-local tooling pipeline for regenerating source-backed documentation evidence for the BEEFY-backed committee bridge.

Pipeline order:
1. `contract.json` declares the curated committee-bridge claim and open-question set that this tooling is allowed to materialize.
2. `extractor.py` reads the declared contract, then attaches admissible repository and upstream snippets/locations to produce source-backed claim rows.
3. `schema/contract.schema.json`, `model.py`, and `schema/claim-row.schema.json` define the reviewable contract/input shape and the canonical normalized claim row shape.
4. `relations.py` turns extracted rows into the deterministic canonical claim store with explicit relation edges.
5. `truth_table.py` derives the reader-facing truth table from the canonical claim store.
6. `z3_checks.py` loads semantic assertions carried by the canonical claim store and forbidden-inference rules declared in `contract.json`.
7. `prose_alignment.py` compares `spec/validators.md` and `spec/upgrade.md` against the canonical claim store and checker rules.
8. `pyswip/` is reserved for an optional read-only query layer over the canonical claim store. It is intentionally secondary to the Python + Z3 pipeline and may remain deferred.

Canonical artifact:
- `committee-bridge-artifacts/final/normalized-claim-table.json`

Other committed review artifacts:
- `committee-bridge-artifacts/final/truth-table.json`
- `committee-bridge-artifacts/final/contradiction-report.json`
- `committee-bridge-artifacts/final/prose-alignment-report.json`
- `committee-bridge-artifacts/final/open-questions.json`

Transient rerun scratch space:
- `build/committee-bridge/`

Run from the repo root with:
- `python3 -m tools.committee_bridge extract`
- `python3 -m tools.committee_bridge canonicalize`
- `python3 -m tools.committee_bridge truth-table`
- `python3 -m tools.committee_bridge z3-checks`
- `python3 -m tools.committee_bridge prose-alignment`
- `python3 -m tools.committee_bridge verify`

Reference-only prior swarm outputs:
- `swarm/committee-bridge-docs/workspace/outputs/final/`

The tooling in this directory must keep the bridge boundary narrow: committee-state / authority-set transition verification only. It must not broaden the bridge into generic block validation, generic cross-chain message passing, or stronger finality / trust claims than admissible evidence supports.
