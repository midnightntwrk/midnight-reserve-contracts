from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal
import json

SourceClass = Literal[
    "code",
    "test",
    "upstream-beefy",
    "upstream-grandpa",
    "user-decision",
]
Confidence = Literal["confirmed", "open-question"]


@dataclass(frozen=True, slots=True)
class SemanticAssertion:
    proposition: str
    value: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "proposition": self.proposition,
            "value": self.value,
        }


@dataclass(frozen=True, slots=True)
class ClaimRow:
    claim_id: str
    claim_text: str
    exact_quote_or_snippet: str
    source_class: SourceClass
    source_path_or_url: str
    source_location: str
    confidence: Confidence
    canonical_terms_used: tuple[str, ...]
    prerequisites: tuple[str, ...] = ()
    exclusions_or_forbidden_inference: tuple[str, ...] = ()
    affected_sections: tuple[str, ...] = ()
    notes: str = ""
    semantic_assertions: tuple[SemanticAssertion, ...] = ()
    reader_partition: str | None = None
    source_record_id: str | None = None
    supports: tuple[str, ...] = ()
    contradicts: tuple[str, ...] = ()
    depends_on: tuple[str, ...] = ()
    supersedes: tuple[str, ...] = ()
    duplicates: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        data: dict[str, object] = {
            "claim_id": self.claim_id,
            "claim_text": self.claim_text,
            "exact_quote_or_snippet": self.exact_quote_or_snippet,
            "source_class": self.source_class,
            "source_path_or_url": self.source_path_or_url,
            "source_location": self.source_location,
            "confidence": self.confidence,
            "canonical_terms_used": list(self.canonical_terms_used),
            "prerequisites": list(self.prerequisites),
            "exclusions_or_forbidden_inference": list(
                self.exclusions_or_forbidden_inference
            ),
            "affected_sections": list(self.affected_sections),
            "notes": self.notes,
            "semantic_assertions": [
                assertion.to_dict() for assertion in self.semantic_assertions
            ],
        }
        optional_lists = {
            "supports": self.supports,
            "contradicts": self.contradicts,
            "depends_on": self.depends_on,
            "supersedes": self.supersedes,
            "duplicates": self.duplicates,
        }
        for key, value in optional_lists.items():
            if value:
                data[key] = list(value)
        if self.reader_partition is not None:
            data["reader_partition"] = self.reader_partition
        if self.source_record_id is not None:
            data["source_record_id"] = self.source_record_id
        return data


@dataclass(frozen=True, slots=True)
class OpenQuestion:
    question_id: str
    reader_partition: str
    question: str
    why_it_matters: str
    blocked_claim_ids: tuple[str, ...]
    candidate_sources_checked: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "question_id": self.question_id,
            "reader_partition": self.reader_partition,
            "question": self.question,
            "why_it_matters": self.why_it_matters,
            "blocked_claim_ids": list(self.blocked_claim_ids),
            "candidate_sources_checked": list(self.candidate_sources_checked),
        }


@dataclass(frozen=True, slots=True)
class SourceInventoryEntry:
    reader_partition: str
    source_class: str
    path_or_url: str
    line_count: int

    def to_dict(self) -> dict[str, object]:
        return {
            "reader_partition": self.reader_partition,
            "source_class": self.source_class,
            "path_or_url": self.path_or_url,
            "line_count": self.line_count,
        }


@dataclass(frozen=True, slots=True)
class ExtractionBundle:
    claims: tuple[ClaimRow, ...]
    open_questions: tuple[OpenQuestion, ...]
    source_inventory: tuple[SourceInventoryEntry, ...]

    def validate(self) -> None:
        claim_ids = [claim.claim_id for claim in self.claims]
        duplicate_claim_ids = sorted(
            {claim_id for claim_id in claim_ids if claim_ids.count(claim_id) > 1}
        )
        if duplicate_claim_ids:
            raise ValueError(f"Duplicate claim IDs: {duplicate_claim_ids}")

        question_ids = [question.question_id for question in self.open_questions]
        duplicate_question_ids = sorted(
            {
                question_id
                for question_id in question_ids
                if question_ids.count(question_id) > 1
            }
        )
        if duplicate_question_ids:
            raise ValueError(f"Duplicate question IDs: {duplicate_question_ids}")

    def claims_payload(self) -> list[dict[str, object]]:
        return [claim.to_dict() for claim in self.claims]

    def open_questions_payload(self) -> list[dict[str, object]]:
        return [question.to_dict() for question in self.open_questions]

    def source_inventory_payload(self) -> dict[str, object]:
        return {
            "sources": [entry.to_dict() for entry in self.source_inventory],
        }


def write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")
    return path