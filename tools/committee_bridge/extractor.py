from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen
import hashlib
import json

from .model import (
    ClaimRow,
    ExtractionBundle,
    OpenQuestion,
    SemanticAssertion,
    SourceInventoryEntry,
    write_json,

)
from .paths import CONTRACT_PATH, REPO_ROOT, SCRATCH_DIR

USER_DECISION_SOURCE = "chat://user/2026-03-19"


@dataclass(frozen=True, slots=True)
class LocalSnippet:
    reader_partition: str
    source_class: str
    path: str
    start_line: int
    end_line: int


@dataclass(frozen=True, slots=True)
class RemoteSnippet:
    reader_partition: str
    source_class: str
    url: str
    snippet: str
    location_label: str


@dataclass(frozen=True, slots=True)
class UserDecisionSnippet:
    reader_partition: str
    record_id: str
    location_label: str
    quote: str


SourceSpec = LocalSnippet | RemoteSnippet | UserDecisionSnippet


@dataclass(frozen=True, slots=True)
class ClaimSpec:
    claim_id: str
    claim_text: str
    source: SourceSpec
    confidence: str
    canonical_terms_used: tuple[str, ...]
    prerequisites: tuple[str, ...] = ()
    exclusions_or_forbidden_inference: tuple[str, ...] = ()
    affected_sections: tuple[str, ...] = ()
    notes: str = ""
    semantic_assertions: tuple[SemanticAssertion, ...] = ()


class SourceRepository:
    def __init__(self, repo_root: Path, cache_dir: Path) -> None:
        self.repo_root = repo_root
        self.cache_dir = cache_dir
        self._local_cache: dict[str, list[str]] = {}
        self._remote_cache: dict[str, list[str]] = {}

    def local_lines(self, relative_path: str) -> list[str]:
        if relative_path not in self._local_cache:
            text = (self.repo_root / relative_path).read_text()
            self._local_cache[relative_path] = text.splitlines()
        return self._local_cache[relative_path]

    def local_snippet(self, path: str, start_line: int, end_line: int) -> tuple[str, str]:
        lines = self.local_lines(path)
        snippet = "\n".join(lines[start_line - 1 : end_line])
        return snippet, f"{path}:{start_line}-{end_line}"

    def remote_lines(self, url: str) -> list[str]:
        if url not in self._remote_cache:
            cache_path = self.cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()}.md"
            text: str | None = None
            if cache_path.exists():
                text = cache_path.read_text()
            else:
                try:
                    with urlopen(url, timeout=30) as response:
                        text = response.read().decode("utf-8")
                except URLError as error:
                    raise RuntimeError(f"Failed to fetch {url}: {error}") from error
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(text)
            self._remote_cache[url] = text.splitlines()
        return self._remote_cache[url]

    def remote_snippet(self, url: str, snippet: str, location_label: str) -> tuple[str, str]:
        lines = self.remote_lines(url)
        text = "\n".join(lines)
        start_index = text.find(snippet)
        if start_index < 0:
            raise ValueError(f"Snippet not found in {url}: {snippet!r}")
        start_line = text[:start_index].count("\n") + 1
        end_line = start_line + snippet.count("\n")
        return snippet, f"{location_label} ({url}:{start_line}-{end_line})"

    def inventory_entry(self, source: LocalSnippet | RemoteSnippet) -> SourceInventoryEntry:
        if isinstance(source, LocalSnippet):
            return SourceInventoryEntry(
                reader_partition=source.reader_partition,
                source_class=source.source_class,
                path_or_url=source.path,
                line_count=len(self.local_lines(source.path)),
            )
        return SourceInventoryEntry(
            reader_partition=source.reader_partition,
            source_class=source.source_class,
            path_or_url=source.url,
            line_count=len(self.remote_lines(source.url)),
        )


ContractObject = dict[str, object]


def _expect_object(raw: object, context: str) -> ContractObject:
    if not isinstance(raw, dict):
        raise ValueError(f"{context} must be an object")
    return raw


def _expect_string(raw: object, field_name: str, context: str) -> str:
    if not isinstance(raw, str) or not raw:
        raise ValueError(f"{context}.{field_name} must be a non-empty string")
    return raw


def _expect_int(raw: object, field_name: str, context: str) -> int:
    if not isinstance(raw, int) or raw < 1:
        raise ValueError(f"{context}.{field_name} must be a positive integer")
    return raw


def _expect_bool(raw: object, field_name: str, context: str) -> bool:
    if not isinstance(raw, bool):
        raise ValueError(f"{context}.{field_name} must be a boolean")
    return raw


def _expect_string_tuple(
    raw: object,
    field_name: str,
    context: str,
    *,
    min_items: int = 0,
    unique_items: bool = False,
) -> tuple[str, ...]:
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raise ValueError(f"{context}.{field_name} must be a list of strings")
    values: list[str] = []
    for index, item in enumerate(raw):
        values.append(_expect_string(item, f"{field_name}[{index}]", context))
    if len(values) < min_items:
        raise ValueError(f"{context}.{field_name} must contain at least {min_items} item(s)")
    if unique_items and len(set(values)) != len(values):
        raise ValueError(f"{context}.{field_name} must not contain duplicates")
    return tuple(values)


def _parse_source(raw: object, context: str) -> SourceSpec:
    data = _expect_object(raw, f"{context}.source")
    kind = _expect_string(data.get("kind"), "kind", f"{context}.source")
    if kind == "local":
        return LocalSnippet(
            reader_partition=_expect_string(
                data.get("reader_partition"),
                "reader_partition",
                f"{context}.source",
            ),
            source_class=_expect_string(
                data.get("source_class"),
                "source_class",
                f"{context}.source",
            ),
            path=_expect_string(data.get("path"), "path", f"{context}.source"),
            start_line=_expect_int(
                data.get("start_line"),
                "start_line",
                f"{context}.source",
            ),
            end_line=_expect_int(
                data.get("end_line"),
                "end_line",
                f"{context}.source",
            ),
        )
    if kind == "remote":
        return RemoteSnippet(
            reader_partition=_expect_string(
                data.get("reader_partition"),
                "reader_partition",
                f"{context}.source",
            ),
            source_class=_expect_string(
                data.get("source_class"),
                "source_class",
                f"{context}.source",
            ),
            url=_expect_string(data.get("url"), "url", f"{context}.source"),
            snippet=_expect_string(
                data.get("snippet"),
                "snippet",
                f"{context}.source",
            ),
            location_label=_expect_string(
                data.get("location_label"),
                "location_label",
                f"{context}.source",
            ),
        )
    if kind == "user-decision":
        return UserDecisionSnippet(
            reader_partition=_expect_string(
                data.get("reader_partition"),
                "reader_partition",
                f"{context}.source",
            ),
            record_id=_expect_string(
                data.get("record_id"),
                "record_id",
                f"{context}.source",
            ),
            location_label=_expect_string(
                data.get("location_label"),
                "location_label",
                f"{context}.source",
            ),
            quote=_expect_string(data.get("quote"), "quote", f"{context}.source"),
        )
    raise ValueError(
        f"{context}.source.kind must be one of: local, remote, user-decision"
    )


def _parse_semantic_assertions(raw: object, context: str) -> tuple[SemanticAssertion, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError(f"{context}.semantic_assertions must be a list")

    assertions: list[SemanticAssertion] = []
    for index, item in enumerate(raw):
        item_context = f"{context}.semantic_assertions[{index}]"
        data = _expect_object(item, item_context)
        assertions.append(
            SemanticAssertion(
                proposition=_expect_string(
                    data.get("proposition"),
                    "proposition",
                    item_context,
                ),
                value=_expect_bool(data.get("value"), "value", item_context),
            )
        )
    return tuple(assertions)


def _validate_forbidden_inference_rules(raw: object) -> None:
    if not isinstance(raw, list):
        raise ValueError("contract.forbidden_inference_rules must be a list")
    for index, item in enumerate(raw):
        context = f"contract.forbidden_inference_rules[{index}]"
        data = _expect_object(item, context)
        _expect_string(data.get("rule_id"), "rule_id", context)
        _expect_string(data.get("proposition"), "proposition", context)
        _expect_bool(data.get("forbidden_truth"), "forbidden_truth", context)
        _expect_string(data.get("description"), "description", context)


def _parse_claim_spec(raw: object, index: int) -> ClaimSpec:
    context = f"claims[{index}]"
    data = _expect_object(raw, context)
    return ClaimSpec(
        claim_id=_expect_string(data.get("claim_id"), "claim_id", context),
        claim_text=_expect_string(data.get("claim_text"), "claim_text", context),
        source=_parse_source(data.get("source"), context),
        confidence=_expect_string(data.get("confidence"), "confidence", context),
        canonical_terms_used=_expect_string_tuple(
            data.get("canonical_terms_used"),
            "canonical_terms_used",
            context,
            min_items=1,
            unique_items=True,
        ),
        prerequisites=_expect_string_tuple(
            data.get("prerequisites"),
            "prerequisites",
            context,
        ),
        exclusions_or_forbidden_inference=_expect_string_tuple(
            data.get("exclusions_or_forbidden_inference"),
            "exclusions_or_forbidden_inference",
            context,
        ),
        affected_sections=_expect_string_tuple(
            data.get("affected_sections"),
            "affected_sections",
            context,
        ),
        notes=(
            data.get("notes", "")
            if isinstance(data.get("notes", ""), str)
            else _expect_string(data.get("notes"), "notes", context)
        ),
        semantic_assertions=_parse_semantic_assertions(
            data.get("semantic_assertions"),
            context,
        ),
    )


def _parse_open_question(raw: object, index: int) -> OpenQuestion:
    context = f"open_questions[{index}]"
    data = _expect_object(raw, context)
    return OpenQuestion(
        question_id=_expect_string(data.get("question_id"), "question_id", context),
        reader_partition=_expect_string(
            data.get("reader_partition"),
            "reader_partition",
            context,
        ),
        question=_expect_string(data.get("question"), "question", context),
        why_it_matters=_expect_string(
            data.get("why_it_matters"),
            "why_it_matters",
            context,
        ),
        blocked_claim_ids=_expect_string_tuple(
            data.get("blocked_claim_ids"),
            "blocked_claim_ids",
            context,
        ),
        candidate_sources_checked=_expect_string_tuple(
            data.get("candidate_sources_checked"),
            "candidate_sources_checked",
            context,
        ),
    )


def _load_contract(
    path: Path = CONTRACT_PATH,
    ) -> tuple[tuple[ClaimSpec, ...], tuple[OpenQuestion, ...]]:
    payload = json.loads(path.read_text())
    data = _expect_object(payload, "contract")
    format_version = data.get("format_version")
    if format_version != 1:
        raise ValueError(f"contract.format_version must equal 1, got {format_version!r}")

    claims_raw = data.get("claims")
    if not isinstance(claims_raw, list):
        raise ValueError("contract.claims must be a list")
    questions_raw = data.get("open_questions")
    if not isinstance(questions_raw, list):
        raise ValueError("contract.open_questions must be a list")
    _validate_forbidden_inference_rules(data.get("forbidden_inference_rules"))

    claims = tuple(
        _parse_claim_spec(item, index) for index, item in enumerate(claims_raw)
    )
    open_questions = tuple(
        _parse_open_question(item, index)
        for index, item in enumerate(questions_raw)
    )
    return claims, open_questions


def _materialize_claim(repository: SourceRepository, spec: ClaimSpec) -> ClaimRow:
    if isinstance(spec.source, LocalSnippet):
        snippet, location = repository.local_snippet(
            spec.source.path,
            spec.source.start_line,
            spec.source.end_line,
        )
        source_class = spec.source.source_class
        source_path_or_url = spec.source.path
        reader_partition = spec.source.reader_partition
        source_record_id = spec.claim_id
    elif isinstance(spec.source, RemoteSnippet):
        snippet, location = repository.remote_snippet(
            spec.source.url,
            spec.source.snippet,
            spec.source.location_label,
        )
        source_class = spec.source.source_class
        source_path_or_url = spec.source.url
        reader_partition = spec.source.reader_partition
        source_record_id = spec.claim_id
    else:
        snippet = spec.source.quote
        location = spec.source.location_label
        source_class = "user-decision"
        source_path_or_url = USER_DECISION_SOURCE
        reader_partition = spec.source.reader_partition
        source_record_id = spec.source.record_id

    return ClaimRow(
        claim_id=spec.claim_id,
        claim_text=spec.claim_text,
        exact_quote_or_snippet=snippet,
        source_class=source_class,
        source_path_or_url=source_path_or_url,
        source_location=location,
        confidence=spec.confidence,
        canonical_terms_used=spec.canonical_terms_used,
        prerequisites=spec.prerequisites,
        exclusions_or_forbidden_inference=spec.exclusions_or_forbidden_inference,
        affected_sections=spec.affected_sections,
        notes=spec.notes,
        semantic_assertions=spec.semantic_assertions,
        reader_partition=reader_partition,
        source_record_id=source_record_id,
    )


def build_extraction_bundle() -> ExtractionBundle:
    repository = SourceRepository(REPO_ROOT, SCRATCH_DIR / "http-cache")
    claim_specs, open_questions = _load_contract()
    claim_specs = tuple(sorted(claim_specs, key=lambda spec: spec.claim_id))
    claims = tuple(_materialize_claim(repository, spec) for spec in claim_specs)
    open_questions = tuple(
        sorted(open_questions, key=lambda question: question.question_id)
    )

    source_entries: dict[tuple[str, str, str], SourceInventoryEntry] = {}
    for spec in claim_specs:
        source = spec.source
        if isinstance(source, UserDecisionSnippet):
            continue
        entry = repository.inventory_entry(source)
        key = (entry.reader_partition, entry.source_class, entry.path_or_url)
        source_entries[key] = entry

    bundle = ExtractionBundle(
        claims=claims,
        open_questions=open_questions,
        source_inventory=tuple(
            sorted(
                source_entries.values(),
                key=lambda entry: (entry.reader_partition, entry.path_or_url),
            )
        ),
    )
    bundle.validate()
    return bundle


def run_extraction(output_dir: Path) -> dict[str, Path]:
    bundle = build_extraction_bundle()
    output_dir.mkdir(parents=True, exist_ok=True)
    written = {
        "claims": write_json(
            output_dir / "extracted-claims.json",
            bundle.claims_payload(),
        ),
        "open_questions": write_json(
            output_dir / "open-questions.json",
            bundle.open_questions_payload(),
        ),
        "source_inventory": write_json(
            output_dir / "source-inventory.json",
            bundle.source_inventory_payload(),
        ),
    }
    metadata = {
        "claim_count": len(bundle.claims),
        "open_question_count": len(bundle.open_questions),
        "source_count": len(bundle.source_inventory),
        "outputs": {
            key: str(path.relative_to(REPO_ROOT)) for key, path in written.items()
        },
    }
    written["summary"] = write_json(output_dir / "summary.json", metadata)
    return written


__all__ = ["build_extraction_bundle", "run_extraction"]