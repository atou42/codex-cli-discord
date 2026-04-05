#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(
    "/Users/atou/agents-in-discord/workspaces/1489917815896019064/autoresearch-runs/import-world-from-book-phm-loop-20260405"
)
REPO_ROOT = Path("/Users/atou/codex-skills-macmini-local")
TARGET_SKILL = REPO_ROOT / "skills" / "import-world-from-book" / "SKILL.md"
WORLD_AUDIT = REPO_ROOT / "skills" / "import-world-from-book" / "scripts" / "world_audit.py"
FROZEN_SUITE = ROOT / "frozen-harness" / "import-world-from-book" / "eval-suite" / "project-hail-mary-gold-v1"
CLAUDE_SESSION = ROOT / "runtime" / "loop-claude-session"
ALLOWED_VERDICTS = ["pass", "fail", "needs_human"]
YAML_LOAD_TIMEOUT_SEC = 30
WORLD_AUDIT_TIMEOUT_SEC = 60
CLAUDE_JUDGE_TIMEOUT_SEC = 210
ANCHOR_TERMS = [
    "我肉汉堡",
    "30名波江座人维护生命保障系统",
    "第二大的科学主题合鸣",
    "太阳恢复正常亮度",
    "30个波江座儿童",
    "光速是多少",
]
STATUS_LINE_RE = re.compile(r"(完成|complete|ready|待补充|placeholder)", re.IGNORECASE)
LEGACY_SUMMARY_RE = re.compile(r"^chapter_\d{2}\.md$")
BATCH_SUMMARY_RE = re.compile(r"^chapter_\d{4}-\d{4}\.md$")


@dataclass
class ClaudeRunResult:
    raw: dict[str, Any]
    structured_output: dict[str, Any]
    cost_usd: float
    duration_ms: int


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_command(
    command: list[str],
    *,
    env: dict[str, str] | None = None,
    timeout_sec: int | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            text=True,
            capture_output=True,
            env=env,
            timeout=timeout_sec,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout.decode("utf-8", errors="replace") if exc.stdout else "")
        stderr = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr.decode("utf-8", errors="replace") if exc.stderr else "")
        raise RuntimeError(
            f"Command timed out after {timeout_sec}s: {' '.join(command)}\nstdout={stdout}\nstderr={stderr}"
        ) from exc


def load_yaml(path: Path) -> dict[str, Any]:
    command = [
        "ruby",
        "-rjson",
        "-ryaml",
        "-e",
        "print JSON.generate(YAML.load_file(ARGV[0]))",
        str(path),
    ]
    result = run_command(command, timeout_sec=YAML_LOAD_TIMEOUT_SEC)
    if result.returncode != 0:
        raise RuntimeError(f"Failed to load YAML {path}: {result.stderr}")
    return json.loads(result.stdout)


def write_json(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_cases(split: str) -> list[dict[str, Any]]:
    data = load_yaml(FROZEN_SUITE / "datasets" / split / "cases.yaml")
    return list(data["cases"])


def load_failure_mode_ids() -> list[str]:
    data = load_yaml(FROZEN_SUITE / "failure-modes.yaml")
    return [item["id"] for item in data["failure_modes"]]


def collect_required_check_ids() -> list[str]:
    values: set[str] = set()
    for split in ("smoke", "train", "dev", "test", "adversarial"):
        for case in load_cases(split):
            for item in case.get("expected", {}).get("required_checks", []):
                values.add(str(item))
    return sorted(values)


def extract_heading(path: Path) -> str | None:
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.lstrip().startswith("# "):
            return line.lstrip()[2:].strip()
    return None


def grep_lines(path: Path, terms: list[str], limit: int = 5) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    matches: list[dict[str, Any]] = []
    for md in sorted(path.rglob("*.md")):
        rel = md.relative_to(path).as_posix()
        for line_number, line in enumerate(md.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
            for term in terms:
                if term in line:
                    matches.append(
                        {
                            "file": rel,
                            "line": line_number,
                            "term": term,
                            "text": line.strip(),
                        }
                    )
                    if len(matches) >= limit:
                        return matches
    return matches


def collect_status_snippets(world_root: Path) -> dict[str, list[str]]:
    results: dict[str, list[str]] = {}
    for name in ("WORLD.md", "BOOK.md", "processing_summary.md", "timeline.md"):
        path = world_root / name
        if not path.exists():
            continue
        lines = []
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if STATUS_LINE_RE.search(line):
                lines.append(line.strip())
            if len(lines) >= 8:
                break
        if lines:
            results[name] = lines
    return results


def run_world_audit(input_path: Path, mode: str) -> dict[str, Any]:
    result = run_command(
        ["python3", str(WORLD_AUDIT), str(input_path), "--mode", mode],
        timeout_sec=WORLD_AUDIT_TIMEOUT_SEC,
    )
    if result.returncode != 0:
        raise RuntimeError(f"world_audit failed for {input_path} {mode}: {result.stderr}")
    return json.loads(result.stdout)


def build_evidence(case: dict[str, Any]) -> dict[str, Any]:
    input_kind = str(case["input"]["kind"])
    input_path = Path(str(case["input"]["path"]))
    preflight = run_world_audit(input_path, "preflight")
    final = run_world_audit(input_path, "final")
    evidence: dict[str, Any] = {
        "case_id": case["id"],
        "description": case["description"],
        "input_kind": input_kind,
        "input_path": str(input_path),
        "preflight": preflight,
        "final": final,
    }

    if input_kind == "world_root":
        world_root = input_path
        raw_text_dir = world_root / "raw_text"
        volume_dir = world_root / "story" / "volumes"
        volume_files = sorted(path.name for path in volume_dir.glob("*.md")) if volume_dir.is_dir() else []
        canonical_count = int(final.get("canonical_chapter_count", 0))
        tail_candidates = [
            raw_text_dir / "chapter_0031.md",
            raw_text_dir / "chapter_0032.md",
            raw_text_dir / "chapter_0033.md",
        ]
        tail_files = []
        for item in tail_candidates:
            tail_files.append(
                {
                    "file": item.name,
                    "exists": item.exists(),
                    "heading": extract_heading(item),
                }
            )

        evidence["world_root_snapshot"] = {
            "volume_files": volume_files,
            "has_batch_summaries": any(BATCH_SUMMARY_RE.match(name) for name in volume_files),
            "has_legacy_single_chapter_summaries": any(
                LEGACY_SUMMARY_RE.match(name) for name in volume_files
            ),
            "canonical_chapter_count": canonical_count,
            "tail_files": tail_files,
            "status_snippets": collect_status_snippets(world_root),
            "anchor_matches": grep_lines(world_root, ANCHOR_TERMS, limit=12),
        }
    else:
        evidence["world_root_snapshot"] = None

    return evidence


def build_schema(required_check_ids: list[str], failure_mode_ids: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ALLOWED_VERDICTS},
            "failure_modes_present": {
                "type": "array",
                "items": {"type": "string", "enum": failure_mode_ids},
                "uniqueItems": True,
            },
            "required_checks_true": {
                "type": "array",
                "items": {"type": "string", "enum": required_check_ids},
                "uniqueItems": True,
            },
            "audit_blockers_true": {
                "type": "array",
                "items": {"type": "string"},
                "uniqueItems": True,
            },
            "rationale": {"type": "string"},
        },
        "required": [
            "verdict",
            "failure_modes_present",
            "required_checks_true",
            "audit_blockers_true",
            "rationale",
        ],
        "additionalProperties": False,
    }


def make_system_prompt(skill_text: str) -> str:
    return (
        "You are evaluating the current import-world-from-book skill.\n"
        "Apply the skill exactly as written.\n"
        "Do not use any external context. Do not invent facts. Use only the evidence packet.\n"
        "If evidence is insufficient, use verdict needs_human.\n\n"
        "Current skill file:\n\n"
        f"{skill_text}"
    )


def make_user_prompt(
    case: dict[str, Any],
    evidence: dict[str, Any],
    failure_mode_ids: list[str],
    required_check_ids: list[str],
) -> str:
    return (
        "Judge whether the candidate is authoritative enough to serve as the Project Hail Mary gold eval sample.\n"
        "Return only the structured result.\n\n"
        f"Case id: {case['id']}\n"
        f"Case description: {case['description']}\n"
        f"Allowed failure mode ids: {', '.join(failure_mode_ids)}\n"
        f"Allowed required check ids: {', '.join(required_check_ids)}\n\n"
        "Evidence packet JSON:\n"
        f"{json.dumps(evidence, ensure_ascii=False, indent=2)}"
    )


def run_claude_judge(
    *,
    skill_path: Path,
    case: dict[str, Any],
    evidence: dict[str, Any],
    session_dir: Path,
    max_budget_usd: float = 0.35,
) -> ClaudeRunResult:
    failure_mode_ids = load_failure_mode_ids()
    required_check_ids = collect_required_check_ids()
    schema = build_schema(required_check_ids, failure_mode_ids)
    skill_text = skill_path.read_text(encoding="utf-8")
    command = [
        "claude",
        "-p",
        "--tools",
        "",
        "--dangerously-skip-permissions",
        "--output-format",
        "json",
        "--json-schema",
        json.dumps(schema, ensure_ascii=False),
        "--max-budget-usd",
        str(max_budget_usd),
        "--system-prompt",
        make_system_prompt(skill_text),
        make_user_prompt(case, evidence, failure_mode_ids, required_check_ids),
    ]
    env = dict(os.environ)
    env["CLAUDE_CONFIG_DIR"] = str(session_dir)
    result = run_command(command, env=env, timeout_sec=CLAUDE_JUDGE_TIMEOUT_SEC)
    if result.returncode != 0:
        raise RuntimeError(f"claude judge failed: {result.stderr}\nstdout={result.stdout}")
    payload = json.loads(result.stdout)
    structured = payload.get("structured_output")
    if not isinstance(structured, dict):
        raise RuntimeError(f"Missing structured_output in Claude payload: {payload}")
    return ClaudeRunResult(
        raw=payload,
        structured_output=structured,
        cost_usd=float(payload.get("total_cost_usd", 0.0)),
        duration_ms=int(payload.get("duration_ms", 0)),
    )


def score_case(case: dict[str, Any], structured_output: dict[str, Any]) -> dict[str, Any]:
    expected = case.get("expected", {})
    predicted_modes = set(structured_output.get("failure_modes_present", []))
    predicted_checks = set(structured_output.get("required_checks_true", []))
    predicted_blockers = set(structured_output.get("audit_blockers_true", []))
    verdict = str(structured_output.get("verdict"))

    expected_blocker_modes = set(expected.get("blocker_failure_modes_present", []))
    expected_modes = set(expected.get("failure_modes_present", []))
    expected_absent = set(expected.get("failure_modes_absent", []))
    expected_checks = set(expected.get("required_checks", []))
    expected_audit_blockers = set(expected.get("known_audit_blockers", []))

    missed_blockers = sorted(expected_blocker_modes - predicted_modes)
    missed_modes = sorted(expected_modes - predicted_modes)
    false_present_absent = sorted(predicted_modes & expected_absent)
    missed_checks = sorted(expected_checks - predicted_checks)
    missed_audit_blockers = sorted(expected_audit_blockers - predicted_blockers)
    verdict_correct = verdict == str(expected.get("verdict"))

    score = 0.0
    score += 30.0 if verdict_correct else 0.0
    score += 40.0 if not expected_blocker_modes else 40.0 * (
        (len(expected_blocker_modes) - len(missed_blockers)) / len(expected_blocker_modes)
    )
    score += 15.0 if not expected_modes else 15.0 * (
        (len(expected_modes) - len(missed_modes)) / len(expected_modes)
    )
    score += 10.0 if not expected_checks else 10.0 * (
        (len(expected_checks) - len(missed_checks)) / len(expected_checks)
    )
    score += 5.0 if not expected_audit_blockers else 5.0 * (
        (len(expected_audit_blockers) - len(missed_audit_blockers)) / len(expected_audit_blockers)
    )
    if false_present_absent:
        score = max(0.0, score - 20.0)

    case_pass = (
        verdict_correct
        and not missed_blockers
        and not missed_modes
        and not false_present_absent
        and not missed_checks
        and not missed_audit_blockers
    )

    return {
        "case_id": case["id"],
        "expected_verdict": expected.get("verdict"),
        "predicted_verdict": verdict,
        "verdict_correct": verdict_correct,
        "missed_blocker_failure_modes": missed_blockers,
        "missed_failure_modes": missed_modes,
        "unexpected_failure_modes_that_should_be_absent": false_present_absent,
        "missed_required_checks": missed_checks,
        "missed_audit_blockers": missed_audit_blockers,
        "score": round(score, 2),
        "case_pass": case_pass,
    }


def dimension_scores(case_results: list[dict[str, Any]], split_name: str) -> dict[str, int]:
    def ratio(predicate: Any) -> int:
        selected = [item for item in case_results if predicate(item)]
        if not selected:
            return 100
        passes = sum(1 for item in selected if item["case_pass"])
        return round((passes / len(selected)) * 100)

    return {
        "structure_boundary_fidelity": ratio(
            lambda item: "tail" in item["case_id"] or "adversarial" in item["case_id"]
        ),
        "artifact_authority_cleanliness": ratio(
            lambda item: "summary" in item["case_id"] or "links" in item["case_id"] or "pollution" in item["case_id"]
        ),
        "source_attribution_fidelity": ratio(lambda item: "tail" in item["case_id"]),
        "delivery_state_consistency": ratio(lambda item: "complete" in item["case_id"] or "claim" in item["case_id"]),
        "adversarial_resilience": 100 if split_name != "adversarial" else ratio(lambda item: True),
    }


def evaluate_split(
    *,
    split: str,
    skill_path: Path,
    session_dir: Path,
    output_dir: Path,
) -> dict[str, Any]:
    cases = load_cases(split)
    output_dir.mkdir(parents=True, exist_ok=True)
    case_results: list[dict[str, Any]] = []
    total_cost = 0.0
    total_duration = 0

    for case in cases:
        case_dir = output_dir / case["id"]
        case_dir.mkdir(parents=True, exist_ok=True)
        evidence = build_evidence(case)
        write_json(case_dir / "evidence.json", evidence)
        try:
            judge = run_claude_judge(
                skill_path=skill_path,
                case=case,
                evidence=evidence,
                session_dir=session_dir,
            )
            write_json(case_dir / "claude-result.json", judge.raw)
            score = score_case(case, judge.structured_output)
            score["structured_output"] = judge.structured_output
            score["cost_usd"] = round(judge.cost_usd, 6)
            score["duration_ms"] = judge.duration_ms
            write_json(case_dir / "score.json", score)
            total_cost += judge.cost_usd
            total_duration += judge.duration_ms
        except Exception as exc:
            expected = case.get("expected", {})
            score = {
                "case_id": case["id"],
                "expected_verdict": expected.get("verdict"),
                "predicted_verdict": "error",
                "verdict_correct": False,
                "missed_blocker_failure_modes": list(expected.get("blocker_failure_modes_present", [])),
                "missed_failure_modes": list(expected.get("failure_modes_present", [])),
                "unexpected_failure_modes_that_should_be_absent": [],
                "missed_required_checks": list(expected.get("required_checks", [])),
                "missed_audit_blockers": list(expected.get("known_audit_blockers", [])),
                "score": 0.0,
                "case_pass": False,
                "structured_output": {},
                "cost_usd": 0.0,
                "duration_ms": 0,
                "error": str(exc),
            }
            write_json(case_dir / "judge-error.json", {"error": str(exc)})
            write_json(case_dir / "score.json", score)
        case_results.append(score)

    pass_rate = sum(1 for item in case_results if item["case_pass"]) / len(case_results)
    blocker_misses = sum(1 for item in case_results if item["missed_blocker_failure_modes"])
    summary = {
        "generated_at": now_iso(),
        "split": split,
        "skill_path": str(skill_path),
        "case_count": len(case_results),
        "pass_rate": pass_rate,
        "blocker_miss_count": blocker_misses,
        "total_cost_usd": round(total_cost, 6),
        "total_duration_ms": total_duration,
        "dimension_scores": dimension_scores(case_results, split),
        "cases": case_results,
    }
    write_json(output_dir / "summary.json", summary)
    return summary
