from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = REPO_ROOT / "tools" / "committee_bridge"
SCHEMA_DIR = TOOL_DIR / "schema"
CONTRACT_PATH = TOOL_DIR / "contract.json"
REFERENCE_OUTPUT_DIR = (
    REPO_ROOT / "swarm" / "committee-bridge-docs" / "workspace" / "outputs" / "final"
)
SCRATCH_DIR = REPO_ROOT / "build" / "committee-bridge"
FINAL_OUTPUT_DIR = REPO_ROOT / "committee-bridge-artifacts" / "final"
PYSWIP_DIR = TOOL_DIR / "pyswip"

__all__ = [
    "REPO_ROOT",
    "TOOL_DIR",
    "SCHEMA_DIR",
    "CONTRACT_PATH",
    "REFERENCE_OUTPUT_DIR",
    "SCRATCH_DIR",
    "FINAL_OUTPUT_DIR",
    "PYSWIP_DIR",
]
