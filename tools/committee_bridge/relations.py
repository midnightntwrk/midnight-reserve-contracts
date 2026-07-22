from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from .extractor import build_extraction_bundle
from .model import ClaimRow, ExtractionBundle, write_json


RELATION_OVERRIDES: dict[str, dict[str, tuple[str, ...]]] = {
    "validator.logic.committee-state-transition-only": {
        "depends_on": (
            "bridge.verify-consensus.current-or-next-validator-set",
            "bridge.verify-consensus.threshold-is-configurable",
            "bridge.verify-consensus.requires-next-committee-payload",
            "bridge.verify-consensus.payload-must-hash-latest-leaf",
            "bridge.verify-consensus-derives-next-committee-from-leaf",
            "bridge.verify-consensus.output-state-must-match-derived-state",
        ),
    },
    "bridge.verify-consensus.output-state-must-match-derived-state": {
        "supports": (
            "validator.logic.committee-state-transition-only",
        ),
    },
    "bridge.verify-consensus.current-or-next-validator-set": {
        "supports": (
            "validator.logic.committee-state-transition-only",
        ),
    },
    "bridge.verify-consensus.threshold-is-configurable": {
        "supports": (
            "validator.logic.committee-state-transition-only",
        ),
    },
    "bridge.verify-consensus.requires-next-committee-payload": {
        "supports": (
            "validator.logic.committee-state-transition-only",
            "bridge.verify-consensus-derives-next-committee-from-leaf",
        ),
    },
    "bridge.verify-consensus.payload-must-hash-latest-leaf": {
        "supports": (
            "validator.logic.committee-state-transition-only",
            "bridge.verify-consensus-derives-next-committee-from-leaf",
        ),
        "depends_on": (
            "bridge.verify-consensus.requires-next-committee-payload",
        ),
    },
    "bridge.verify-consensus-signatures-use-secp256k1": {
        "supports": (
            "validator.logic.committee-state-transition-only",
        ),
    },
    "bridge.verify-consensus-derives-next-committee-from-leaf": {
        "supports": (
            "validator.logic.committee-state-transition-only",
        ),
        "depends_on": (
            "bridge.verify-consensus.payload-must-hash-latest-leaf",
        ),
    },
    "bridge.acceptance-path-does-not-read-vote-index-or-strength": {
        "depends_on": (
            "bridge.vote-type-includes-index-and-strength",
        ),
    },
    "test.beefy-helper-aggregate-stake-positive-case": {
        "supports": (
            "bridge.verify-consensus-signatures-use-secp256k1",
        ),
    },
    "test.beefy-helper-secp256k1-positive-case": {
        "supports": (
            "bridge.verify-consensus-signatures-use-secp256k1",
        ),
    },
    "beefy.protocol-is-bridge-oriented": {
        "supports": (
            "validator.logic.committee-state-transition-only",
        ),
    },
    "beefy.runs-alongside-grandpa-on-finalized-chain": {
        "depends_on": (
            "grandpa.provides-provable-finality-background",
        ),
        "supports": (
            "beefy.protocol-is-bridge-oriented",
        ),
    },
    "beefy.initial-path-uses-secp256k1-and-keccak": {
        "supports": (
            "bridge.verify-consensus-signatures-use-secp256k1",
        ),
    },
    "grandpa.provides-provable-finality-background": {
        "supports": (
            "beefy.runs-alongside-grandpa-on-finalized-chain",
        ),
    },
}

RELATION_FIELDS = (
    "supports",
    "contradicts",
    "depends_on",
    "supersedes",
    "duplicates",
)


def _sorted_unique(values: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(sorted(set(values)))


def canonicalize_claims(bundle: ExtractionBundle) -> tuple[ClaimRow, ...]:
    claim_ids = {claim.claim_id for claim in bundle.claims}
    canonical_claims: list[ClaimRow] = []

    for claim in bundle.claims:
        overrides = RELATION_OVERRIDES.get(claim.claim_id, {})
        relation_payload: dict[str, tuple[str, ...]] = {}
        for field in RELATION_FIELDS:
            values = tuple(overrides.get(field, ()))
            unknown = sorted(set(values) - claim_ids)
            if unknown:
                raise ValueError(
                    f"Claim {claim.claim_id} references unknown {field} IDs: {unknown}"
                )
            relation_payload[field] = _sorted_unique(values)
        canonical_claims.append(replace(claim, **relation_payload))

    return tuple(sorted(canonical_claims, key=lambda claim: claim.claim_id))


def canonical_claims_payload(claims: tuple[ClaimRow, ...]) -> list[dict[str, object]]:
    payload: list[dict[str, object]] = []
    for claim in claims:
        row = claim.to_dict()
        for field in RELATION_FIELDS:
            row.setdefault(field, [])
        payload.append(row)
    return payload


def run_canonicalization(output_dir: Path) -> dict[str, Path]:
    bundle = build_extraction_bundle()
    canonical_claims = canonicalize_claims(bundle)
    output_dir.mkdir(parents=True, exist_ok=True)

    written = {
        "normalized_claim_table": write_json(
            output_dir / "normalized-claim-table.json",
            canonical_claims_payload(canonical_claims),
        ),
        "open_questions": write_json(
            output_dir / "open-questions.json",
            bundle.open_questions_payload(),
        ),
    }
    summary = {
        "claim_count": len(canonical_claims),
        "open_question_count": len(bundle.open_questions),
        "relation_counts": {
            field: sum(1 for claim in canonical_claims if getattr(claim, field))
            for field in RELATION_FIELDS
        },
    }
    written["summary"] = write_json(output_dir / "summary.json", summary)
    return written


__all__ = ["canonical_claims_payload", "canonicalize_claims", "run_canonicalization"]
