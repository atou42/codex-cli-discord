# AutoSprite Current Version Plan

## This Commit Freezes

This commit freezes the current staged frontend rather than claiming ship readiness.

The goal of the freeze is:

- keep the staged shell and current front-end refactor in version control
- document exactly what changed
- document what still blocks usability
- define the next correction plan before more feature work

Only the AutoSprite workspace files should be included in this freeze.
Unrelated dirty files at the repository root stay out of scope.

## Current Frontend Changes

### Character Loading Path

- existing characters now open into a character-first workspace instead of silently jumping straight into Animate
- the selected character is shown in the hero area with a larger source-art frame
- the workspace header now exposes direct actions for Base art, Animate, Current result, and Exports

Files:

- `public/app.js`
- `public/index.html`
- `public/styles.css`

### Current Result Surface

- the hero area now includes a current-result card
- when a result exists, the card exposes Preview, Exports, and package download
- when no result exists, the card points the user back to Animate

Files:

- `public/app.js`
- `public/index.html`
- `public/styles.css`

### Character Library Feedback

- selected character cards now have stronger selected-state styling
- cards show source/date metadata and a simple open or loaded state label

Files:

- `public/app.js`
- `public/styles.css`

## Known Product Debt In This Frozen Version

These are not hidden defects. They are expected follow-up work after the freeze.

- character-card status still overstates readiness because it does not reflect failed or no-output states
- Preview can still be reached for a character that only has failed jobs and no completed result
- failure messaging is still fragmented across Animate, Preview, and hero summary surfaces
- empty and failed states still use too much of the full Preview chrome
- desktop and mobile information hierarchy still need a dedicated cleanup pass

## Next Fix Plan

### Phase 1

Expose real status instead of optimistic status.

- derive character-card state from completed sheets, failed jobs, and running jobs
- stop showing `ready` for characters that only have failed or zero-result history
- add a visible load-error state when character switching fails

### Phase 2

Make stage gating reflect truth.

- Preview should require at least one completed spritesheet, not merely any job history
- failed-job characters should route toward Animate retry, not toward Preview inspection
- stage copy and next-step labels must stop contradicting actual accessibility

### Phase 3

Simplify failed and empty states.

- collapse dead controls on Preview when no result exists
- surface failed-job reason in the hero/current-result area
- make the primary retry path obvious from Character, Animate, and Preview

### Phase 4

Run subagent-led browser verification before any further polish.

- no main-agent self sign-off
- each critical path must be exercised by a delegated tester with evidence
- defects found in delegated runs should be added to the issue log before close
