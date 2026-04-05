#!/usr/bin/env python3
from __future__ import annotations

import json
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
JUDGE_MODEL = "gpt-5.4"
JUDGE_REASONING_EFFORT = "xhigh"
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
PLACEHOLDER_LINE_RE = re.compile(r"(placeholder|待补充|todo|tbd)", re.IGNORECASE)


@dataclass
class JudgeRunResult:
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
    cwd: Path | None = None,
    timeout_sec: int | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            text=True,
            capture_output=True,
            env=env,
            cwd=str(cwd) if cwd else None,
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


def read_excerpt(path: Path, start_line: int, end_line: int) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    start = max(1, start_line)
    end = min(len(lines), end_line)
    return [
        {"line": line_number, "text": lines[line_number - 1]}
        for line_number in range(start, end + 1)
    ]


def find_lines(path: Path, pattern: re.Pattern[str], limit: int = 8) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    results: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
        if pattern.search(line):
            results.append({"line": line_number, "text": line})
            if len(results) >= limit:
                break
    return results


def collect_core_file_evidence(world_root: Path) -> dict[str, Any]:
    files = {
        "WORLD.md": world_root / "WORLD.md",
        "BOOK.md": world_root / "BOOK.md",
        "processing_summary.md": world_root / "processing_summary.md",
    }
    evidence: dict[str, Any] = {}
    for name, path in files.items():
        evidence[name] = {
            "exists": path.exists(),
            "status_lines": find_lines(path, STATUS_LINE_RE),
            "placeholder_lines": find_lines(path, PLACEHOLDER_LINE_RE),
            "opening_excerpt": read_excerpt(path, 1, 28),
        }
    return evidence


def collect_tail_excerpt_evidence(raw_text_dir: Path) -> list[dict[str, Any]]:
    plans = [
        {
            "file": "chapter_0031.md",
            "label": "chapter_29_tail_choice",
            "ranges": [(1, 12), (33, 50), (89, 99)],
        },
        {
            "file": "chapter_0032.md",
            "label": "epilogue",
            "ranges": [(1, 10), (17, 28), (53, 61), (89, 105)],
        },
        {
            "file": "chapter_0033.md",
            "label": "notes",
            "ranges": [(1, 8)],
        },
    ]
    results: list[dict[str, Any]] = []
    for plan in plans:
        path = raw_text_dir / plan["file"]
        excerpts: list[dict[str, Any]] = []
        for start_line, end_line in plan["ranges"]:
            excerpts.extend(read_excerpt(path, start_line, end_line))
        results.append(
            {
                "file": plan["file"],
                "label": plan["label"],
                "exists": path.exists(),
                "excerpts": excerpts,
            }
        )
    return results


def has_completion_line(lines: list[dict[str, Any]]) -> bool:
    for item in lines:
        text = str(item.get("text", ""))
        if "完成" in text or "complete" in text.lower():
            return True
    return False


def compute_required_check_hints(
    *,
    preflight: dict[str, Any],
    final: dict[str, Any],
    volume_files: list[str],
    tail_files: list[dict[str, Any]],
    core_file_evidence: dict[str, Any],
    anchor_matches: list[dict[str, Any]],
) -> dict[str, bool]:
    has_batch = any(BATCH_SUMMARY_RE.match(name) for name in volume_files)
    has_legacy = any(LEGACY_SUMMARY_RE.match(name) for name in volume_files)
    world_complete = has_completion_line(list(core_file_evidence.get("WORLD.md", {}).get("status_lines", [])))
    processing_complete = has_completion_line(
        list(core_file_evidence.get("processing_summary.md", {}).get("status_lines", []))
    )
    has_ch0032_anchor = any("chapter_0032.md" in str(item.get("text", "")) for item in anchor_matches)
    has_ch0031_anchor = any("chapter_0031.md" in str(item.get("text", "")) for item in anchor_matches)
    headings = {item["file"]: str(item.get("heading") or "") for item in tail_files}
    final_ready = bool(final.get("ready_for_delivery"))
    final_not_ready = not final_ready
    no_final_artifact_issues = not final.get("blockers") and not final.get("broken_links") and not final.get("placeholder_hits")
    no_missing_batch = not preflight.get("missing_volume_summaries")
    book_placeholders = bool(core_file_evidence.get("BOOK.md", {}).get("placeholder_lines"))
    canonical_count = int(final.get("canonical_chapter_count", 0))

    return {
        "BOOK_md_has_placeholders": book_placeholders,
        "WORLD_and_processing_summary_claim_complete": world_complete and processing_complete,
        "batch_summary_family_missing": not has_batch or not no_missing_batch,
        "broken_internal_links_present": bool(final.get("broken_links")),
        "canonical_chapter_count_33": canonical_count == 33,
        "chapter_0031_is_chapter_29": headings.get("chapter_0031.md") == "第二十九章",
        "chapter_0032_is_epilogue": headings.get("chapter_0032.md") == "尾声",
        "chapter_0033_is_notes": headings.get("chapter_0033.md") == "注释",
        "completion_claims_match_audit_truth": world_complete and processing_complete and final_ready and no_final_artifact_issues,
        "epilogue_anchor_facts_point_to_chapter_0031_instead_of_0032": has_ch0031_anchor and not has_ch0032_anchor,
        "epilogue_facts_point_to_chapter_0032": has_ch0032_anchor,
        "final_audit_not_ready_for_delivery": final_not_ready,
        "final_audit_ready_for_delivery": final_ready,
        "only_batch_volume_summaries_present": has_batch and not has_legacy,
        "raw_text_ends_at_chapter_0031": canonical_count == 31,
        "story_volumes_has_batch_summaries": has_batch,
        "story_volumes_has_only_legacy_single_chapter_summaries": has_legacy and not has_batch,
        "story_volumes_still_has_legacy_single_chapter_summaries": has_legacy,
        "world_audit_final_ready_for_delivery": final_ready,
    }


def compute_failure_mode_hints(
    *,
    input_kind: str,
    preflight: dict[str, Any],
    final: dict[str, Any],
    required_check_hints: dict[str, bool],
) -> dict[str, bool]:
    world_complete = bool(required_check_hints.get("WORLD_and_processing_summary_claim_complete"))
    final_ready = bool(required_check_hints.get("final_audit_ready_for_delivery"))
    broken_or_placeholder = bool(final.get("broken_links")) or bool(final.get("placeholder_hits"))

    return {
        "route_false_positive": False,
        "exec_missing_audit_gate": False,
        "exec_unsafe_single_book_shortcut": input_kind == "book_file",
        "raw_text_tail_split_wrong": bool(required_check_hints.get("raw_text_ends_at_chapter_0031")) or not bool(required_check_hints.get("canonical_chapter_count_33")),
        "artifact_legacy_summary_pollution": bool(required_check_hints.get("story_volumes_still_has_legacy_single_chapter_summaries"))
        and bool(required_check_hints.get("story_volumes_has_batch_summaries")),
        "artifact_missing_canonical_volume_summaries": bool(required_check_hints.get("batch_summary_family_missing")),
        "artifact_backmatter_source_misattribution": bool(
            required_check_hints.get("epilogue_anchor_facts_point_to_chapter_0031_instead_of_0032")
        ),
        "artifact_broken_links_or_placeholders": broken_or_placeholder,
        "outcome_gold_not_authoritative": False,
        "ops_inconsistent_delivery_state": world_complete and not final_ready,
    }


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
            "core_file_evidence": collect_core_file_evidence(world_root),
            "tail_excerpt_evidence": collect_tail_excerpt_evidence(raw_text_dir),
        }
        evidence["world_root_snapshot"]["required_check_hints"] = compute_required_check_hints(
            preflight=preflight,
            final=final,
            volume_files=volume_files,
            tail_files=tail_files,
            core_file_evidence=evidence["world_root_snapshot"]["core_file_evidence"],
            anchor_matches=evidence["world_root_snapshot"]["anchor_matches"],
        )
        evidence["world_root_snapshot"]["failure_mode_hints"] = compute_failure_mode_hints(
            input_kind=input_kind,
            preflight=preflight,
            final=final,
            required_check_hints=evidence["world_root_snapshot"]["required_check_hints"],
        )
    else:
        evidence["world_root_snapshot"] = {
            "required_check_hints": {
                "final_audit_not_ready_for_delivery": not bool(final.get("ready_for_delivery")),
                "final_audit_ready_for_delivery": bool(final.get("ready_for_delivery")),
            },
            "failure_mode_hints": compute_failure_mode_hints(
                input_kind=input_kind,
                preflight=preflight,
                final=final,
                required_check_hints={
                    "WORLD_and_processing_summary_claim_complete": False,
                    "final_audit_ready_for_delivery": bool(final.get("ready_for_delivery")),
                },
            ),
        }

    return evidence


def build_schema(required_check_ids: list[str], failure_mode_ids: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ALLOWED_VERDICTS},
            "failure_modes_present": {
                "type": "array",
                "items": {"type": "string", "enum": failure_mode_ids},
            },
            "required_checks_true": {
                "type": "array",
                "items": {"type": "string", "enum": required_check_ids},
            },
            "audit_blockers_true": {
                "type": "array",
                "items": {"type": "string"},
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
        "Judge only the failure modes and required checks that are actually evidenced for this case.\n"
        "Do not demand a full end-to-end execution trace unless the case evidence explicitly targets that surface.\n"
        "Do not mark outcome_gold_not_authoritative only because the packet omits unrelated proof that this case does not need.\n"
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
        "Case evaluation contract:\n"
        "- Use only the evidence packet.\n"
        "- Treat the listed required checks as the case-specific bar.\n"
        "- If the packet includes `required_check_hints`, use those exact ids when the surrounding evidence agrees.\n"
        "- If the packet includes `failure_mode_hints`, use those exact ids when the surrounding evidence agrees.\n"
        "- Only report a failure mode when the packet positively supports it.\n"
        "- Use outcome_gold_not_authoritative only for a real trustworthiness gap shown by this packet, not for omitted unrelated proof.\n"
        "- The verdict is about whether this candidate should pass the eval case, not whether the audit machinery itself ran correctly.\n"
        "- If the packet directly supports the listed checks and does not support an allowed failure mode, return pass.\n"
        f"Allowed failure mode ids: {', '.join(failure_mode_ids)}\n"
        f"Allowed required check ids: {', '.join(required_check_ids)}\n\n"
        "Evidence packet JSON:\n"
        f"{json.dumps(evidence, ensure_ascii=False, indent=2)}"
    )


def run_codex_judge(
    *,
    skill_path: Path,
    case: dict[str, Any],
    evidence: dict[str, Any],
    case_dir: Path,
    max_budget_usd: float = 0.35,
) -> JudgeRunResult:
    failure_mode_ids = load_failure_mode_ids()
    required_check_ids = collect_required_check_ids()
    schema = build_schema(required_check_ids, failure_mode_ids)
    skill_text = skill_path.read_text(encoding="utf-8")
    schema_path = case_dir / "judge-schema.json"
    raw_output_path = case_dir / "judge-last-message.json"
    prompt = (
        f"{make_system_prompt(skill_text)}\n\n"
        "Evaluator configuration:\n"
        f"- Use Codex CLI model {JUDGE_MODEL}\n"
        f"- Use reasoning effort {JUDGE_REASONING_EFFORT}\n"
        "- Return only the schema-compliant JSON object.\n\n"
        f"{make_user_prompt(case, evidence, failure_mode_ids, required_check_ids)}"
    )
    write_json(schema_path, schema)
    command = [
        "codex",
        "exec",
        "-m",
        JUDGE_MODEL,
        "-c",
        f'model_reasoning_effort="{JUDGE_REASONING_EFFORT}"',
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "--output-schema",
        str(schema_path),
        "-o",
        str(raw_output_path),
        prompt,
    ]
    result = run_command(command, cwd=ROOT, timeout_sec=CLAUDE_JUDGE_TIMEOUT_SEC)
    if result.returncode != 0:
        raise RuntimeError(f"codex judge failed: {result.stderr}\nstdout={result.stdout}")
    if not raw_output_path.exists():
        raise RuntimeError("codex judge completed without writing schema result")
    structured = json.loads(raw_output_path.read_text(encoding="utf-8"))
    if not isinstance(structured, dict):
        raise RuntimeError(f"codex judge did not return a JSON object: {structured}")
    payload = {
        "runner": "codex exec",
        "model": JUDGE_MODEL,
        "reasoning_effort": JUDGE_REASONING_EFFORT,
        "prompt": prompt,
        "structured_output": structured,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "raw_output_path": str(raw_output_path),
        "schema_path": str(schema_path),
        "budget_hint_usd": max_budget_usd,
    }
    return JudgeRunResult(
        raw=payload,
        structured_output=structured,
        cost_usd=0.0,
        duration_ms=0,
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
            judge = run_codex_judge(
                skill_path=skill_path,
                case=case,
                evidence=evidence,
                case_dir=case_dir,
            )
            write_json(case_dir / "judge-result.json", judge.raw)
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
