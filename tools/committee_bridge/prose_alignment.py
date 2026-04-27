from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

from .extractor import build_extraction_bundle
from .model import OpenQuestion, write_json
from .paths import REPO_ROOT
from .relations import canonicalize_claims


@dataclass(frozen=True, slots=True)
class AlignmentCheck:
    check_id: str
    path: str
    pattern: str
    status_if_present: str
    status_if_missing: str
    rationale: str
    supporting_claim_ids: tuple[str, ...] = ()
    related_open_question_ids: tuple[str, ...] = ()
    flags: int = re.MULTILINE


ALIGNMENT_CHECKS: tuple[AlignmentCheck, ...] = (
    AlignmentCheck(
        check_id="validators.scope-narrowing",
        path="spec/validators.md",
        pattern=r"does not claim generic block validation or generic cross-chain message passing",
        status_if_present="supported",
        status_if_missing="missing",
        rationale="The committee-bridge section must keep the bridge boundary narrow.",
        supporting_claim_ids=(
            "validator.logic.committee-state-transition-only",
            "beefy.protocol-is-bridge-oriented",
        ),
    ),
    AlignmentCheck(
        check_id="validators.committee-update-proof-path",
        path="spec/validators.md",
        pattern=r"verify a BEEFY-backed committee update proof against the trusted input state, referenced threshold datum, and explicit output state",
        status_if_present="supported",
        status_if_missing="missing",
        rationale="The main validator path should be described as committee-update verification against trusted input/output state and threshold data.",
        supporting_claim_ids=(
            "validator.logic.committee-state-transition-only",
        ),
    ),
    AlignmentCheck(
        check_id="validators.current-or-next-authority-set",
        path="spec/validators.md",
        pattern=r"must match either `current_authority_set\.id` or `next_authority_set\.id`",
        status_if_present="supported",
        status_if_missing="missing",
        rationale="The prose should preserve the current-or-next authority-set selection boundary.",
        supporting_claim_ids=(
            "bridge.verify-consensus.current-or-next-validator-set",
        ),
    ),
    AlignmentCheck(
        check_id="validators.next-committee-payload-hash",
        path="spec/validators.md",
        pattern=r"must equal `keccak256\(scale_encode_beefy_mmr_leaf\(latest_mmr_leaf\)\)`",
        status_if_present="supported",
        status_if_missing="missing",
        rationale="The prose should retain the exact payload-hash check for the next-committee payload.",
        supporting_claim_ids=(
            "bridge.verify-consensus.payload-must-hash-latest-leaf",
        ),
    ),
    AlignmentCheck(
        check_id="validators.current-signature-path",
        path="spec/validators.md",
        pattern=r"ECDSA/secp256k1",
        status_if_present="supported",
        status_if_missing="missing",
        rationale="The current signature verification path should remain explicitly bounded to ECDSA/secp256k1.",
        supporting_claim_ids=(
            "bridge.verify-consensus-signatures-use-secp256k1",
        ),
    ),
    AlignmentCheck(
        check_id="validators.fixed-threshold-wording",
        path="spec/validators.md",
        pattern=r"ceil\(total_stake \* numerator / denominator\)",
        status_if_present="open-question",
        status_if_missing="supported",
        rationale="Exact local threshold arithmetic wording should stay out of normative prose until the rounding wording is explicitly resolved.",
        supporting_claim_ids=(
            "bridge.verify-consensus.threshold-is-configurable",
        ),
        related_open_question_ids=(
            "bridge.threshold-rounding-semantics-not-yet-worded",
        ),
    ),
    AlignmentCheck(
        check_id="validators.no-update-on-rejection-wording",
        path="spec/validators.md",
        pattern=r"no valid committee-bridge update occurs",
        status_if_present="open-question",
        status_if_missing="supported",
        rationale="The current code strongly suggests rejection on failure, but the wording should remain out of normative prose until the exact operational boundary is carried through the evidence package or explicit user decision rows.",
        supporting_claim_ids=(
            "bridge.verify-consensus.output-state-must-match-derived-state",
        ),
        related_open_question_ids=(
            "tests.no-negative-proof-rejection-coverage",
        ),
    ),
    AlignmentCheck(
        check_id="validators.no-vote-index-claim",
        path="spec/validators.md",
        pattern=r"authority_index|vote_strength",
        status_if_present="broader-than-supported",
        status_if_missing="supported",
        rationale="The docs must not claim `Vote.authority_index` or `Vote.vote_strength` are active acceptance checks.",
        supporting_claim_ids=(
            "bridge.acceptance-path-does-not-read-vote-index-or-strength",
        ),
    ),
    AlignmentCheck(
        check_id="validators.no-fixed-two-thirds-claim",
        path="spec/validators.md",
        pattern=r"2/3|2N/3|two-thirds|2/3rd",
        status_if_present="broader-than-supported",
        status_if_missing="supported",
        rationale="The repository path reads a configurable `BeefyThreshold`; the docs must not restate a fixed local two-thirds threshold.",
        supporting_claim_ids=(
            "bridge.verify-consensus.threshold-is-configurable",
        ),
    ),
    AlignmentCheck(
        check_id="upgrade.architecture-only-disclaimer",
        path="spec/upgrade.md",
        pattern=r"do not define .*runtime validation semantics",
        status_if_present="supported",
        status_if_missing="missing",
        rationale="The upgrade overview should remain architecture-only and avoid serving as runtime semantics proof for the committee bridge.",
        supporting_claim_ids=(
            "beefy.protocol-is-bridge-oriented",
        ),
    ),
)


def _line_span(text: str, start: int, end: int) -> str:
    start_line = text[:start].count("\n") + 1
    end_line = text[:end].count("\n") + 1
    return f"{start_line}-{end_line}"


def _first_match(text: str, check: AlignmentCheck) -> tuple[str | None, str | None]:
    match = re.search(check.pattern, text, check.flags)
    if not match:
        return None, None
    return match.group(0), _line_span(text, match.start(), match.end())


def build_prose_alignment_report() -> dict[str, object]:
    bundle = build_extraction_bundle()
    claim_ids = {claim.claim_id for claim in canonicalize_claims(bundle)}
    question_ids = {question.question_id for question in bundle.open_questions}

    findings: list[dict[str, object]] = []
    for check in ALIGNMENT_CHECKS:
        text = (REPO_ROOT / check.path).read_text()
        snippet, line_span = _first_match(text, check)
        status = check.status_if_present if snippet is not None else check.status_if_missing
        for claim_id in check.supporting_claim_ids:
            if claim_id not in claim_ids:
                raise ValueError(f"Unknown supporting claim ID in alignment check {check.check_id}: {claim_id}")
        for question_id in check.related_open_question_ids:
            if question_id not in question_ids:
                raise ValueError(f"Unknown open-question ID in alignment check {check.check_id}: {question_id}")

        findings.append(
            {
                "check_id": check.check_id,
                "path": check.path,
                "status": status,
                "line_span": line_span,
                "matched_text": snippet,
                "rationale": check.rationale,
                "supporting_claim_ids": list(check.supporting_claim_ids),
                "related_open_question_ids": list(check.related_open_question_ids),
            }
        )

    return {"findings": findings}

def run_prose_alignment(output_dir: Path) -> dict[str, Path]:
    payload = build_prose_alignment_report()
    output_dir.mkdir(parents=True, exist_ok=True)
    written = {
        "prose_alignment_report": write_json(
            output_dir / "prose-alignment-report.json",
            payload,
        )
    }
    summary = {
        "finding_count": len(payload["findings"]),
        "status_counts": {
            status: sum(1 for finding in payload["findings"] if finding["status"] == status)
            for status in sorted({finding["status"] for finding in payload["findings"]})
        },
    }
    written["summary"] = write_json(output_dir / "summary.json", summary)
    return written


__all__ = ["build_prose_alignment_report", "run_prose_alignment"]
