from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .extractor import build_extraction_bundle
from .model import ClaimRow, OpenQuestion, write_json
from .relations import canonicalize_claims


@dataclass(frozen=True, slots=True)
class TruthTableRow:
    statement: str
    status: str
    why: str
    primary_evidence: str
    notes: str
    supporting_claim_ids: tuple[str, ...]
    related_open_question_ids: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        data: dict[str, object] = {
            "statement": self.statement,
            "status": self.status,
            "why": self.why,
            "primary_evidence": self.primary_evidence,
            "notes": self.notes,
            "supporting_claim_ids": list(self.supporting_claim_ids),
        }
        if self.related_open_question_ids:
            data["related_open_question_ids"] = list(self.related_open_question_ids)
        return data


def _claim_ref(claim: ClaimRow) -> str:
    return f"{claim.claim_id} @ {claim.source_location}"


def _question_ref(question: OpenQuestion) -> str:
    return question.question_id


def build_truth_table() -> tuple[TruthTableRow, ...]:
    bundle = build_extraction_bundle()
    claims = canonicalize_claims(bundle)
    claim_index = {claim.claim_id: claim for claim in claims}
    question_index = {question.question_id: question for question in bundle.open_questions}

    rows = (
        TruthTableRow(
            statement="The BEEFY-backed committee bridge validates blocks.",
            status="prohibited-claim",
            why="The admissible code path is bounded to committee-state / authority-set transition verification and output-state equality, while upstream BEEFY material supports bridge-oriented framing rather than generic block validation.",
            primary_evidence="; ".join(
                [
                    _claim_ref(claim_index["validator.logic.committee-state-transition-only"]),
                    _claim_ref(claim_index["bridge.verify-consensus.output-state-must-match-derived-state"]),
                    _claim_ref(claim_index["beefy.protocol-is-bridge-oriented"]),
                ]
            ),
            notes="Use narrower committee-update wording; do not broaden this path into generic block-validation semantics.",
            supporting_claim_ids=(
                "validator.logic.committee-state-transition-only",
                "bridge.verify-consensus.output-state-must-match-derived-state",
                "beefy.protocol-is-bridge-oriented",
            ),
        ),
        TruthTableRow(
            statement="The BEEFY-backed committee bridge validates committee updates.",
            status="confirmed",
            why="The validator loads trusted committee state, proposed output state, and threshold data, then accepts only when `verify_consensus` derives a matching output state from the proof using the current or next authority set.",
            primary_evidence="; ".join(
                [
                    _claim_ref(claim_index["validator.logic.committee-state-transition-only"]),
                    _claim_ref(claim_index["bridge.verify-consensus.current-or-next-validator-set"]),
                    _claim_ref(claim_index["bridge.verify-consensus.output-state-must-match-derived-state"]),
                ]
            ),
            notes="Confirmed from repository code. No admissible validator-entrypoint tests were found, so prose should stay close to the code boundary.",
            supporting_claim_ids=(
                "validator.logic.committee-state-transition-only",
                "bridge.verify-consensus.current-or-next-validator-set",
                "bridge.verify-consensus.output-state-must-match-derived-state",
            ),
            related_open_question_ids=(
                _question_ref(
                    question_index["tests.no-committee-bridge-validator-entrypoint-coverage"]
                ),
            ),
        ),
        TruthTableRow(
            statement="The BEEFY-backed committee bridge maintains or updates committee state.",
            status="confirmed",
            why="The accepted transition explicitly produces a `BeefyConsensusState`, preserves or advances the current and next authority sets, and requires the derived state to equal the output state written on chain.",
            primary_evidence="; ".join(
                [
                    _claim_ref(claim_index["bridge.verify-consensus-derives-next-committee-from-leaf"]),
                    _claim_ref(claim_index["bridge.verify-consensus.output-state-must-match-derived-state"]),
                ]
            ),
            notes="This is a state-update claim, not a broader claim about validating arbitrary relay-chain history.",
            supporting_claim_ids=(
                "bridge.verify-consensus-derives-next-committee-from-leaf",
                "bridge.verify-consensus.output-state-must-match-derived-state",
            ),
        ),
        TruthTableRow(
            statement="The BEEFY-backed committee bridge performs generic cross-chain message passing.",
            status="prohibited-claim",
            why="The admissible sources support a narrow bridge boundary: committee-state verification over BEEFY proof material. They do not establish generic message-passing behavior for this repository.",
            primary_evidence="; ".join(
                [
                    _claim_ref(claim_index["beefy.protocol-is-bridge-oriented"]),
                    _claim_ref(claim_index["validator.logic.committee-state-transition-only"]),
                ]
            ),
            notes="Do not use generic bridging or messaging language in the rewritten docs.",
            supporting_claim_ids=(
                "beefy.protocol-is-bridge-oriented",
                "validator.logic.committee-state-transition-only",
            ),
        ),
        TruthTableRow(
            statement="The BEEFY-backed committee bridge derives future trusted committee data from accepted proof material.",
            status="confirmed",
            why="The code requires the `nc` payload to match the hashed SCALE-encoded latest MMR leaf and, when that leaf advertises a newer authority set, derives the next trusted committee data from that leaf before matching the explicit output state.",
            primary_evidence="; ".join(
                [
                    _claim_ref(claim_index["bridge.verify-consensus.payload-must-hash-latest-leaf"]),
                    _claim_ref(claim_index["bridge.verify-consensus-derives-next-committee-from-leaf"]),
                ]
            ),
            notes="The exact local threshold arithmetic remains an open wording question, but the derivation path from accepted proof material is source-backed.",
            supporting_claim_ids=(
                "bridge.verify-consensus.payload-must-hash-latest-leaf",
                "bridge.verify-consensus-derives-next-committee-from-leaf",
            ),
            related_open_question_ids=(
                _question_ref(
                    question_index["bridge.threshold-rounding-semantics-not-yet-worded"]
                ),
            ),
        ),
        TruthTableRow(
            statement="The BEEFY-backed committee bridge implies broader finality or overall chain correctness than the cited sources support.",
            status="prohibited-claim",
            why="GRANDPA's provable-finality guarantees are prerequisite background, while upstream and repository bridge claims stay narrower. The committee-bridge docs must not upgrade BEEFY proof verification into broader finality, honesty, or chain-correctness guarantees.",
            primary_evidence="; ".join(
                [
                    _claim_ref(claim_index["grandpa.provides-provable-finality-background"]),
                    _claim_ref(claim_index["beefy.runs-alongside-grandpa-on-finalized-chain"]),
                    _claim_ref(claim_index["beefy.upstream-justification-threshold-is-2of3-plus-1"]),
                ]
            ),
            notes="Keep GRANDPA in prerequisite/background context only, and do not equate threshold-signed commitments with broader chain correctness claims.",
            supporting_claim_ids=(
                "grandpa.provides-provable-finality-background",
                "beefy.runs-alongside-grandpa-on-finalized-chain",
                "beefy.upstream-justification-threshold-is-2of3-plus-1",
            ),
        ),
    )
    return rows


def run_truth_table(output_dir: Path) -> dict[str, Path]:
    rows = build_truth_table()
    output_dir.mkdir(parents=True, exist_ok=True)
    written = {
        "truth_table": write_json(
            output_dir / "truth-table.json",
            [row.to_dict() for row in rows],
        )
    }
    summary = {
        "row_count": len(rows),
        "statuses": {
            status: sum(1 for row in rows if row.status == status)
            for status in sorted({row.status for row in rows})
        },
    }
    written["summary"] = write_json(output_dir / "summary.json", summary)
    return written


__all__ = ["TruthTableRow", "build_truth_table", "run_truth_table"]
