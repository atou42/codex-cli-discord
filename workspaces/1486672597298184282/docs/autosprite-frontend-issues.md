# AutoSprite Frontend Known Issues

## Current Status

Resolved in code and rechecked by delegated tests:

- character cards no longer mark failed or zero-output characters as `ready`
- Preview no longer unlocks from job history alone
- Preview empty state now hides the dead runtime chrome and points back to Animate
- character switch failure now surfaces a visible load error and flips the clicked card into `Retry`

Resolved in code and covered by local automated tests:

- Preview copy now matches actual accessibility
- Animate consequence copy distinguishes failed render from never-rendered motion
- current-result card distinguishes failed render from no-result state

Still open:

- none in the original blocking list

## Severity P0

### P0-01 Character switch failures are effectively silent

Status:

- code fix landed
- delegated synthetic repro confirmed visible load error on 2026-03-30
- delegated real-card repro passed on 2026-03-30

When a character-detail request fails, the click path does not surface a visible load error.
The page can stay on the previous character, which makes the clicked card look broken rather than clearly failed.

Root area:

- `public/app.js` character-card click handling
- `public/app.js` `selectCharacter`

Delegated evidence:

- `output/evidence/character-delete-retry-probe-char_mxhkiop1lt.json`
- `output/evidence/character-delete-retry-probe-char_mxhkiop1lt-before.png`
- `output/evidence/character-delete-retry-probe-char_mxhkiop1lt-after.png`

References:

- `public/app.js:2254`
- `public/app.js:3268`

## Severity P1

### P1-01 Character cards overstate readiness

Status:

- fixed
- delegated browser check passed on 2026-03-30

Every card currently renders a success-like `ready` badge even when the character has zero completed spritesheets or only failed jobs.

Delegated evidence:

- subagent validation confirmed `char_lk5i0qh1nq` still has failed job `job_j7tnyeonym.json` and no completed spritesheets, while the card render path still hard-codes a `ready` badge
- subagent validation confirmed `char_g5s003dlhl` has zero completed spritesheets but would still inherit the same optimistic card wording

Reference:

- `public/app.js:1376`

### P1-02 Preview accessibility is too loose

Status:

- fixed
- delegated API and browser checks passed on 2026-03-30

Preview is treated as accessible when a character has any job history, even if no completed spritesheet exists.
This lets the user enter a mostly empty Preview stage for failed builds.

Delegated evidence:

- subagent validation confirmed `char_lk5i0qh1nq` has zero completed spritesheets and one failed job, yet the current `stageIsAccessible` logic still treats job presence as enough to unlock Preview
- subagent validation confirmed `char_g5s003dlhl` has zero completed spritesheets, establishing the zero-output comparison case

Reference:

- `public/app.js:1001`

### P1-03 Preview copy contradicts actual availability

Status:

- fixed in shared workspace-state logic
- covered by `tests/workspace-state.test.js`

For zero-output or failed-output characters, Preview can be entered while the hero subtitle still says Preview will unlock automatically later.

References:

- `public/app.js:1074`
- `public/index.html:411`

### P1-04 Failure is disguised as pending

Status:

- fixed in shared workspace-state logic
- covered by `tests/workspace-state.test.js`

When a motion has no current sheet, Animate consequence copy says waiting for first render even if the only existing job already failed.

Reference:

- `public/app.js:1740`

## Severity P2

### P2-01 Current-result card does not distinguish failed from never-rendered

Status:

- fixed in shared workspace-state logic
- covered by `tests/workspace-state.test.js`

The hero current-result surface only splits into in-progress or no-result language.
A failed build is therefore collapsed into the same visual bucket as a never-attempted build.

Reference:

- `public/app.js:1316`

### P2-02 Queue exposes the truth, but only deep in the stage

Status:

- partially addressed
- failure now also surfaces in current-result and Preview empty state
- queue remains in place as secondary detail

The queue card does render failed status and the backend error, but the information appears too deep in Animate and Preview to serve as the primary state explanation.

Reference:

- `public/app.js:1883`

### P2-03 Navigation is duplicated on the first screen

Status:

- fixed
- top navbar stage links were removed so stage tabs are now the single primary navigator

The hero action deck and the stage tabs both act as primary navigation.
This splits attention and weakens the scan path.

References:

- `public/index.html:115`
- `public/index.html:149`

### P2-04 Preview empty state keeps too much dead chrome visible

Status:

- fixed
- delegated browser check passed on 2026-03-30

When no result exists, Preview still renders the full runtime stage, compare area, atlas area, timeline, and multiple disabled actions.
The real message competes with a large volume of non-usable UI.

Reference:

- `public/index.html:433`

### P2-05 Mobile hides top navigation without a substitute

Status:

- fixed
- delegated mobile browser check passed on 2026-03-30

At widths below 900px the top navigation links are removed.
There is no separate mobile stage navigator in the header, so orientation depends entirely on the in-page stage section.

Reference:

- `public/styles.css:1900`
