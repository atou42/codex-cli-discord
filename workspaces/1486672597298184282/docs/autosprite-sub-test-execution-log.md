# AutoSprite Subagent Test Execution Log

## Purpose

This file records delegated-test execution status.
It exists so the repository does not pretend that delegated verification has completed when it has not.

## Current Run

Date:

- 2026-03-30

Requested rule:

- do not self-certify frontend quality
- use subagents to verify each critical node

Delegated nodes attempted:

- character library and character switching
- Animate, Preview, and Spritesheets truthfulness
- desktop and mobile design review

## Result

The current delegated run now has usable evidence for every originally blocked frontend truthfulness issue.

Additional delegated Preview interaction evidence on 2026-03-31:

- subagent `Fermat` confirmed the local app was reachable at `http://127.0.0.1:3123/`, opened Runtime QA Preview, and verified scene switching to `Amber Dunes`
- the first browser pass could not prove jump or movement because it used generic key presses and snapshots, which left the Preview readout looking unchanged
- subagent `Galileo` then used direct DOM reads through Playwright `eval` and confirmed:
  - `#preview-range-start = 10` plus `#preview-range-end = 5` resolves to loop readout `Frames 6 to 6`
  - direct `press Space` was still insufficient to prove jump from the readout alone
- follow-up browser inspection on the same page state confirmed the live Preview shell was focused at `preview-scene-shell`
- held-key verification then showed the Preview captions are actually live when driven correctly:
  - `keydown Space` changed `#preview-position-readout` from `13% across · grounded` to `13% across · airborne`
  - `keyup Space` returned the readout to `13% across · grounded`
  - `keydown ArrowRight` changed the readout to `67% across · grounded`
- one later browser pass still showed an unresolved first-input ambiguity:
  - after opening Preview, `activeElement.id` could already be `preview-scene-shell` while an immediate `keydown Space` plus a short wait still left the readout at `13% across · grounded`
  - the same Preview shell continued to respond on the held-input path that had already produced `airborne`

Observed subagent errors:

- `429 Too Many Requests`
- repeated retry exhaustion

Latest explicit rerun evidence on 2026-03-30:

- subagent `Averroes` for Preview truthfulness failed with `exceeded retry limit, last status: 429 Too Many Requests`
- previously queued delegated work on the existing subagent did not return usable findings before timeout

Additional retry outcomes on 2026-03-30:

- subagent `Franklin` returned a usable finding for Preview truthfulness without browser automation:
  - `char_g5s003dlhl` and `char_lk5i0qh1nq` both have zero completed spritesheets
  - `char_lk5i0qh1nq` has failed job `job_j7tnyeonym`
  - `public/app.js` still unlocks Preview when jobs exist, which is a product-state mismatch
- subagent `Beauvoir` returned a usable finding for character-card truthfulness:
  - character cards still hard-code a `ready` badge path even for failed or zero-output characters
  - evidence points to `public/app.js` around the character-card render block and the failed job file `runtime/data/jobs/job_j7tnyeonym.json`
- subagent `Harvey` returned a browser-test blocker with evidence files:
  - Chromium startup crashed with `SIGTRAP`
  - a later Firefox/browser pass could not complete the intended zero-output flow because the home screen did not surface a zero-output character entry point for the automation path
  - evidence files were produced under `output/`
- subagent `Euclid` returned another browser-test blocker:
  - `playwright_cli.sh` hung when opening the local app
  - blocker evidence was recorded at `output/evidence/playwright-cli-hang.txt`

Successful delegated reruns on 2026-03-30 after the fix pass:

- subagent `Banach` verified the repaired API and shared state logic:
  - `/api/characters` now returns `workspaceSummary` that separates failed and ready characters
  - failed-job plus zero-spritesheet cases no longer satisfy Preview accessibility logic
- subagent `Hume` verified the repaired browser surfaces:
  - failed-job character `LocalRunner-1774606743624` now shows `failed`, shows `Last render failed`, and does not expose a live Preview entry
  - zero-output character `SmokePrompt2` now shows `base only`, keeps Preview disabled, and shows a clean `No motion rendered yet` empty state instead of a full dead Preview shell
  - a synthetic missing-character click now surfaces `Could not load that character. Character not found.` instead of failing silently
  - a mobile viewport check confirmed the first screen still has clear navigation after the top duplicated stage links were removed
  - browser evidence was produced under `.playwright-cli/`
- subagent `Huygens` verified the last real-card failure path in the isolated probe app:
  - card `Failure Probe Temp 2` was visible in the character library before deletion
  - after deleting `/tmp/autosprite-failure-probe/runtime/data/characters/char_mxhkiop1lt.json` without refreshing, clicking the still-visible card surfaced a visible error and flipped that card to `Retry`
  - evidence was recorded at `output/evidence/character-delete-retry-probe-char_mxhkiop1lt.json`
  - screenshots were recorded at `output/evidence/character-delete-retry-probe-char_mxhkiop1lt-before.png` and `output/evidence/character-delete-retry-probe-char_mxhkiop1lt-after.png`

## What This Means

- the current version is committed as a freeze, not as a verified release
- the test plan and cases are ready
- the issue list is documented
- delegated execution evidence now exists for the repaired Preview gating and character-card truthfulness paths
- delegated evidence now also exists for the retry-state path on a real library card after a forced character-load failure
- delegated evidence now exists for live Preview interaction, but only when the test method uses held-key input instead of a tap-style key press
- the first-keyboard-event path immediately after opening Preview is still not fully pinned down by browser automation evidence

## Required Next Step

Move on from the original frontend truthfulness blocker list.
