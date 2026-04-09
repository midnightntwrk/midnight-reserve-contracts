from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json

from z3 import Bool, BoolRef, Solver, unsat

from .extractor import build_extraction_bundle
from .model import ClaimRow, write_json
from .paths import CONTRACT_PATH
from .relations import canonicalize_claims


@dataclass(frozen=True, slots=True)
class ForbiddenInferenceRule:
    rule_id: str
    proposition: str
    forbidden_truth: bool
    description: str


REQUIRED_STRING_FIELDS = (
    "claim_text",
    "exact_quote_or_snippet",
    "source_class",
    "source_path_or_url",
    "source_location",
)


def _expect_object(raw: object, context: str) -> dict[str, object]:
    if not isinstance(raw, dict):
        raise ValueError(f"{context} must be an object")
    return raw


def _expect_string(raw: object, field_name: str, context: str) -> str:
    if not isinstance(raw, str) or not raw:
        raise ValueError(f"{context}.{field_name} must be a non-empty string")
    return raw


def _expect_bool(raw: object, field_name: str, context: str) -> bool:
    if not isinstance(raw, bool):
        raise ValueError(f"{context}.{field_name} must be a boolean")
    return raw


def _load_forbidden_inference_rules(
    path: Path = CONTRACT_PATH,
    ) -> tuple[ForbiddenInferenceRule, ...]:
    payload = json.loads(path.read_text())
    data = _expect_object(payload, "contract")
    raw_rules = data.get("forbidden_inference_rules")
    if not isinstance(raw_rules, list):
        raise ValueError("contract.forbidden_inference_rules must be a list")

    rules: list[ForbiddenInferenceRule] = []
    for index, item in enumerate(raw_rules):
        context = f"contract.forbidden_inference_rules[{index}]"
        rule = _expect_object(item, context)
        rules.append(
            ForbiddenInferenceRule(
                rule_id=_expect_string(rule.get("rule_id"), "rule_id", context),
                proposition=_expect_string(
                    rule.get("proposition"),
                    "proposition",
                    context,
                ),
                forbidden_truth=_expect_bool(
                    rule.get("forbidden_truth"),
                    "forbidden_truth",
                    context,
                ),
                description=_expect_string(
                    rule.get("description"),
                    "description",
                    context,
                ),
            )
        )

    rule_ids = [rule.rule_id for rule in rules]
    duplicates = sorted({rule_id for rule_id in rule_ids if rule_ids.count(rule_id) > 1})
    if duplicates:
        raise ValueError(f"Duplicate forbidden inference rule IDs: {duplicates}")
    return tuple(rules)


def _build_base_solver(
    claims: tuple[ClaimRow, ...],
    ) -> tuple[Solver, dict[str, BoolRef]]:
    solver = Solver()
    proposition_cache: dict[str, BoolRef] = {}

    for claim in claims:
        for assertion in claim.semantic_assertions:
            proposition = proposition_cache.setdefault(
                assertion.proposition,
                Bool(assertion.proposition),
            )
            label = Bool(
                f"claim:{claim.claim_id}:{assertion.proposition}:{int(assertion.value)}"
            )
            solver.assert_and_track(
                proposition if assertion.value else ~proposition,
                label,
            )

    return solver, proposition_cache


def _normalize_core_ids(core: list[str]) -> list[str]:
    normalized: list[str] = []
    for item in core:
        if item.startswith("claim:"):
            _, claim_id, *_ = item.split(":")
            normalized.append(claim_id)
        else:
            normalized.append(item)
    return sorted(set(normalized))


def _unsupported_claims(claims: tuple[ClaimRow, ...]) -> list[dict[str, object]]:
    unsupported: list[dict[str, object]] = []
    for claim in claims:
        missing = [field for field in REQUIRED_STRING_FIELDS if not getattr(claim, field)]
        if missing:
            unsupported.append(
                {
                    "claim_id": claim.claim_id,
                    "missing_fields": missing,
                }
            )
    return unsupported


def _contradiction_report(claims: tuple[ClaimRow, ...]) -> dict[str, object]:
    solver, _ = _build_base_solver(claims)
    result = solver.check()
    if result == unsat:
        core = _normalize_core_ids([str(item) for item in solver.unsat_core()])
        return {
            "status": "unsat",
            "conflicts": [
                {
                    "claim_or_rule_ids": core,
                }
            ],
        }
    return {
        "status": "satisfied",
        "conflicts": [],
    }


def _forbidden_inference_report(
    claims: tuple[ClaimRow, ...],
    rules: tuple[ForbiddenInferenceRule, ...],
    ) -> list[dict[str, object]]:
    findings: list[dict[str, object]] = []
    for rule in rules:
        solver, propositions = _build_base_solver(claims)
        proposition = propositions.setdefault(rule.proposition, Bool(rule.proposition))
        query_label = Bool(f"query:{rule.rule_id}")
        solver.assert_and_track(
            proposition if rule.forbidden_truth else ~proposition,
            query_label,
        )
        result = solver.check()
        if result == unsat:
            core = _normalize_core_ids(
                [
                    str(item)
                    for item in solver.unsat_core()
                    if not str(item).startswith("query:")
                ]
            )
            findings.append(
                {
                    "rule_id": rule.rule_id,
                    "status": "enforced",
                    "description": rule.description,
                    "claim_or_rule_ids": core,
                }
            )
        else:
            findings.append(
                {
                    "rule_id": rule.rule_id,
                    "status": "not-enforced",
                    "description": rule.description,
                    "claim_or_rule_ids": [],
                }
            )
    return findings


def build_z3_report() -> dict[str, object]:
    bundle = build_extraction_bundle()
    claims = canonicalize_claims(bundle)
    forbidden_rules = _load_forbidden_inference_rules()
    return {
        "unsupported_claims": _unsupported_claims(claims),
        "contradiction_check": _contradiction_report(claims),
        "forbidden_inference_check": _forbidden_inference_report(
            claims,
            forbidden_rules,
        ),
    }


def run_z3_checks(output_dir: Path) -> dict[str, Path]:
    payload = build_z3_report()
    output_dir.mkdir(parents=True, exist_ok=True)
    written = {
        "contradiction_report": write_json(
            output_dir / "contradiction-report.json",
            payload,
        )
    }
    summary = {
        "unsupported_claim_count": len(payload["unsupported_claims"]),
        "contradiction_status": payload["contradiction_check"]["status"],
        "forbidden_rule_count": len(payload["forbidden_inference_check"]),
        "forbidden_enforced_count": sum(
            1
            for item in payload["forbidden_inference_check"]
            if item["status"] == "enforced"
        ),
    }
    written["summary"] = write_json(output_dir / "summary.json", summary)
    return written


__all__ = ["build_z3_report", "run_z3_checks"]