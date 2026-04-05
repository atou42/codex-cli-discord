#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
RUN_ROOT = SCRIPT_DIR.parent
CHILD = SCRIPT_DIR / "run_import_world_autoresearch.py"
STATUS_PATH = RUN_ROOT / "runtime" / "supervisor.status.json"
LOG_PATH = RUN_ROOT / "logs" / "supervisor.log"
LEDGER_PATH = RUN_ROOT / "experiment-ledger.tsv"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ledger_row_count(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("r", encoding="utf-8", newline="") as handle:
        return len(list(csv.DictReader(handle, delimiter="\t")))


def latest_ledger_row(path: Path) -> dict[str, str] | None:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))
    if not rows:
        return None
    return rows[-1]


def row_is_infra_failure(row: dict[str, str] | None) -> bool:
    if not row:
        return False
    notes = row.get("notes", "")
    changed_files = row.get("changed_files", "")
    infra_markers = (
        "Mutation run failed",
        "claude judge failed",
        "Command timed out after",
    )
    return (not changed_files or changed_files == "[]") and any(marker in notes for marker in infra_markers)


def latest_experiment_id() -> str | None:
    iterations_dir = RUN_ROOT / "iterations"
    highest = 0
    latest = None
    for item in iterations_dir.iterdir():
        if item.is_dir() and item.name.startswith("exp-") and item.name[4:].isdigit():
            value = int(item.name[4:])
            if value >= highest:
                highest = value
                latest = item.name
    return latest


def write_status(payload: dict) -> None:
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stream_child(command: list[str], log_path: Path) -> int:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as log_handle:
        log_handle.write(f"[{now_iso()}] launch: {' '.join(command)}\n")
        log_handle.flush()
        process = subprocess.Popen(
            command,
            cwd=str(RUN_ROOT.parent.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            print(line, end="", flush=True)
            log_handle.write(line)
            log_handle.flush()
        return process.wait()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Supervise the import-world-from-book autoresearch loop.")
    parser.add_argument("--max-hours", type=float, default=8.2)
    parser.add_argument("--max-iterations", type=int, default=30)
    parser.add_argument("--max-consecutive-discards", type=int, default=20)
    parser.add_argument("--mutator-max-budget-usd", type=float, default=1.0)
    parser.add_argument("--max-crashes", type=int, default=5)
    parser.add_argument("--sleep-seconds", type=float, default=5.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    start_time = time.time()
    launches = 0
    crash_streak = 0

    write_status(
        {
            "state": "running",
            "started_at": now_iso(),
            "max_hours": args.max_hours,
            "max_iterations": args.max_iterations,
            "max_crashes": args.max_crashes,
            "latest_experiment": latest_experiment_id(),
            "ledger_rows": ledger_row_count(LEDGER_PATH),
        }
    )

    while launches < args.max_iterations and ((time.time() - start_time) / 3600.0) < args.max_hours:
        before_rows = ledger_row_count(LEDGER_PATH)
        remaining_hours = max(0.01, args.max_hours - ((time.time() - start_time) / 3600.0))

        recovery_cmd = ["python3", str(CHILD), "--recover-only"]
        recovery_code = stream_child(recovery_cmd, LOG_PATH)
        if recovery_code != 0:
            crash_streak += 1
            write_status(
                {
                    "state": "error",
                    "updated_at": now_iso(),
                    "message": "recover-only failed",
                    "exit_code": recovery_code,
                    "crash_streak": crash_streak,
                    "latest_experiment": latest_experiment_id(),
                    "ledger_rows": ledger_row_count(LEDGER_PATH),
                }
            )
            if crash_streak >= args.max_crashes:
                return 2
            time.sleep(args.sleep_seconds)
            continue

        command = [
            "python3",
            "-u",
            str(CHILD),
            "--max-iterations",
            "1",
            "--max-hours",
            str(remaining_hours),
            "--max-consecutive-discards",
            str(args.max_consecutive_discards),
            "--mutator-max-budget-usd",
            str(args.mutator_max_budget_usd),
        ]
        exit_code = stream_child(command, LOG_PATH)
        after_rows = ledger_row_count(LEDGER_PATH)
        launches += 1
        latest_row = latest_ledger_row(LEDGER_PATH)
        infra_failure = row_is_infra_failure(latest_row) if after_rows > before_rows else False

        if after_rows > before_rows and exit_code == 0 and not infra_failure:
            crash_streak = 0
        else:
            crash_streak += 1

        write_status(
            {
                "state": "running",
                "updated_at": now_iso(),
                "launches": launches,
                "exit_code": exit_code,
                "crash_streak": crash_streak,
                "latest_experiment": latest_experiment_id(),
                "ledger_rows_before": before_rows,
                "ledger_rows_after": after_rows,
                "latest_ledger_experiment": (latest_row or {}).get("experiment_id", ""),
                "latest_ledger_status": (latest_row or {}).get("status", ""),
                "latest_ledger_notes": (latest_row or {}).get("notes", ""),
                "infra_failure_detected": infra_failure,
                "remaining_hours": remaining_hours,
            }
        )

        if crash_streak >= args.max_crashes:
            write_status(
                {
                    "state": "failed",
                    "updated_at": now_iso(),
                    "reason": "too many crash-or-stall cycles",
                    "launches": launches,
                    "crash_streak": crash_streak,
                    "latest_experiment": latest_experiment_id(),
                    "ledger_rows": after_rows,
                }
            )
            return 2

        time.sleep(args.sleep_seconds)

    write_status(
        {
            "state": "completed",
            "completed_at": now_iso(),
            "launches": launches,
            "latest_experiment": latest_experiment_id(),
            "ledger_rows": ledger_row_count(LEDGER_PATH),
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
