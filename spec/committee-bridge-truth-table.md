# Committee Bridge Truth Table Specification

## Purpose

This file defines the required truth-table projection for the BEEFY-backed committee bridge.

The truth table is not the canonical storage format. The normalized claim table defined in `spec/committee-bridge-doc-generation.md` remains canonical.

The truth table exists to present the bridge boundary in a form auditors and writers can verify at a glance.

## Derivation Rule

Every swarm run must derive this truth table from the normalized claim table.

Swarm must not author the truth table from memory, existing prose, or unstated protocol intuition. Every row must be traceable back to claim rows and their cited sources.

## Required Columns

Each truth-table row must contain:
- `statement`
- `status` (`confirmed`, `not-supported`, `prohibited-claim`, `open-question`)
- `why`
- `primary_evidence`
- `notes`

## Status Semantics

- `confirmed`: the statement is supported by admissible evidence and may appear in bounded prose
- `not-supported`: admissible evidence does not support the statement as written
- `prohibited-claim`: the statement is outside allowed bridge scope or would overstate guarantees even if some nearby facts are true
- `open-question`: the available evidence is incomplete or conflicting, so the row cannot be classified more strongly

If a row cannot be classified cleanly, it must stay `open-question`. Swarm must not force a stronger answer than the evidence allows.

## Minimum Required Statements

At minimum, the truth table must include rows for whether the bridge:
- validates blocks
- validates committee updates
- maintains or updates committee state
- performs generic cross-chain message passing
- derives future trusted committee data from accepted proof material
- implies broader finality or chain correctness than the cited sources support

Additional rows may be added when needed, but they must preserve the same evidence discipline.

## Evidence Rules

For each row:
- `why` must explain the classification in bounded language
- `primary_evidence` must cite the strongest supporting or rejecting source location
- `notes` must capture caveats, source conflicts, or wording constraints

If evidence conflicts across code, tests, or upstream protocol sources, the row must remain `open-question` until the conflict is reconciled explicitly.

## Usage Rules

The truth table is a projection for:
- auditor review
- writer guardrails
- top-level scope verification
- red-team review against overstated guarantees

It must not replace the normalized claim table. It is a reader-facing summary over the same evidence set.

## Deliverable Requirement

A swarm run under `spec/committee-bridge-doc-generation.md` is incomplete unless it produces this truth table alongside the normalized claim table and contradiction reports.
