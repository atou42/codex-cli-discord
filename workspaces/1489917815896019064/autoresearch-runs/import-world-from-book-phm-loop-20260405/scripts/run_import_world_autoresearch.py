#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import difflib
import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from phm_eval_lib import evaluate_split, write_json


SCRIPT_DIR = Path(__file__).resolve().parent
RUN_ROOT = SCRIPT_DIR.parent
SOURCE_REPO = Path("/Users/atou/codex-skills-macmini-local")
WORKTREE = RUN_ROOT / "runtime" / "target-worktree"
SESSION_DIR = RUN_ROOT / "runtime" / "loop-claude-session"
TARGET_REL = Path("skills/import-world-from-book/SKILL.md")
DEFAULT_QUICK_SPLITS = ["smoke", "train"]
DEFAULT_PROMOTION_SPLITS = ["dev", "test", "adversarial"]
MUTATOR_MODEL = "gpt-5.4"
MUTATOR_REASONING_EFFORT = "xhigh"
MUTATION_TIMEOUT_SEC = 420
MUTATION_MAX_ATTEMPTS = 3
PROMPT_RECENT_ATTEMPT_LIMIT = 2
PROMPT_BLOCKED_ATTEMPT_LIMIT = 6
PROMPT_CASE_ID_LIMIT = 4
PROMPT_CHANGED_SECTION_LIMIT = 4
CHECKPOINT_FAILURE_FAMILIES = [
    "completion_claim_truth",
    "book_world_processing_evidence",
    "tail_boundary_mapping",
    "epilogue_source_trace",
    "batch_vs_legacy_summary",
    "single_book_shortcut",
    "preflight_blockers",
    "final_audit_delivery_truth",
    "broken_links_placeholders",
    "chapter_sequence_integrity",
    "parallel_write_ownership",
    "glossary_entity_authority",
    "other",
]
CHECKPOINT_CHANGE_TACTICS = [
    "add_required_check",
    "split_gate",
    "move_gate_earlier",
    "tighten_authority_source",
    "forbid_shortcut_success",
    "require_cross_artifact_match",
    "require_file_tree_evidence",
    "require_per_chapter_mapping",
    "require_negative_check",
    "narrow_acceptance_rule",
    "other",
]
GLOBAL_STATE_PATHS = [
    "claude_settings=~/.claude/settings.json",
    "claude_skills=~/.claude/skills",
    "claude_agents=~/.claude/agents",
    "claude_plugins=~/.claude/plugins",
    "claude_hooks=~/.claude/hooks",
    "claude_md=~/.claude/CLAUDE.md",
    "claude_local_settings=~/.claude/settings.local.json",
    "claude_omc_config=~/.claude/.omc-config.json",
    "claude_omc_version=~/.claude/.omc-version.json",
    "cc_switch_settings=~/.cc-switch/settings.json",
]
LEDGER_COLUMNS = [
    "timestamp",
    "experiment_id",
    "parent_baseline",
    "hypothesis",
    "changed_files",
    "status",
    "git_snapshot_before",
    "git_snapshot_after",
    "runtime_model_snapshot_before",
    "runtime_model_snapshot_after",
    "runtime_model_drift_summary",
    "keep_commit_hash",
    "keep_commit_snapshot",
    "keep_commit_clean",
    "primary_metric_before",
    "primary_metric_after",
    "dimension_scores_before",
    "dimension_scores_after",
    "dimension_deltas",
    "blocker_regression",
    "cleared_failure_modes",
    "new_failure_modes",
    "adversarial_result",
    "reviewer_summary",
    "decision",
    "notes",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_command(
    command: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = True,
    timeout_sec: int | None = 120,
) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout_sec,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout.decode("utf-8", errors="replace") if exc.stdout else "")
        stderr = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr.decode("utf-8", errors="replace") if exc.stderr else "")
        raise RuntimeError(
            f"Command timed out after {timeout_sec}s: {' '.join(command)}\nstdout:\n{stdout}\n\nstderr:\n{stderr}"
        ) from exc
    if check and result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
        )
    return result


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def append_ledger_row(path: Path, row: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=LEDGER_COLUMNS, delimiter="\t")
        writer.writerow(row)


def normalize_note(text: str) -> str:
    return " ".join(text.replace("\r", "\n").split())


def load_ledger_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle, fieldnames=LEDGER_COLUMNS, delimiter="\t"))[1:]


def shorten_text(text: str, limit: int = 280) -> str:
    compact = normalize_note(text)
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def parse_json_list(raw: str) -> list[str]:
    if not raw.strip():
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def parse_json_object(raw: str) -> dict[str, Any]:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError(f"Mutation output is not a JSON object: {type(value).__name__}")
    return value


def normalize_direction_token(text: str) -> str:
    compact = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return compact or "unknown"


def normalize_direction_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized: list[str] = []
    for value in values:
        token = normalize_direction_token(str(value))
        if token not in normalized:
            normalized.append(token)
    return sorted(normalized)


def normalize_choice(value: str, allowed: list[str], *, fallback: str = "other") -> str:
    token = normalize_direction_token(value)
    if token in allowed:
        return token
    return fallback if fallback in allowed else allowed[0]


def strip_outer_code_fence(text: str) -> str:
    stripped = text.strip()
    match = re.match(r"^```[^\n]*\n([\s\S]*?)\n```$", stripped)
    if match:
        return match.group(1).strip()
    return stripped


def parse_key_value_lines(lines: list[str]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    active_key: str | None = None
    active_parts: list[str] = []
    active_style = ""

    def flush() -> None:
        nonlocal active_key, active_parts, active_style
        if active_key is not None:
            if active_style in {"|", "|-"}:
                parsed[active_key] = "\n".join(part.rstrip() for part in active_parts).strip()
            else:
                parsed[active_key] = " ".join(part.strip() for part in active_parts if part.strip()).strip()
        active_key = None
        active_parts = []
        active_style = ""

    for raw_line in lines:
        line = raw_line.rstrip("\n")
        if active_key is not None and (line.startswith("  ") or line.startswith("\t")):
            active_parts.append(line.lstrip())
            continue
        flush()
        match = re.match(r"^([A-Za-z0-9_]+)\s*[:=]\s*(.*)$", line.rstrip())
        if not match:
            continue
        key = match.group(1).strip()
        value = match.group(2).strip()
        if value in {"|", "|-", ">", ">-"}:
            active_key = key
            active_style = value
            active_parts = []
            continue
        parsed[key] = value.strip().strip('"').strip("'")
    flush()
    return parsed


def parse_frontmatter_document(text: str) -> tuple[dict[str, str], str] | None:
    stripped = text.strip()
    if not stripped.startswith("---"):
        return None
    lines = stripped.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    end_index: int | None = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            end_index = index
            break
    if end_index is None:
        return None
    metadata = parse_key_value_lines(lines[1:end_index])
    if not metadata:
        return None
    return metadata, stripped


def parse_prefixed_metadata_document(text: str) -> tuple[dict[str, str], str] | None:
    stripped = text.strip()
    lines = stripped.splitlines()
    metadata_lines: list[str] = []
    body_start: int | None = None
    for index, raw_line in enumerate(lines):
        line = raw_line.rstrip()
        if not line:
            if metadata_lines:
                body_start = index + 1
                break
            continue
        if line.startswith("```") or line == "---":
            body_start = index
            break
        if re.match(r"^[A-Za-z0-9_]+\s*[:=]\s*.*$", line):
            metadata_lines.append(raw_line)
            continue
        if metadata_lines and (raw_line.startswith("  ") or raw_line.startswith("\t")):
            metadata_lines.append(raw_line)
            continue
        if metadata_lines:
            body_start = index
            break
        return None
    if not metadata_lines:
        return None
    metadata = parse_key_value_lines(metadata_lines)
    if not metadata:
        return None
    body_text = "\n".join(lines[body_start:]).strip() if body_start is not None else ""
    if body_text.startswith("```"):
        body_text = strip_outer_code_fence(body_text)
    return metadata, body_text.strip()


def nearest_heading(lines: list[str], line_index: int) -> str:
    if not lines:
        return "frontmatter"
    bounded_index = max(0, min(line_index, len(lines) - 1))
    for index in range(bounded_index, -1, -1):
        match = re.match(r"^(#{1,6})\s+(.+?)\s*$", lines[index])
        if match:
            return f"{match.group(1)} {match.group(2).strip()}"
    return "frontmatter"


def infer_changed_sections(current_skill_text: str, revised_skill_md: str) -> list[str]:
    current_lines = current_skill_text.splitlines()
    revised_lines = revised_skill_md.splitlines()
    matcher = difflib.SequenceMatcher(a=current_lines, b=revised_lines)
    sections: list[str] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if j1 == j2:
            section = nearest_heading(current_lines, max(i1 - 1, 0))
        else:
            section = nearest_heading(revised_lines, j1)
        if section not in sections:
            sections.append(section)
    if not sections and current_skill_text.rstrip() != revised_skill_md.rstrip():
        sections.append("file_root")
    return sections[:8]


def summarize_note_for_prompt(note: str) -> str:
    compact = normalize_note(note)
    if not compact:
        return ""
    lowered = compact.lower()
    if "expecting value: line 1 column 1" in lowered:
        return "mutation output format drifted and was not valid JSON"
    if "timed out after" in lowered:
        return "mutation attempt timed out before returning a usable payload"
    if "reconnecting" in lowered or "high demand" in lowered:
        return "provider reconnect or high-demand instability"
    if "quick pass count stayed flat" in lowered:
        return "quick pass count stayed flat"
    if "quick pass count did not improve" in lowered:
        return "quick pass count did not improve"
    if "smoke pass count regressed" in lowered:
        return "smoke pass count regressed"
    if "global claude lane drift detected" in lowered:
        return "global claude lane drift detected"
    return shorten_text(compact, limit=140)


def compact_prompt_attempt_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "experiment_id": item.get("experiment_id", ""),
        "hypothesis": shorten_text(str(item.get("hypothesis", "")), limit=220),
        "failure_family": item.get("failure_family", "") or "unknown",
        "change_tactic": item.get("change_tactic", "") or "unknown",
        "changed_sections": list(item.get("changed_sections", []))[:PROMPT_CHANGED_SECTION_LIMIT],
        "expected_case_ids": list(item.get("expected_case_ids", []))[:PROMPT_CASE_ID_LIMIT],
        "result": summarize_note_for_prompt(str(item.get("notes", ""))),
        "cleared_failure_modes": list(item.get("cleared_failure_modes", []))[:3],
        "new_failure_modes": list(item.get("new_failure_modes", []))[:3],
    }


def extract_structured_payload(
    raw_text: str,
    *,
    current_skill_text: str,
) -> tuple[dict[str, Any], str]:
    stripped = raw_text.strip()
    if not stripped:
        raise ValueError("mutation output was empty")

    candidates = [stripped]
    unfenced = strip_outer_code_fence(stripped)
    if unfenced != stripped:
        candidates.append(unfenced)

    for candidate in candidates:
        try:
            return parse_json_object(candidate), "json"
        except Exception:
            continue

    for candidate in candidates:
        parsed = parse_frontmatter_document(candidate)
        if parsed is None:
            continue
        metadata, revised_skill_md = parsed
        payload = {
            "hypothesis": str(metadata.get("hypothesis", "")).strip(),
            "failure_family": normalize_choice(str(metadata.get("failure_family", "")), CHECKPOINT_FAILURE_FAMILIES),
            "change_tactic": normalize_choice(str(metadata.get("change_tactic", "")), CHECKPOINT_CHANGE_TACTICS),
            "checkpoint_guard_explanation": str(
                metadata.get(
                    "checkpoint_guard_explanation",
                    "Recovered from frontmatter markdown output without a JSON wrapper.",
                )
            ).strip(),
            "changed_sections": infer_changed_sections(current_skill_text, revised_skill_md),
            "expected_case_ids": parse_json_list(str(metadata.get("expected_case_ids", ""))),
            "revised_skill_md": revised_skill_md,
        }
        return payload, "frontmatter"

    prefixed = parse_prefixed_metadata_document(stripped)
    if prefixed is not None:
        metadata, revised_skill_md = prefixed
        if revised_skill_md.startswith("---") or revised_skill_md.startswith("#"):
            payload = {
                "hypothesis": str(metadata.get("hypothesis", "")).strip(),
                "failure_family": normalize_choice(str(metadata.get("failure_family", "")), CHECKPOINT_FAILURE_FAMILIES),
                "change_tactic": normalize_choice(str(metadata.get("change_tactic", "")), CHECKPOINT_CHANGE_TACTICS),
                "checkpoint_guard_explanation": str(
                    metadata.get(
                        "checkpoint_guard_explanation",
                        "Recovered from prefixed metadata output without a JSON wrapper.",
                    )
                ).strip(),
                "changed_sections": infer_changed_sections(current_skill_text, revised_skill_md),
                "expected_case_ids": parse_json_list(str(metadata.get("expected_case_ids", ""))),
                "revised_skill_md": revised_skill_md,
            }
            return payload, "prefixed-metadata"

    raise ValueError("mutation output was not recoverable as JSON, frontmatter markdown, or prefixed metadata")


def load_mutation_parsed_output(iteration_dir: Path) -> dict[str, Any]:
    mutation_path = iteration_dir / "mutation-result.json"
    if not mutation_path.exists():
        return {}
    try:
        payload = load_json(mutation_path)
    except Exception:
        return {}
    for key in ("parsed_output", "structured_output"):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    return {}


def build_direction_summary(parsed: dict[str, Any]) -> dict[str, Any]:
    failure_family = normalize_direction_token(str(parsed.get("failure_family", "")))
    change_tactic = normalize_direction_token(str(parsed.get("change_tactic", "")))
    expected_case_ids = normalize_direction_list(parsed.get("expected_case_ids", []))
    changed_sections = normalize_direction_list(parsed.get("changed_sections", []))
    core_payload = {
        "failure_family": failure_family,
        "change_tactic": change_tactic,
        "expected_case_ids": expected_case_ids,
    }
    full_payload = {
        **core_payload,
        "changed_sections": changed_sections,
    }
    return {
        "failure_family": failure_family,
        "change_tactic": change_tactic,
        "expected_case_ids": expected_case_ids,
        "changed_sections": changed_sections,
        "core_fingerprint": json.dumps(core_payload, ensure_ascii=False, sort_keys=True),
        "full_fingerprint": json.dumps(full_payload, ensure_ascii=False, sort_keys=True),
    }


def load_mutation_changed_sections(iteration_dir: Path) -> list[str]:
    parsed = load_mutation_parsed_output(iteration_dir)
    sections = parsed.get("changed_sections")
    if isinstance(sections, list):
        return [str(item) for item in sections]
    return []


def active_checkpoint_rows(rows: list[dict[str, str]]) -> tuple[dict[str, str] | None, list[dict[str, str]]]:
    latest_keep: dict[str, str] | None = None
    latest_keep_index = -1
    for index, row in enumerate(rows):
        if str(row.get("status", "")).strip() == "keep":
            latest_keep = row
            latest_keep_index = index
    if latest_keep_index < 0:
        return None, rows
    return latest_keep, rows[latest_keep_index + 1 :]


def blocked_directions_since_latest_keep(
    *,
    ledger_path: Path,
    iterations_dir: Path,
) -> list[dict[str, Any]]:
    rows = load_ledger_rows(ledger_path)
    _, checkpoint_rows = active_checkpoint_rows(rows)
    blocked: list[dict[str, Any]] = []
    for row in checkpoint_rows:
        decision = str(row.get("decision", "")).strip()
        status = str(row.get("status", "")).strip()
        if decision != "discard" and status != "discard":
            continue
        experiment_id = str(row.get("experiment_id", "")).strip()
        if not experiment_id:
            continue
        parsed = load_mutation_parsed_output(iterations_dir / experiment_id)
        if not parsed:
            continue
        direction = build_direction_summary(parsed)
        blocked.append(
            {
                "experiment_id": experiment_id,
                "hypothesis": shorten_text(str(parsed.get("hypothesis", "")), limit=320),
                "failure_family": direction["failure_family"],
                "change_tactic": direction["change_tactic"],
                "expected_case_ids": direction["expected_case_ids"],
                "changed_sections": direction["changed_sections"],
                "direction_core_fingerprint": direction["core_fingerprint"],
                "direction_full_fingerprint": direction["full_fingerprint"],
                "primary_before": row.get("primary_metric_before", ""),
                "primary_after": row.get("primary_metric_after", ""),
                "cleared_failure_modes": parse_json_list(str(row.get("cleared_failure_modes", "")))[:6],
                "new_failure_modes": parse_json_list(str(row.get("new_failure_modes", "")))[:6],
                "notes": shorten_text(str(row.get("notes", "")), limit=320),
            }
        )
    return blocked


def find_blocked_direction_match(
    candidate_direction: dict[str, Any],
    blocked_directions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    candidate_core = candidate_direction.get("core_fingerprint", "")
    candidate_full = candidate_direction.get("full_fingerprint", "")
    candidate_cases = candidate_direction.get("expected_case_ids", [])
    candidate_sections = candidate_direction.get("changed_sections", [])
    for blocked in blocked_directions:
        blocked_core = str(blocked.get("direction_core_fingerprint", "")).strip()
        blocked_full = str(blocked.get("direction_full_fingerprint", "")).strip()
        if candidate_core and blocked_core and candidate_core == blocked_core:
            return {"match_type": "core", "blocked": blocked}
        if candidate_full and blocked_full and candidate_full == blocked_full:
            return {"match_type": "full", "blocked": blocked}
        blocked_cases = blocked.get("expected_case_ids", [])
        blocked_sections = blocked.get("changed_sections", [])
        if candidate_cases and candidate_cases == blocked_cases and candidate_sections and candidate_sections == blocked_sections:
            return {"match_type": "legacy_case_and_section", "blocked": blocked}
    return None


def recent_mutation_context(
    *,
    ledger_path: Path,
    iterations_dir: Path,
    latest_limit: int = 3,
) -> dict[str, Any]:
    rows = load_ledger_rows(ledger_path)
    if not rows:
        return {"latest_keep": None, "recent_attempts": [], "failed_attempts_since_keep": []}

    def row_summary(row: dict[str, str]) -> dict[str, Any]:
        experiment_id = str(row.get("experiment_id", "")).strip()
        iteration_dir = iterations_dir / experiment_id if experiment_id else iterations_dir
        parsed = load_mutation_parsed_output(iteration_dir)
        direction = build_direction_summary(parsed) if parsed else {}
        return {
            "experiment_id": experiment_id,
            "status": row.get("status", ""),
            "decision": row.get("decision", ""),
            "hypothesis": shorten_text(str(row.get("hypothesis", "")), limit=320),
            "changed_sections": load_mutation_changed_sections(iteration_dir)[:8],
            "expected_case_ids": direction.get("expected_case_ids", []),
            "failure_family": direction.get("failure_family", ""),
            "change_tactic": direction.get("change_tactic", ""),
            "direction_core_fingerprint": direction.get("core_fingerprint", ""),
            "primary_before": row.get("primary_metric_before", ""),
            "primary_after": row.get("primary_metric_after", ""),
            "dimension_deltas": row.get("dimension_deltas", ""),
            "cleared_failure_modes": parse_json_list(str(row.get("cleared_failure_modes", "")))[:6],
            "new_failure_modes": parse_json_list(str(row.get("new_failure_modes", "")))[:6],
            "notes": shorten_text(str(row.get("notes", "")), limit=320),
            "keep_commit_hash": row.get("keep_commit_hash", ""),
        }

    latest_keep_row, checkpoint_rows = active_checkpoint_rows(rows)
    latest_keep = row_summary(latest_keep_row) if latest_keep_row else None
    recent_attempts = [row_summary(row) for row in rows[-latest_limit:]]
    failed_attempts_since_keep = [
        row_summary(row)
        for row in checkpoint_rows
        if str(row.get("decision", "")).strip() == "discard" or str(row.get("status", "")).strip() == "discard"
    ]
    return {
        "latest_keep": latest_keep,
        "recent_attempts": recent_attempts,
        "failed_attempts_since_keep": failed_attempts_since_keep[-8:],
    }


def capture_git(repo: Path, output: Path) -> dict[str, Any]:
    script = SOURCE_REPO / "skills" / "skill-autoresearch" / "scripts" / "capture_git_revision.py"
    run_command(["python3", str(script), "--repo", str(repo), "--output", str(output)])
    return load_json(output)


def capture_model(session_dir: Path, output: Path) -> dict[str, Any]:
    script = (
        SOURCE_REPO / "skills" / "skill-autoresearch" / "scripts" / "capture_cc_switch_model_config.py"
    )
    run_command(
        [
            "python3",
            str(script),
            "--app",
            "claude",
            "--live-dir-override",
            f"claude={session_dir}",
            "--output",
            str(output),
        ]
    )
    return load_json(output)


def capture_global_state(output: Path) -> dict[str, Any]:
    script = SOURCE_REPO / "skills" / "skill-autoresearch" / "scripts" / "capture_path_state.py"
    command = ["python3", str(script)]
    for item in GLOBAL_STATE_PATHS:
        command.extend(["--path", item])
    command.extend(["--output", str(output)])
    run_command(command)
    return load_json(output)


def tracked_changed_paths(repo: Path) -> list[str]:
    result = run_command(["git", "-C", str(repo), "diff", "--name-only"], check=True)
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def untracked_paths(repo: Path) -> list[str]:
    result = run_command(
        ["git", "-C", str(repo), "ls-files", "--others", "--exclude-standard"],
        check=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def save_patch(repo: Path, output: Path) -> None:
    result = run_command(["git", "-C", str(repo), "diff", "--", TARGET_REL.as_posix()], check=True)
    write_text(output, result.stdout)


def cleanup_worktree(repo: Path) -> list[str]:
    cleaned: list[str] = []
    for rel in tracked_changed_paths(repo):
        run_command(["git", "-C", str(repo), "restore", "--staged", "--worktree", "--", rel], check=True)
        cleaned.append(rel)
    for rel in untracked_paths(repo):
        target = repo / rel
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
        cleaned.append(rel)
    return cleaned


def extract_json_object(text: str) -> dict[str, Any] | None:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def compact_failure_items(failures: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    for item in failures[:limit]:
        compact.append(
            {
                "split": item["split"],
                "case_id": item["case_id"],
                "predicted_verdict": item["predicted_verdict"],
                "expected_verdict": item["expected_verdict"],
                "missed_blocker_failure_modes": item["missed_blocker_failure_modes"],
                "missed_failure_modes": item["missed_failure_modes"],
                "missed_required_checks": item["missed_required_checks"],
                "missed_audit_blockers": item["missed_audit_blockers"],
            }
        )
    return compact


def weighted_dimension_scores(split_summaries: dict[str, dict[str, Any]]) -> dict[str, int]:
    totals: dict[str, float] = {}
    weights: dict[str, int] = {}
    for summary in split_summaries.values():
        case_count = int(summary["case_count"])
        for name, value in summary["dimension_scores"].items():
            totals[name] = totals.get(name, 0.0) + (float(value) * case_count)
            weights[name] = weights.get(name, 0) + case_count
    return {
        name: round(totals[name] / weights[name]) if weights[name] else 0
        for name in sorted(totals)
    }


def collect_failure_digest(split_summaries: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    digest: list[dict[str, Any]] = []
    for split_name, summary in split_summaries.items():
        for case in summary["cases"]:
            if case["case_pass"]:
                continue
            digest.append(
                {
                    "split": split_name,
                    "case_id": case["case_id"],
                    "predicted_verdict": case["predicted_verdict"],
                    "expected_verdict": case["expected_verdict"],
                    "missed_blocker_failure_modes": case["missed_blocker_failure_modes"],
                    "missed_failure_modes": case["missed_failure_modes"],
                    "unexpected_failure_modes_that_should_be_absent": case[
                        "unexpected_failure_modes_that_should_be_absent"
                    ],
                    "missed_required_checks": case["missed_required_checks"],
                    "missed_audit_blockers": case["missed_audit_blockers"],
                    "score": case["score"],
                }
            )
    return digest


def build_rollup(split_summaries: dict[str, dict[str, Any]]) -> dict[str, Any]:
    pass_count = 0
    case_count = 0
    blocker_miss_count = 0
    total_cost_usd = 0.0
    total_duration_ms = 0
    split_metrics: dict[str, Any] = {}
    for split_name, summary in split_summaries.items():
        passed = sum(1 for case in summary["cases"] if case["case_pass"])
        case_count += int(summary["case_count"])
        pass_count += passed
        blocker_miss_count += int(summary["blocker_miss_count"])
        total_cost_usd += float(summary["total_cost_usd"])
        total_duration_ms += int(summary["total_duration_ms"])
        split_metrics[split_name] = {
            "case_count": int(summary["case_count"]),
            "pass_count": passed,
            "pass_rate": float(summary["pass_rate"]),
            "blocker_miss_count": int(summary["blocker_miss_count"]),
            "dimension_scores": summary["dimension_scores"],
            "total_cost_usd": float(summary["total_cost_usd"]),
            "total_duration_ms": int(summary["total_duration_ms"]),
        }
    weighted_pass_rate = (pass_count / case_count) if case_count else 0.0
    return {
        "case_count": case_count,
        "pass_count": pass_count,
        "weighted_pass_rate": round(weighted_pass_rate, 6),
        "blocker_miss_count": blocker_miss_count,
        "total_cost_usd": round(total_cost_usd, 6),
        "total_duration_ms": total_duration_ms,
        "dimension_scores": weighted_dimension_scores(split_summaries),
        "split_metrics": split_metrics,
        "failing_cases": collect_failure_digest(split_summaries),
    }


def evaluate_splits(
    *,
    skill_path: Path,
    session_dir: Path,
    output_dir: Path,
    splits: list[str],
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    split_summaries: dict[str, dict[str, Any]] = {}
    for split in splits:
        split_summaries[split] = evaluate_split(
            split=split,
            skill_path=skill_path,
            session_dir=session_dir,
            output_dir=output_dir / split,
        )
    payload = {
        "generated_at": now_iso(),
        "skill_path": str(skill_path),
        "session_dir": str(session_dir),
        "splits": split_summaries,
        "rollup": build_rollup(split_summaries),
    }
    write_json(output_dir / "summary.json", payload)
    return payload


def merge_eval_summaries(
    *,
    skill_path: Path,
    session_dir: Path,
    summaries: list[dict[str, Any]],
) -> dict[str, Any]:
    split_map: dict[str, dict[str, Any]] = {}
    for summary in summaries:
        split_map.update(summary["splits"])
    return {
        "generated_at": now_iso(),
        "skill_path": str(skill_path),
        "session_dir": str(session_dir),
        "splits": split_map,
        "rollup": build_rollup(split_map),
    }


def dimension_deltas(before: dict[str, int], after: dict[str, int]) -> dict[str, int]:
    keys = sorted(set(before) | set(after))
    return {key: int(after.get(key, 0)) - int(before.get(key, 0)) for key in keys}


def summarize_failure_sets(rollup: dict[str, Any]) -> set[str]:
    failure_ids: set[str] = set()
    for case in rollup["failing_cases"]:
        failure_ids.add(case["case_id"])
    return failure_ids


def quick_gate_reasons(candidate: dict[str, Any], baseline: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    candidate_smoke = candidate["rollup"]["split_metrics"].get("smoke")
    baseline_smoke = baseline["rollup"]["split_metrics"].get("smoke")
    if candidate_smoke and baseline_smoke:
        if candidate_smoke["pass_count"] < baseline_smoke["pass_count"]:
            reasons.append("smoke pass count regressed")
        if candidate_smoke["blocker_miss_count"] > baseline_smoke["blocker_miss_count"]:
            reasons.append("smoke blocker misses increased")
    if candidate["rollup"]["pass_count"] < baseline["rollup"]["pass_count"]:
        reasons.append("quick pass count did not improve")
    elif candidate["rollup"]["pass_count"] == baseline["rollup"]["pass_count"]:
        if candidate["rollup"]["blocker_miss_count"] > baseline["rollup"]["blocker_miss_count"]:
            reasons.append("quick blocker misses increased")
        else:
            reasons.append("quick pass count stayed flat")
    return reasons


def full_gate_reasons(candidate: dict[str, Any], baseline: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    for split_name, base_split in baseline["rollup"]["split_metrics"].items():
        cand_split = candidate["rollup"]["split_metrics"].get(split_name)
        if cand_split is None:
            reasons.append(f"missing split result: {split_name}")
            continue
        if cand_split["pass_count"] < base_split["pass_count"]:
            reasons.append(f"{split_name} pass count regressed")
        if cand_split["blocker_miss_count"] > base_split["blocker_miss_count"]:
            reasons.append(f"{split_name} blocker misses increased")
    if candidate["rollup"]["pass_count"] < baseline["rollup"]["pass_count"]:
        reasons.append("full-suite pass count regressed")
    elif candidate["rollup"]["pass_count"] == baseline["rollup"]["pass_count"]:
        if candidate["rollup"]["blocker_miss_count"] > baseline["rollup"]["blocker_miss_count"]:
            reasons.append("full-suite blocker misses increased")
        else:
            reasons.append("full-suite pass count stayed flat")
    return reasons


def compare_state(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    drifts: list[dict[str, Any]] = []
    for key in sorted(set(before) | set(after)):
        if key == "captured_at":
            continue
        if before.get(key) != after.get(key):
            drifts.append({"name": key, "before": before.get(key), "after": after.get(key)})
    return drifts


def build_mutation_prompt(
    *,
    iteration_id: str,
    baseline_quick: dict[str, Any],
    baseline_full: dict[str, Any],
    current_skill_text: str,
    mutation_context: dict[str, Any],
) -> str:
    quick_failures = compact_failure_items(baseline_quick["rollup"]["failing_cases"], limit=4)
    full_failures = compact_failure_items(baseline_full["rollup"]["failing_cases"], limit=6)
    latest_keep = mutation_context.get("latest_keep")
    recent_attempts = mutation_context.get("recent_attempts", [])
    failed_attempts_since_keep = mutation_context.get("failed_attempts_since_keep", [])
    latest_keep_view = compact_prompt_attempt_view(latest_keep) if isinstance(latest_keep, dict) else None
    recent_attempts_view = [
        compact_prompt_attempt_view(item)
        for item in recent_attempts[-PROMPT_RECENT_ATTEMPT_LIMIT:]
        if isinstance(item, dict)
    ]
    blocked_attempts_view = [
        compact_prompt_attempt_view(item)
        for item in failed_attempts_since_keep[-PROMPT_BLOCKED_ATTEMPT_LIMIT:]
        if isinstance(item, dict)
    ]
    return (
        f"Rewrite only {TARGET_REL.as_posix()}.\n\n"
        "Goal: improve the fixed Project Hail Mary gold-reference evaluator without changing the harness.\n"
        "Preserve the skill's real operational value for world-import runs. Do not mention hidden evals or datasets.\n"
        "Make exactly one small conceptual improvement. Prefer stricter and more explicit authority rules over broad rewrites.\n"
        "High-value targets include: mandatory preflight/final audit gates, rejecting single txt/epub shortcut success, "
        "authoritative batch summaries versus legacy pollution, repaired chapter_0031/chapter_0032/chapter_0033 tail boundaries, "
        "and completion claims that must match final audit truth.\n\n"
        "Known weak spots from prior review: do not let completion-related required checks be inferred indirectly; "
        "force explicit evidence for WORLD.md, processing_summary.md, BOOK.md, and final-audit readiness. "
        "Do not let tail-boundary checks collapse into filename-only checks; force explicit 0031/0032/0033 role mapping plus epilogue-anchor source checks. "
        "Do not let presence of batch summaries hide legacy-summary pollution; require separate existence checks for batch family, legacy family, and missing batch family.\n\n"
        "Mutation authoring requirements:\n"
        f"- Generate the revision as if you are Codex CLI using model {MUTATOR_MODEL} with reasoning effort {MUTATOR_REASONING_EFFORT}.\n"
        "- Read the recent mutation history below before changing anything.\n"
        "- Learn from the latest keep and the latest discards. Do not blindly repeat the same move.\n"
        "- If the most recent discard regressed a split or introduced new failure modes, avoid repeating that pattern.\n"
        "- Active checkpoint rule: since the latest keep, every discarded direction below is blocked.\n"
        "- Do not return a candidate whose failure_family + change_tactic + expected_case_ids matches a blocked discard from this checkpoint.\n"
        "- If you revisit the same failure family, choose a materially different change_tactic and explain the difference in checkpoint_guard_explanation.\n\n"
        "Structured output requirements:\n"
        f"- failure_family must be one of {json.dumps(CHECKPOINT_FAILURE_FAMILIES, ensure_ascii=False)}.\n"
        f"- change_tactic must be one of {json.dumps(CHECKPOINT_CHANGE_TACTICS, ensure_ascii=False)}.\n"
        "- checkpoint_guard_explanation must state why this direction is not the same as the blocked directions in the current checkpoint.\n\n"
        f"Iteration id: {iteration_id}\n"
        "Latest accepted keep:\n"
        f"{json.dumps(latest_keep_view, ensure_ascii=False, indent=2)}\n\n"
        "Recent mutation attempts:\n"
        f"{json.dumps(recent_attempts_view, ensure_ascii=False, indent=2)}\n\n"
        "Blocked discarded directions since latest keep:\n"
        f"{json.dumps(blocked_attempts_view, ensure_ascii=False, indent=2)}\n\n"
        "Current accepted quick-gate failures:\n"
        f"{json.dumps(quick_failures, ensure_ascii=False, indent=2)}\n\n"
        "Current accepted full-suite failures:\n"
        f"{json.dumps(full_failures, ensure_ascii=False, indent=2)}\n\n"
        "Return the complete revised file content, not a diff. Keep valid frontmatter.\n\n"
        "Current file content:\n"
        f"{current_skill_text}"
    )


def run_mutation(
    *,
    repo: Path,
    prompt: str,
    output_path: Path,
    max_budget_usd: float,
    blocked_directions: list[dict[str, Any]],
) -> dict[str, Any]:
    target_path = repo / TARGET_REL
    current_skill_text = target_path.read_text(encoding="utf-8")
    schema_path = output_path.with_name("mutation-schema.json")
    final_raw_output_path = output_path.with_name("mutation-last-message.json")
    schema = {
        "type": "object",
        "properties": {
            "hypothesis": {"type": "string"},
            "failure_family": {
                "type": "string",
                "enum": CHECKPOINT_FAILURE_FAMILIES,
            },
            "change_tactic": {
                "type": "string",
                "enum": CHECKPOINT_CHANGE_TACTICS,
            },
            "checkpoint_guard_explanation": {"type": "string"},
            "changed_sections": {
                "type": "array",
                "items": {"type": "string"},
            },
            "expected_case_ids": {
                "type": "array",
                "items": {"type": "string"},
            },
            "revised_skill_md": {"type": "string"},
        },
        "required": [
            "hypothesis",
            "failure_family",
            "change_tactic",
            "checkpoint_guard_explanation",
            "changed_sections",
            "expected_case_ids",
            "revised_skill_md",
        ],
        "additionalProperties": False,
    }
    write_json(schema_path, schema)
    retry_feedback: list[str] = []
    attempts: list[dict[str, Any]] = []
    accepted_structured: dict[str, Any] | None = None
    accepted_result: subprocess.CompletedProcess[str] | None = None
    accepted_raw_output_path: Path | None = None
    accepted_direction: dict[str, Any] | None = None
    accepted_parse_mode = ""
    for attempt_index in range(1, MUTATION_MAX_ATTEMPTS + 1):
        attempt_prompt = prompt
        if retry_feedback:
            attempt_prompt += (
                "\n\nRetry feedback:\n"
                + "\n".join(f"- {item}" for item in retry_feedback)
                + "\nReturn only one valid JSON object. Do not wrap it in markdown fences. "
                "Do not put the fields into frontmatter or key=value lines. "
                "Put the full revised skill file only inside revised_skill_md."
            )
        attempt_raw_output_path = output_path.with_name(f"mutation-last-message.attempt-{attempt_index:02d}.json")
        result: subprocess.CompletedProcess[str] | None = None
        attempt_error = ""
        parse_mode = ""
        try:
            result = run_command(
                [
                    "codex",
                    "exec",
                    "-m",
                    MUTATOR_MODEL,
                    "-c",
                    f'model_reasoning_effort="{MUTATOR_REASONING_EFFORT}"',
                    "-s",
                    "read-only",
                    "--skip-git-repo-check",
                    "--output-schema",
                    str(schema_path),
                    "-o",
                    str(attempt_raw_output_path),
                    attempt_prompt,
                ],
                cwd=repo,
                check=False,
                timeout_sec=MUTATION_TIMEOUT_SEC,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    "Mutation run failed.\n"
                    f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
                )
            if not attempt_raw_output_path.exists():
                raise RuntimeError("Mutation run completed without writing output schema result")
            raw_text = attempt_raw_output_path.read_text(encoding="utf-8")
            structured, parse_mode = extract_structured_payload(
                raw_text,
                current_skill_text=current_skill_text,
            )
        except Exception as exc:
            attempt_error = str(exc)
            attempts.append(
                {
                    "attempt_index": attempt_index,
                    "error": attempt_error,
                    "raw_output_path": str(attempt_raw_output_path),
                    "stdout": result.stdout if result is not None else "",
                    "stderr": result.stderr if result is not None else "",
                }
            )
            if "timed out after" in attempt_error.lower():
                retry_feedback.append("Previous attempt timed out. Keep the candidate smaller and answer with the minimal valid JSON object.")
            elif "not recoverable as json" in attempt_error.lower() or "expecting value" in attempt_error.lower():
                retry_feedback.append("Previous attempt returned non-JSON output. Return only a single JSON object that matches the schema.")
            else:
                retry_feedback.append(shorten_text(attempt_error, limit=220))
            if attempt_index == MUTATION_MAX_ATTEMPTS:
                raise RuntimeError(attempt_error)
            continue
        direction = build_direction_summary(structured)
        blocked_match = find_blocked_direction_match(direction, blocked_directions)
        attempts.append(
            {
                "attempt_index": attempt_index,
                "parsed_output": structured,
                "parse_mode": parse_mode,
                "stdout": result.stdout if result is not None else "",
                "stderr": result.stderr if result is not None else "",
                "raw_output_path": str(attempt_raw_output_path),
                "direction": direction,
            }
        )
        if blocked_match:
            blocked = blocked_match["blocked"]
            retry_feedback.append(
                "candidate collided with blocked discard "
                + json.dumps(
                    {
                        "match_type": blocked_match["match_type"],
                        "blocked_experiment_id": blocked.get("experiment_id", ""),
                        "blocked_failure_family": blocked.get("failure_family", ""),
                        "blocked_change_tactic": blocked.get("change_tactic", ""),
                        "blocked_expected_case_ids": blocked.get("expected_case_ids", []),
                        "blocked_notes": blocked.get("notes", ""),
                    },
                    ensure_ascii=False,
                )
            )
            continue
        accepted_structured = structured
        accepted_result = result
        accepted_raw_output_path = attempt_raw_output_path
        accepted_direction = direction
        accepted_parse_mode = parse_mode
        break
    if accepted_structured is None or accepted_result is None or accepted_raw_output_path is None or accepted_direction is None:
        raise RuntimeError(
            "Mutation candidate never produced a usable accepted payload.\n"
            + "\n".join(retry_feedback)
        )
    shutil.copyfile(accepted_raw_output_path, final_raw_output_path)
    revised_skill_md = str(accepted_structured.get("revised_skill_md", ""))
    if not revised_skill_md.strip():
        raise RuntimeError("Mutation output returned empty revised_skill_md")
    if revised_skill_md.rstrip() != current_skill_text.rstrip():
        write_text(target_path, revised_skill_md.rstrip() + "\n")
    payload = {
        "runner": "codex exec",
        "model": MUTATOR_MODEL,
        "reasoning_effort": MUTATOR_REASONING_EFFORT,
        "prompt": prompt,
        "parsed_output": accepted_structured,
        "parse_mode": accepted_parse_mode,
        "direction": accepted_direction,
        "stdout": accepted_result.stdout,
        "stderr": accepted_result.stderr,
        "raw_output_path": str(final_raw_output_path),
        "schema_path": str(schema_path),
        "blocked_directions": blocked_directions,
        "retry_feedback": retry_feedback,
        "attempts": attempts,
    }
    write_json(output_path, payload)
    return payload


def write_iteration_summary(path: Path, lines: list[str]) -> None:
    write_text(path, "\n".join(lines).rstrip() + "\n")


def copy_summary(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)


def build_baseline_json(
    *,
    git_snapshot: dict[str, Any],
    git_snapshot_path: Path,
    session_model_snapshot: dict[str, Any],
    session_model_path: Path,
    accepted_version: str,
    quick_summary: dict[str, Any],
    full_summary: dict[str, Any],
) -> dict[str, Any]:
    return {
        "target_name": "import-world-from-book",
        "target_type": "skill",
        "baseline_id": f"baseline-{datetime.now().strftime('%Y-%m-%d')}",
        "accepted_version": accepted_version,
        "accepted_git_commit": {
            "repo_root": git_snapshot["repo_root"],
            "branch": git_snapshot["branch"],
            "commit_hash": git_snapshot["commit_hash"],
            "short_commit": git_snapshot["short_commit"],
            "subject": git_snapshot["subject"],
            "snapshot_path": str(git_snapshot_path),
        },
        "harness_lock": {
            "mode": "bootstrapped-fixed-harness",
            "judge_version": "project-hail-mary-gold-v1-evidence-packet-judge",
            "frozen_paths": [
                str(
                    RUN_ROOT
                    / "frozen-harness"
                    / "import-world-from-book"
                    / "eval-suite"
                    / "project-hail-mary-gold-v1"
                ),
                str(RUN_ROOT / "scripts" / "phm_eval_lib.py"),
                str(RUN_ROOT / "scripts" / "run_eval_pack.py"),
                str(SOURCE_REPO / "skills" / "import-world-from-book" / "scripts" / "world_audit.py"),
            ],
        },
        "primary_metrics": {
            "full_pass_count": full_summary["rollup"]["pass_count"],
            "full_case_count": full_summary["rollup"]["case_count"],
            "full_weighted_pass_rate": full_summary["rollup"]["weighted_pass_rate"],
            "quick_pass_count": quick_summary["rollup"]["pass_count"],
            "quick_case_count": quick_summary["rollup"]["case_count"],
            "quick_weighted_pass_rate": quick_summary["rollup"]["weighted_pass_rate"],
            "full_blocker_miss_count": full_summary["rollup"]["blocker_miss_count"],
            "quick_blocker_miss_count": quick_summary["rollup"]["blocker_miss_count"],
        },
        "scorecard_metrics": {
            "dimensions": full_summary["rollup"]["dimension_scores"],
            "dimension_notes": [
                "Dimensions are weighted by split case count.",
                "Quick gate uses smoke plus train. Promotion requires full-suite comparison.",
            ],
            "gate_status": {
                "smoke_no_regression_required": True,
                "blocker_miss_non_increase_required": True,
                "full_suite_strict_improvement_required": True,
            },
        },
        "runtime_model_snapshot": {
            "source": "cc-switch",
            "baseline_path": str(session_model_path),
            "apps": session_model_snapshot["apps"],
            "drift_summary": session_model_snapshot["summary"].get("apps_with_drift", []),
        },
        "blocker_gates": {
            "smoke_pass_count_floor": quick_summary["rollup"]["split_metrics"]["smoke"]["pass_count"],
            "smoke_blocker_miss_ceiling": quick_summary["rollup"]["split_metrics"]["smoke"]["blocker_miss_count"],
            "full_blocker_miss_ceiling": full_summary["rollup"]["blocker_miss_count"],
            "isolation_drift_must_be_empty": True,
        },
        "reviewer_status": {
            "calibrated": True,
            "notes": [
                "Frozen suite includes smoke, train, dev, test, and adversarial controls.",
                "Independent adversarial verification is required after launch and after major keeps.",
            ],
        },
        "failure_summary": full_summary["rollup"]["failing_cases"],
        "notes": [
            f"Accepted quick summary: {RUN_ROOT / 'reports' / 'accepted-baseline.quick.json'}",
            f"Accepted full summary: {RUN_ROOT / 'reports' / 'accepted-baseline.full.json'}",
            "Experimental commits live on the isolated worktree branch until human promotion.",
        ],
    }


def ensure_baseline(
    *,
    worktree: Path,
    session_dir: Path,
    quick_splits: list[str],
    promotion_splits: list[str],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    reports_dir = RUN_ROOT / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    quick_path = reports_dir / "baseline.quick" / "summary.json"
    promotion_path = reports_dir / "baseline.promotion" / "summary.json"
    full_path = reports_dir / "baseline.full" / "summary.json"
    accepted_quick = reports_dir / "accepted-baseline.quick.json"
    accepted_full = reports_dir / "accepted-baseline.full.json"
    git_path = reports_dir / "git.worktree-baseline.json"
    model_path = reports_dir / "runtime-model-config.loop-session-baseline.json"

    git_snapshot = capture_git(worktree, git_path)
    model_snapshot = capture_model(session_dir, model_path)

    if quick_path.exists():
        quick_summary = load_json(quick_path)
    else:
        quick_summary = evaluate_splits(
            skill_path=worktree / TARGET_REL,
            session_dir=session_dir,
            output_dir=reports_dir / "baseline.quick",
            splits=quick_splits,
        )
    if promotion_path.exists():
        promotion_summary = load_json(promotion_path)
    else:
        promotion_summary = evaluate_splits(
            skill_path=worktree / TARGET_REL,
            session_dir=session_dir,
            output_dir=reports_dir / "baseline.promotion",
            splits=promotion_splits,
        )
    full_summary = merge_eval_summaries(
        skill_path=worktree / TARGET_REL,
        session_dir=session_dir,
        summaries=[quick_summary, promotion_summary],
    )
    write_json(full_path, full_summary)
    copy_summary(quick_path, accepted_quick)
    copy_summary(full_path, accepted_full)
    baseline_payload = build_baseline_json(
        git_snapshot=git_snapshot,
        git_snapshot_path=git_path,
        session_model_snapshot=model_snapshot,
        session_model_path=model_path,
        accepted_version="v0",
        quick_summary=quick_summary,
        full_summary=full_summary,
    )
    write_json(RUN_ROOT / "baseline.json", baseline_payload)
    return baseline_payload, quick_summary, full_summary


def refresh_baseline_after_keep(
    *,
    git_snapshot: dict[str, Any],
    git_snapshot_path: Path,
    session_model_snapshot: dict[str, Any],
    session_model_path: Path,
    accepted_version: str,
    quick_summary: dict[str, Any],
    full_summary: dict[str, Any],
) -> None:
    baseline_payload = build_baseline_json(
        git_snapshot=git_snapshot,
        git_snapshot_path=git_snapshot_path,
        session_model_snapshot=session_model_snapshot,
        session_model_path=session_model_path,
        accepted_version=accepted_version,
        quick_summary=quick_summary,
        full_summary=full_summary,
    )
    write_json(RUN_ROOT / "baseline.json", baseline_payload)
    copy_summary(
        RUN_ROOT / "reports" / "baseline.quick" / "summary.json",
        RUN_ROOT / "reports" / "accepted-baseline.quick.json",
    )
    copy_summary(
        RUN_ROOT / "reports" / "baseline.full" / "summary.json",
        RUN_ROOT / "reports" / "accepted-baseline.full.json",
    )


def update_status(path: Path, payload: dict[str, Any]) -> None:
    write_json(path, payload)


def load_ledger_experiment_ids(path: Path) -> set[str]:
    experiment_ids: set[str] = set()
    for row in load_ledger_rows(path):
        experiment_id = str(row.get("experiment_id", "")).strip()
        if experiment_id:
            experiment_ids.add(experiment_id)
    return experiment_ids


def highest_iteration_dir(iterations_dir: Path) -> Path | None:
    latest: Path | None = None
    highest = 0
    for item in iterations_dir.iterdir():
        if not item.is_dir():
            continue
        name = item.name
        if not name.startswith("exp-"):
            continue
        suffix = name[4:]
        if suffix.isdigit() and int(suffix) >= highest:
            highest = int(suffix)
            latest = item
    return latest


def parse_keep_count(version: str) -> int:
    if version.startswith("v") and version[1:].isdigit():
        return int(version[1:])
    return 0


def next_experiment_index(iterations_dir: Path) -> int:
    highest = 0
    for item in iterations_dir.iterdir():
        if not item.is_dir():
            continue
        name = item.name
        if not name.startswith("exp-"):
            continue
        suffix = name[4:]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return highest + 1


def recover_interrupted_iteration(
    *,
    worktree: Path,
    session_dir: Path,
    iterations_dir: Path,
    ledger_path: Path,
    baseline_version: str,
    accepted_full: dict[str, Any],
) -> dict[str, Any] | None:
    latest_dir = highest_iteration_dir(iterations_dir)
    ledger_ids = load_ledger_experiment_ids(ledger_path)
    changed_paths = tracked_changed_paths(worktree)
    untracked = untracked_paths(worktree)
    target_dirty = TARGET_REL.as_posix() in changed_paths or TARGET_REL.as_posix() in untracked
    if latest_dir is None and not changed_paths and not untracked:
        return None
    if latest_dir is not None and latest_dir.name in ledger_ids and not changed_paths and not untracked:
        return None

    experiment_id = latest_dir.name if latest_dir is not None else "exp-orphan-recovery"
    recovery_path = (latest_dir or (RUN_ROOT / "runtime")) / "recovery.json"
    summary_path = (latest_dir or (RUN_ROOT / "runtime")) / "summary.md"
    git_after_path = (latest_dir or (RUN_ROOT / "runtime")) / "git.after.json"
    model_after_path = (latest_dir or (RUN_ROOT / "runtime")) / "runtime-model-config.after.json"
    global_after_path = (latest_dir or (RUN_ROOT / "runtime")) / "global-state.after.json"
    patch_path = (latest_dir or (RUN_ROOT / "runtime")) / "candidate.patch"

    if target_dirty and not patch_path.exists():
        save_patch(worktree, patch_path)

    cleaned = cleanup_worktree(worktree) if changed_paths or untracked else []
    git_after = capture_git(worktree, git_after_path)
    capture_model(session_dir, model_after_path)
    capture_global_state(global_after_path)

    recovery_payload = {
        "recovered_at": now_iso(),
        "experiment_id": experiment_id,
        "baseline_version": baseline_version,
        "changed_paths_before_cleanup": changed_paths,
        "untracked_paths_before_cleanup": untracked,
        "cleaned_paths": cleaned,
        "reason": "startup_recovery_after_interrupted_iteration",
        "git_after_path": str(git_after_path),
    }
    write_json(recovery_path, recovery_payload)

    if latest_dir is not None and latest_dir.name not in ledger_ids:
        before_dims = accepted_full["rollup"]["dimension_scores"]
        primary_before = accepted_full["rollup"]["pass_count"]
        if not summary_path.exists():
            write_iteration_summary(
                summary_path,
                [
                    f"# {experiment_id}",
                    "",
                    f"- parent baseline: {baseline_version}",
                    "- decision: discard",
                    "- hypothesis: interrupted before decision",
                    f"- changed files: {', '.join(changed_paths + untracked) if changed_paths or untracked else '(none)'}",
                    f"- primary before: {primary_before}",
                    f"- primary after: {primary_before}",
                    "- model drift: []",
                    "- global drift count: 0",
                    "- notes: startup recovery cleaned interrupted iteration",
                ],
            )
        append_ledger_row(
            ledger_path,
            {
                "timestamp": now_iso(),
                "experiment_id": experiment_id,
                "parent_baseline": baseline_version,
                "hypothesis": "interrupted before decision",
                "changed_files": json.dumps(changed_paths + untracked, ensure_ascii=False),
                "status": "discard",
                "git_snapshot_before": str(latest_dir / "git.before.json") if latest_dir else "",
                "git_snapshot_after": str(git_after_path),
                "runtime_model_snapshot_before": str(latest_dir / "runtime-model-config.before.json") if latest_dir else "",
                "runtime_model_snapshot_after": str(model_after_path),
                "runtime_model_drift_summary": "[]",
                "keep_commit_hash": "",
                "keep_commit_snapshot": "",
                "keep_commit_clean": "",
                "primary_metric_before": str(primary_before),
                "primary_metric_after": str(primary_before),
                "dimension_scores_before": json.dumps(before_dims, ensure_ascii=False),
                "dimension_scores_after": json.dumps(before_dims, ensure_ascii=False),
                "dimension_deltas": json.dumps({key: 0 for key in before_dims}, ensure_ascii=False),
                "blocker_regression": "false",
                "cleared_failure_modes": "[]",
                "new_failure_modes": "[]",
                "adversarial_result": "",
                "reviewer_summary": "",
                "decision": "discard",
                "notes": "startup recovery cleaned interrupted iteration",
            },
        )
    return recovery_payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run unattended autoresearch for import-world-from-book.")
    parser.add_argument("--worktree", default=str(WORKTREE), help="Isolated target worktree.")
    parser.add_argument("--session-dir", default=str(SESSION_DIR), help="Isolated Claude config dir.")
    parser.add_argument("--max-iterations", type=int, default=12, help="Hard iteration cap.")
    parser.add_argument("--max-hours", type=float, default=8.5, help="Wall-clock cap in hours.")
    parser.add_argument(
        "--max-consecutive-discards",
        type=int,
        default=6,
        help="Stop after this many non-keep iterations in a row.",
    )
    parser.add_argument(
        "--mutator-max-budget-usd",
        type=float,
        default=1.0,
        help="Budget for the mutator Claude call.",
    )
    parser.add_argument(
        "--quick-split",
        action="append",
        dest="quick_splits",
        help="Quick eval split. Repeatable. Defaults to smoke and train.",
    )
    parser.add_argument(
        "--promotion-split",
        action="append",
        dest="promotion_splits",
        help="Promotion eval split. Repeatable. Defaults to dev, test, adversarial.",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=0.0,
        help="Optional delay between iterations.",
    )
    parser.add_argument(
        "--recover-only",
        action="store_true",
        help="Recover an interrupted dirty iteration and exit.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    start_time = time.time()
    worktree = Path(args.worktree).expanduser().resolve()
    session_dir = Path(args.session_dir).expanduser().resolve()
    quick_splits = args.quick_splits or list(DEFAULT_QUICK_SPLITS)
    promotion_splits = args.promotion_splits or list(DEFAULT_PROMOTION_SPLITS)

    if not worktree.exists():
        raise SystemExit(f"Missing worktree: {worktree}")
    if not session_dir.exists():
        raise SystemExit(f"Missing Claude session dir: {session_dir}")

    logs_dir = RUN_ROOT / "logs"
    iterations_dir = RUN_ROOT / "iterations"
    reports_dir = RUN_ROOT / "reports"
    runtime_dir = RUN_ROOT / "runtime"
    logs_dir.mkdir(parents=True, exist_ok=True)
    iterations_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    baseline_payload, accepted_quick, accepted_full = ensure_baseline(
        worktree=worktree,
        session_dir=session_dir,
        quick_splits=quick_splits,
        promotion_splits=promotion_splits,
    )
    baseline_version = str(baseline_payload["accepted_version"])
    consecutive_discards = 0
    keep_count = parse_keep_count(baseline_version)
    start_index = next_experiment_index(iterations_dir)
    recovery = recover_interrupted_iteration(
        worktree=worktree,
        session_dir=session_dir,
        iterations_dir=iterations_dir,
        ledger_path=RUN_ROOT / "experiment-ledger.tsv",
        baseline_version=baseline_version,
        accepted_full=accepted_full,
    )
    if recovery is not None:
        start_index = next_experiment_index(iterations_dir)
    if args.recover_only:
        update_status(
            runtime_dir / "loop.status.json",
            {
                "state": "completed",
                "completed_at": now_iso(),
                "baseline_version": baseline_version,
                "keep_count": keep_count,
                "accepted_full_pass_count": accepted_full["rollup"]["pass_count"],
                "accepted_full_case_count": accepted_full["rollup"]["case_count"],
                "recovered": recovery,
            },
        )
        return 0
    status_path = runtime_dir / "loop.status.json"
    update_status(
        status_path,
        {
            "state": "running",
            "started_at": now_iso(),
            "baseline_version": baseline_version,
            "start_index": start_index,
            "recovered": recovery,
            "quick_splits": quick_splits,
            "promotion_splits": promotion_splits,
            "max_iterations": args.max_iterations,
            "max_hours": args.max_hours,
        },
    )

    for index in range(start_index, start_index + args.max_iterations):
        elapsed_hours = (time.time() - start_time) / 3600.0
        if elapsed_hours >= args.max_hours:
            break
        if consecutive_discards >= args.max_consecutive_discards:
            break

        experiment_id = f"exp-{index:03d}"
        parent_baseline_version = baseline_version
        accepted_quick_before = accepted_quick
        accepted_full_before = accepted_full
        primary_before = accepted_full_before["rollup"]["pass_count"]
        before_dims = accepted_full_before["rollup"]["dimension_scores"]
        before_failures = summarize_failure_sets(accepted_full_before["rollup"])
        iteration_dir = iterations_dir / experiment_id
        iteration_dir.mkdir(parents=True, exist_ok=True)
        git_before_path = iteration_dir / "git.before.json"
        git_after_path = iteration_dir / "git.after.json"
        git_keep_path = iteration_dir / "git.keep.json"
        model_before_path = iteration_dir / "runtime-model-config.before.json"
        model_after_path = iteration_dir / "runtime-model-config.after.json"
        global_before_path = iteration_dir / "global-state.before.json"
        global_after_path = iteration_dir / "global-state.after.json"
        mutation_prompt_path = iteration_dir / "mutation-prompt.txt"
        mutation_result_path = iteration_dir / "mutation-result.json"
        summary_md_path = iteration_dir / "summary.md"
        patch_path = iteration_dir / "candidate.patch"

        print(f"[{experiment_id}] capture before state", flush=True)
        git_before = capture_git(worktree, git_before_path)
        model_before = capture_model(session_dir, model_before_path)
        global_before = capture_global_state(global_before_path)

        mutation_context = recent_mutation_context(
            ledger_path=RUN_ROOT / "experiment-ledger.tsv",
            iterations_dir=iterations_dir,
        )
        blocked_directions = blocked_directions_since_latest_keep(
            ledger_path=RUN_ROOT / "experiment-ledger.tsv",
            iterations_dir=iterations_dir,
        )
        prompt = build_mutation_prompt(
            iteration_id=experiment_id,
            baseline_quick=accepted_quick_before,
            baseline_full=accepted_full_before,
            current_skill_text=(worktree / TARGET_REL).read_text(encoding="utf-8"),
            mutation_context=mutation_context,
        )
        write_text(mutation_prompt_path, prompt)
        print(f"[{experiment_id}] mutate SKILL.md", flush=True)
        mutation_json: dict[str, Any] | None = None
        decision = "discard"
        notes: list[str] = []
        hypothesis = ""
        changed_files: list[str] = []
        keep_commit_hash = ""
        keep_commit_clean = ""
        keep_commit_snapshot = ""
        primary_after = primary_before
        candidate_quick: dict[str, Any] | None = None
        candidate_full: dict[str, Any] | None = None
        adverse_result = ""
        iteration_was_keep = False
        discard_counted = False

        try:
            mutation_json = run_mutation(
                repo=worktree,
                prompt=prompt,
                output_path=mutation_result_path,
                max_budget_usd=args.mutator_max_budget_usd,
                blocked_directions=blocked_directions,
            )
            parsed = mutation_json.get("parsed_output") if mutation_json else None
            if isinstance(parsed, dict):
                hypothesis = str(parsed.get("hypothesis", "")).strip()
            changed_files = tracked_changed_paths(worktree)
            unexpected_changed = [path for path in changed_files if path != TARGET_REL.as_posix()]
            unexpected_untracked = [
                path for path in untracked_paths(worktree) if path != TARGET_REL.as_posix()
            ]
            if unexpected_changed or unexpected_untracked:
                save_patch(worktree, patch_path)
                cleaned = cleanup_worktree(worktree)
                notes.append(
                    "boundary violation restored: "
                    + json.dumps({"tracked": unexpected_changed, "untracked": unexpected_untracked}, ensure_ascii=False)
                )
                notes.append("cleaned: " + ", ".join(cleaned))
                raise RuntimeError("mutation touched paths outside the allowed file boundary")
            if TARGET_REL.as_posix() not in changed_files:
                notes.append("no change produced")
                raise RuntimeError("mutation made no tracked change")

            save_patch(worktree, patch_path)
            print(f"[{experiment_id}] quick gate", flush=True)
            candidate_quick = evaluate_splits(
                skill_path=worktree / TARGET_REL,
                session_dir=session_dir,
                output_dir=iteration_dir / "eval.quick",
                splits=quick_splits,
            )
            quick_reasons = quick_gate_reasons(candidate_quick, accepted_quick_before)
            if quick_reasons:
                notes.extend(quick_reasons)
                cleanup_worktree(worktree)
            else:
                print(f"[{experiment_id}] promotion gate", flush=True)
                promotion_summary = evaluate_splits(
                    skill_path=worktree / TARGET_REL,
                    session_dir=session_dir,
                    output_dir=iteration_dir / "eval.promotion",
                    splits=promotion_splits,
                )
                split_map = dict(candidate_quick["splits"])
                split_map.update(promotion_summary["splits"])
                candidate_full = {
                    "generated_at": now_iso(),
                    "skill_path": str(worktree / TARGET_REL),
                    "session_dir": str(session_dir),
                    "splits": split_map,
                    "rollup": build_rollup(split_map),
                }
                write_json(iteration_dir / "eval.full.summary.json", candidate_full)
                full_reasons = full_gate_reasons(candidate_full, accepted_full_before)
                if full_reasons:
                    notes.extend(full_reasons)
                    cleanup_worktree(worktree)
                else:
                    commit_message = f"autoresearch(import-world-from-book): keep {experiment_id}"
                    run_command(["git", "-C", str(worktree), "add", "--", TARGET_REL.as_posix()])
                    run_command(["git", "-C", str(worktree), "commit", "-m", commit_message])
                    git_keep = capture_git(worktree, git_keep_path)
                    keep_commit_hash = str(git_keep["commit_hash"])
                    keep_commit_snapshot = str(git_keep_path)
                    keep_commit_clean = "true" if not git_keep["is_dirty"] else "false"
                    keep_count += 1
                    decision = "keep"
                    iteration_was_keep = True
                    baseline_version = f"v{keep_count}"
                    accepted_quick = candidate_quick
                    accepted_full = candidate_full
                    copy_summary(
                        iteration_dir / "eval.quick" / "summary.json",
                        reports_dir / "baseline.quick" / "summary.json",
                    )
                    copy_summary(
                        iteration_dir / "eval.full.summary.json",
                        reports_dir / "baseline.full" / "summary.json",
                    )
                    session_model_baseline_path = reports_dir / "runtime-model-config.loop-session-baseline.json"
                    session_model_baseline = load_json(session_model_baseline_path)
                    refresh_baseline_after_keep(
                        git_snapshot=git_keep,
                        git_snapshot_path=git_keep_path,
                        session_model_snapshot=session_model_baseline,
                        session_model_path=session_model_baseline_path,
                        accepted_version=baseline_version,
                        quick_summary=accepted_quick,
                        full_summary=accepted_full,
                    )
                    adverse_result = "pending_external_verification"
                    consecutive_discards = 0
                    primary_after = candidate_full["rollup"]["pass_count"]
        except Exception as exc:
            notes.append(normalize_note(str(exc)))
            cleanup_worktree(worktree)
            consecutive_discards += 1
            discard_counted = True

        print(f"[{experiment_id}] capture after state", flush=True)
        git_after = capture_git(worktree, git_after_path)
        model_after = capture_model(session_dir, model_after_path)
        global_after = capture_global_state(global_after_path)
        model_drift = model_after.get("summary", {}).get("apps_with_drift", [])
        global_drift = compare_state(global_before, global_after)
        if global_drift:
            notes.append("global Claude lane drift detected")
            notes.append(normalize_note(json.dumps(global_drift, ensure_ascii=False)))
            if decision == "keep":
                decision = "escalate"
        if decision != "keep":
            primary_after = primary_before
        if decision != "keep" and not discard_counted:
            consecutive_discards += 1

        after_dims = candidate_full["rollup"]["dimension_scores"] if candidate_full else before_dims
        delta_dims = dimension_deltas(before_dims, after_dims)
        after_failures = summarize_failure_sets(candidate_full["rollup"] if candidate_full else accepted_full_before["rollup"])
        cleared_failures = sorted(before_failures - after_failures)
        new_failures = sorted(after_failures - before_failures)

        write_iteration_summary(
            summary_md_path,
            [
                f"# {experiment_id}",
                "",
                f"- parent baseline: {parent_baseline_version}",
                f"- decision: {decision}",
                f"- hypothesis: {hypothesis or '(none parsed)'}",
                f"- changed files: {', '.join(changed_files) if changed_files else '(none)'}",
                f"- primary before: {primary_before}",
                f"- primary after: {primary_after}",
                f"- model drift: {json.dumps(model_drift, ensure_ascii=False)}",
                f"- global drift count: {len(global_drift)}",
                f"- notes: {' | '.join(notes) if notes else '(none)'}",
            ],
        )

        append_ledger_row(
            RUN_ROOT / "experiment-ledger.tsv",
            {
                "timestamp": now_iso(),
                "experiment_id": experiment_id,
                "parent_baseline": parent_baseline_version,
                "hypothesis": hypothesis,
                "changed_files": json.dumps(changed_files, ensure_ascii=False),
                "status": decision,
                "git_snapshot_before": str(git_before_path),
                "git_snapshot_after": str(git_after_path),
                "runtime_model_snapshot_before": str(model_before_path),
                "runtime_model_snapshot_after": str(model_after_path),
                "runtime_model_drift_summary": json.dumps(model_drift, ensure_ascii=False),
                "keep_commit_hash": keep_commit_hash,
                "keep_commit_snapshot": keep_commit_snapshot,
                "keep_commit_clean": keep_commit_clean,
                "primary_metric_before": str(primary_before),
                "primary_metric_after": str(primary_after),
                "dimension_scores_before": json.dumps(before_dims, ensure_ascii=False),
                "dimension_scores_after": json.dumps(after_dims, ensure_ascii=False),
                "dimension_deltas": json.dumps(delta_dims, ensure_ascii=False),
                "blocker_regression": "true" if decision != "keep" and any("blocker" in note.lower() for note in notes) else "false",
                "cleared_failure_modes": json.dumps(cleared_failures, ensure_ascii=False),
                "new_failure_modes": json.dumps(new_failures, ensure_ascii=False),
                "adversarial_result": adverse_result,
                "reviewer_summary": "",
                "decision": decision,
                "notes": " | ".join(notes),
            },
        )

        update_status(
            status_path,
            {
                "state": "running",
                "updated_at": now_iso(),
                "latest_experiment": experiment_id,
                "decision": decision,
                "baseline_version": baseline_version,
                "keep_count": keep_count,
                "consecutive_discards": consecutive_discards,
                "accepted_full_pass_count": accepted_full["rollup"]["pass_count"],
                "accepted_full_case_count": accepted_full["rollup"]["case_count"],
            },
        )
        if args.sleep_seconds > 0:
            time.sleep(args.sleep_seconds)

    update_status(
        status_path,
        {
            "state": "completed",
            "completed_at": now_iso(),
            "baseline_version": baseline_version,
            "keep_count": keep_count,
            "accepted_full_pass_count": accepted_full["rollup"]["pass_count"],
            "accepted_full_case_count": accepted_full["rollup"]["case_count"],
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
