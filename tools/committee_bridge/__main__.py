from __future__ import annotations

from argparse import ArgumentParser
from pathlib import Path

from .extractor import run_extraction
from .paths import FINAL_OUTPUT_DIR, REPO_ROOT, SCRATCH_DIR
from .pipeline import run_final_verification
from .prose_alignment import run_prose_alignment
from .relations import run_canonicalization
from .truth_table import run_truth_table
from .z3_checks import run_z3_checks


def build_parser() -> ArgumentParser:
    parser = ArgumentParser(
        prog="python3 -m tools.committee_bridge",
        description="Committee-bridge documentation evidence tooling",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    extract = subparsers.add_parser(
        "extract",
        help="Materialize source-backed committee-bridge claims from the declared claim contract",
    )
    extract.add_argument(
        "--out",
        type=Path,
        default=SCRATCH_DIR / "extractor",
        help="Output directory for extracted claims, open questions, and source inventory",
    )

    canonicalize = subparsers.add_parser(
        "canonicalize",
        help="Build the canonical normalized claim table with relation edges",
    )
    canonicalize.add_argument(
        "--out",
        type=Path,
        default=SCRATCH_DIR / "canonical",
        help="Output directory for normalized-claim-table.json and carried open questions",
    )

    truth_table = subparsers.add_parser(
        "truth-table",
        help="Project the reader-facing truth table from the canonical claim store",
    )
    truth_table.add_argument(
        "--out",
        type=Path,
        default=SCRATCH_DIR / "truth-table",
        help="Output directory for truth-table.json",
    )

    checks = subparsers.add_parser(
        "z3-checks",
        help="Run unsupported-claim, contradiction, and forbidden-inference checks",
    )
    checks.add_argument(
        "--out",
        type=Path,
        default=SCRATCH_DIR / "checks",
        help="Output directory for contradiction-report.json",
    )

    prose = subparsers.add_parser(
        "prose-alignment",
        help="Compare target docs against the canonical claim store",
    )
    prose.add_argument(
        "--out",
        type=Path,
        default=SCRATCH_DIR / "prose-alignment",
        help="Output directory for prose-alignment-report.json",
    )

    verify = subparsers.add_parser(
        "verify",
        help="Run the full pipeline and write final review artifacts",
    )
    verify.add_argument(
        "--out",
        type=Path,
        default=FINAL_OUTPUT_DIR,
        help="Output directory for final review artifacts",
    )
    return parser


def _resolve_output_dir(output_dir: Path) -> Path:
    if output_dir.is_absolute():
        return output_dir
    return REPO_ROOT / output_dir


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "extract":
        written = run_extraction(_resolve_output_dir(args.out))
    elif args.command == "canonicalize":
        written = run_canonicalization(_resolve_output_dir(args.out))
    elif args.command == "truth-table":
        written = run_truth_table(_resolve_output_dir(args.out))
    elif args.command == "z3-checks":
        written = run_z3_checks(_resolve_output_dir(args.out))
    elif args.command == "prose-alignment":
        written = run_prose_alignment(_resolve_output_dir(args.out))
    elif args.command == "verify":
        written = run_final_verification(_resolve_output_dir(args.out))
    else:
        parser.error(f"Unsupported command: {args.command}")
        return 2

    for key, path in written.items():
        print(f"{key}: {path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
