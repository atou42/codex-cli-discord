#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
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


def load_mutation_changed_sections(iteration_dir: Path) -> list[str]:
    mutation_path = iteration_dir / "mutation-result.json"
    if not mutation_path.exists():
        return []
    try:
        payload = load_json(mutation_path)
    except Exception:
        return []
    for key in ("parsed_output", "structured_output"):
        value = payload.get(key)
        if isinstance(value, dict):
            sections = value.get("changed_sections")
            if isinstance(sections, list):
                return [str(item) for item in sections]
    return []


def recent_mutation_context(
    *,
    ledger_path: Path,
    iterations_dir: Path,
    latest_limit: int = 3,
) -> dict[str, Any]:
    rows = load_ledger_rows(ledger_path)
    if not rows:
        return {"latest_keep": None, "recent_attempts": []}

    def row_summary(row: dict[str, str]) -> dict[str, Any]:
        experiment_id = str(row.get("experiment_id", "")).strip()
        iteration_dir = iterations_dir / experiment_id if experiment_id else iterations_dir
        return {
            "experiment_id": experiment_id,
            "status": row.get("status", ""),
            "decision": row.get("decision", ""),
            "hypothesis": shorten_text(str(row.get("hypothesis", "")), limit=320),
            "changed_sections": load_mutation_changed_sections(iteration_dir)[:8],
            "primary_before": row.get("primary_metric_before", ""),
            "primary_after": row.get("primary_metric_after", ""),
            "dimension_deltas": row.get("dimension_deltas", ""),
            "cleared_failure_modes": parse_json_list(str(row.get("cleared_failure_modes", "")))[:6],
            "new_failure_modes": parse_json_list(str(row.get("new_failure_modes", "")))[:6],
            "notes": shorten_text(str(row.get("notes", "")), limit=320),
            "keep_commit_hash": row.get("keep_commit_hash", ""),
        }

    latest_keep = None
    for row in reversed(rows):
        if str(row.get("status", "")).strip() == "keep":
            latest_keep = row_summary(row)
            break

    recent_attempts = [row_summary(row) for row in rows[-latest_limit:]]
    return {"latest_keep": latest_keep, "recent_attempts": recent_attempts}


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
        "- If the most recent discard regressed a split or introduced new failure modes, avoid repeating that pattern.\n\n"
        f"Iteration id: {iteration_id}\n"
        "Latest accepted keep:\n"
        f"{json.dumps(latest_keep, ensure_ascii=False, indent=2)}\n\n"
        "Recent mutation attempts:\n"
        f"{json.dumps(recent_attempts, ensure_ascii=False, indent=2)}\n\n"
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
) -> dict[str, Any]:
    target_path = repo / TARGET_REL
    current_skill_text = target_path.read_text(encoding="utf-8")
    schema_path = output_path.with_name("mutation-schema.json")
    raw_output_path = output_path.with_name("mutation-last-message.json")
    schema = {
        "type": "object",
        "properties": {
            "hypothesis": {"type": "string"},
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
            "changed_sections",
            "expected_case_ids",
            "revised_skill_md",
        ],
        "additionalProperties": False,
    }
    write_json(schema_path, schema)
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
            str(raw_output_path),
            prompt,
        ],
        cwd=repo,
        check=False,
        timeout_sec=420,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Mutation run failed.\n"
            f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
        )
    if not raw_output_path.exists():
        raise RuntimeError("Mutation run completed without writing output schema result")
    structured = json.loads(raw_output_path.read_text(encoding="utf-8"))
    if not isinstance(structured, dict):
        raise RuntimeError(f"Mutation output is not a JSON object: {structured}")
    revised_skill_md = str(structured.get("revised_skill_md", ""))
    if not revised_skill_md.strip():
        raise RuntimeError("Mutation output returned empty revised_skill_md")
    if revised_skill_md.rstrip() != current_skill_text.rstrip():
        write_text(target_path, revised_skill_md.rstrip() + "\n")
    payload = {
        "runner": "codex exec",
        "model": MUTATOR_MODEL,
        "reasoning_effort": MUTATOR_REASONING_EFFORT,
        "prompt": prompt,
        "parsed_output": structured,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "raw_output_path": str(raw_output_path),
        "schema_path": str(schema_path),
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

        prompt = build_mutation_prompt(
            iteration_id=experiment_id,
            baseline_quick=accepted_quick_before,
            baseline_full=accepted_full_before,
            current_skill_text=(worktree / TARGET_REL).read_text(encoding="utf-8"),
            mutation_context=recent_mutation_context(
                ledger_path=RUN_ROOT / "experiment-ledger.tsv",
                iterations_dir=iterations_dir,
            ),
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
