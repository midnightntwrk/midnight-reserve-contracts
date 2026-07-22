# BEEFY-Backed Committee Bridge Documentation Generation Spec

## Purpose

This document specifies how Oh My Pi swarm must be used to generate accurate, cross-section-consistent documentation for the BEEFY-backed committee bridge.

The goal is not broad explanation quality. The goal is factual discipline:
- no unsupported claim survives
- no cross-section contradiction survives
- no wording silently broadens the bridge into block validation or generic bridging
- every normative statement is traceable to a concrete source location or to an explicit user decision

For this topic, swarm is an evidence-extraction and reconciliation system. It is not the final author.

## Scope Of This Spec

This is a process spec first.

A swarm run under this spec must stop after producing a reconciled evidence package and consistency reports. A single writer produces the canonical prose afterward.

The immediate output of the process is therefore:
1. a source-backed claim set
2. contradiction and drift reports
3. open questions requiring user resolution
4. optional section-coverage checks once a draft exists

It is not acceptable for swarm to draft parallel prose sections and then hope a merge pass will make them consistent.

## Canonical System Framing

Use the following as the canonical naming and framing baseline unless repository evidence forces a narrower statement:

- Canonical system noun: `BEEFY-backed committee bridge`
- The bridge is a committee bridge.
- BEEFY is the underlying proof/finality protocol whose commitments the bridge consumes.
- GRANDPA may appear in prerequisites or protocol-background material, but must not become the organizing frame of the main bridge flow unless a specific section requires it and cites the need.

The following interview-approved orientation statements may guide extraction and later prose organization, but they are not themselves evidence:
- the signed commitment contains payload data from which the next trusted committee is derived
- the bridge should not imply stronger truth than: a threshold of the expected committee signed the commitment
- if proof verification succeeds but bridge-specific transition conditions fail, the update is rejected in full and no on-chain state changes occur

Any stronger statement still requires source-backed confirmation.

## Evidence Policy

### Admissible Evidence

Swarm may treat the following as admissible evidence for factual claims:

1. Repository code implementing the committee bridge, including at minimum:
   - `validators/committee_bridge.ak`
   - relevant helpers under `lib/bridge/`
   - directly referenced shared types and helpers
2. Repository tests that exercise committee-bridge behavior
3. Upstream BEEFY protocol documentation where bridge behavior depends on BEEFY semantics
4. Upstream GRANDPA protocol documentation only where necessary to explain protocol prerequisites or terminology the bridge depends on

### Non-Admissible Evidence

The following are not admissible as factual proof:
- existing repository prose, including this file and other spec text
- prior generated summaries
- agent paraphrases
- user interview language, except where the user is explicitly resolving an ambiguity

Existing prose may still be used in two ways:
1. as a search aid for locating code/tests/protocol sources
2. as material to compare against extracted facts for drift detection

### Evidence Failure Rule

If a claim cannot be tied to a concrete source location, it is unresolved.

Swarm must not normalize, smooth over, or silently keep such a claim. It must:
- mark the claim unresolved
- exclude it from normative prose
- escalate it through the ask tool if the missing claim is important enough that the user should decide wording or scope

## Oh My Pi Swarm Operating Model

The swarm operating model for this work is:
1. parallel evidence extraction
2. explicit cross-checking and contradiction detection
3. user escalation where necessary
4. single-writer synthesis after reconciliation

Swarm must not perform final multi-author prose generation for this topic.

### Reader Agents

Each reader agent owns a small, explicit source set and extracts facts only.

Reader tasks must be partitioned by source domain, not by prose section. Recommended partitions are:
- validator entry points
- bridge helpers and data types
- committee-bridge-related tests
- upstream BEEFY protocol sources
- upstream GRANDPA prerequisite sources, if needed
- existing prose drift checker

Each reader agent must output only source-backed facts, exact snippets, and open questions.

### Cross-Check Agent

A dedicated cross-check step must compare reader outputs and identify:
- unsupported claims
- contradictions
- terminology drift
- same-term different-boundary problems
- places where current prose says more than code/tests/protocol sources support
- places where sources support a claim but current prose omits it

### User Escalation

When the swarm cannot reconcile a claim from admissible sources, it must ask the user directly with the ask tool.

Escalation is required for:
- missing but necessary claims
- source conflicts that cannot be reconciled conservatively
- terminology choices that affect multiple sections
- any point where a writer would otherwise invent connective tissue

### Single Writer Boundary

After cross-checking and user escalations are complete, one writer produces the canonical prose.

That writer may not introduce new factual claims unless they come from:
- a claim already present in the reconciled evidence package, or
- a direct user answer captured during escalation

## Canonical Intermediate Artifact

The canonical intermediate artifact should be a normalized claim table with explicit relations, so it can be consumed both as a deterministic row-based matrix and as a claim graph.

For this project, that is a better fit than a pure Prolog-style rule base alone.

Reason:
- swarm extraction naturally produces rows of evidence-backed claims
- the writer needs a deterministic traceability surface
- contradiction detection and coverage checks can be compiled from the claim table without making the authoring process depend on logic-language fluency
- explicit relations preserve the graph structure needed for dependency, contradiction, and terminology-drift analysis

The claim table is the canonical storage format. Claim-graph views, traceability matrices, and coverage matrices are derived projections over the same facts.

### Required Claim Fields

Every claim row must include at minimum:
- `claim_id`
- `claim_text`
- `exact_quote_or_snippet`
- `source_class` (`code`, `test`, `upstream-beefy`, `upstream-grandpa`, `user-decision`)
- `source_path_or_url`
- `source_location`
- `confidence` (`confirmed`, `open-question`)
- `canonical_terms_used`
- `prerequisites`
- `exclusions_or_forbidden_inference`
- `affected_sections`
- `notes`

Optional relation fields may connect claims into a graph, such as:
- `supports`
- `contradicts`
- `depends_on`
- `supersedes`
- `duplicates`

### Recommended Checker Implementation

The best implementation direction from current research is a layered checker:
- store the canonical artifact as structured claim rows
- validate row shape and required fields with a structural schema layer such as JSON Schema or SHACL
- compile the rows plus policy rules into a Python-based Z3 checker
- use tracked assertions and unsat-core output to produce contradiction reports

This is preferred over relying on a Prolog-like engine as the primary implementation because the problem here is static consistency auditing, not dynamic rule execution.

A graph view, traceability matrix, or coverage matrix may be generated from the same underlying claim table.

### Required Truth Table Projection

Every swarm run must derive a separate truth table for top-level bridge claims as specified in `spec/committee-bridge-truth-table.md`.

The normalized claim table remains canonical. The truth table is a required projection over that same evidence and must be delivered with the rest of the swarm outputs.

## Required Machine Checks

Before a writer may trust the evidence package, the process must run these checks.

### 1. Unsupported Claim Check

Flag every claim that lacks a concrete source location.

### 2. Contradiction Check

Flag claims that cannot all be true at once under the current policy rules.

The output must identify the conflicting claim IDs and rules, not just say that a contradiction exists.

### 3. Forbidden Inference Check

Flag claims that overreach beyond the supported source material, especially any wording that upgrades:
- committee validation into general block validation
- committee-data bridging into generic cross-chain message passing
- a threshold signature check into stronger honesty or trust claims
- BEEFY proof verification into broader finality or security guarantees than the sources state

### 4. Terminology Consistency Check

Flag inconsistent use of:
- current / next / next-next committee terms
- bridge naming
- proof / commitment / payload / committee-update terms
- any term that changes the verification boundary between sections

### 5. Coverage Check

Once a draft exists, compare the canonical claim table against the draft and report:
- required claims not represented
- sections containing unsupported statements
- sections missing required caveats or exclusions

## Writer Rules

The single writer must obey all of the following.

1. No new factual claim without a claim row or explicit user decision.
2. Use `BEEFY-backed committee bridge` as the default system noun.
3. Keep BEEFY positioned as the underlying protocol the bridge consumes, not as the product name for the bridge.
4. Keep GRANDPA in prerequisites or tightly scoped background material unless a section has a cited reason to say more.
5. Preserve the boundary that the bridge is about committee-related validation and transition acceptance, not generic block validation.
6. If a source-backed statement says proof verification passed but transition conditions failed, describe the outcome as full rejection with no on-chain update.
7. Prefer exact, bounded verbs such as `verifies`, `checks`, `derives`, `rejects`, `updates`, `stores`, and `requires`.
8. If a transition between facts is not source-backed, leave the gap visible and escalate or mark it open.

## Current Prose Drift Review

Existing repo prose must be checked after extraction.

The drift review must identify:
- claims in existing prose that are unsupported by code/tests/upstream protocol sources
- claims in existing prose that use broader language than the evidence permits
- terminology mismatches
- sections that would need rewriting to align with the reconciled claim set

Because existing prose is not an admissible truth source, drift review is a correction pass, not a tie-breaker.

## Required Deliverables From A Swarm Run

A swarm run under this spec must produce:
1. source inventory by reader partition
2. normalized claim table
3. derived truth table for top-level bridge claims
4. contradiction report
5. terminology drift report
6. existing-prose drift report
7. open questions list
8. optional section-coverage report if a prose draft already exists

The swarm run stops there.

The next step after those deliverables is a single-writer authoring pass, not more swarm prose generation.

## Prohibited Process Failures

The process fails if any of the following happen:
- a normative claim in the draft cannot be traced back to a claim row or direct user resolution
- existing prose is treated as factual proof without a backing source location
- swarm agents silently reconcile conflicting claims instead of surfacing them
- the final draft broadens the system into generic block validation or generic bridging without explicit evidence
- cross-section terminology changes meaning without being called out
- a contradiction report says only that there is a problem without identifying the conflicting claims

## Acceptance Criteria

This process spec is satisfied when a future Oh My Pi swarm run can:
- extract committee-bridge facts in parallel from admissible sources
- surface unsupported or contradictory claims deterministically
- stop and ask the user when evidence is missing
- hand a single writer a reconciled, machine-checkable claim package
- enable a later draft to be checked mechanically against that package for consistency

If the process produces nice prose but cannot prove where its claims came from or whether its sections agree, it has failed.