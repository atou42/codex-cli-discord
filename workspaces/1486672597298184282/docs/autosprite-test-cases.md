# AutoSprite Frontend Test Cases

## Character Library

### TC-CL-001

Open the app with existing stored characters.

Expected:

- one deterministic character is selected by default
- hero title, hero art, and sidebar selected state agree on the same character
- current-result card matches that character rather than stale prior state

### TC-CL-002

Click a character with completed spritesheets.

Expected:

- hero title updates to the clicked character
- current-result card updates to that character's current export or latest render
- Animate, Preview, and Exports actions point to the clicked character's artifacts

### TC-CL-003

Click a character with no completed spritesheets.

Expected:

- hero title updates to the clicked character
- current-result card shows no-result state
- Preview action is disabled or clearly unavailable
- Exports action is disabled or clearly unavailable
- the next primary action is Animate

### TC-CL-004

Interrupt character loading or force the detail request to fail.

Expected:

- the UI surfaces a visible load failure
- the user is told which character failed to load
- the old character is not silently presented as if nothing happened

### TC-CL-005

Compare card status labels against backend data for three characters:

- one with completed spritesheets
- one with failed jobs and no completed spritesheet
- one with no jobs and no completed spritesheet

Expected:

- labels and badges reflect real state
- no card shows `ready` unless the character is actually usable for preview/export

## Animate

### TC-AN-001

Open Animate for a character with zero completed spritesheets.

Expected:

- primary action is generation
- consequence panel says no current sheet exists
- no control implies that a preview already exists

### TC-AN-002

Open Animate for a character whose only job has failed.

Expected:

- failure reason is visible without hunting in a secondary panel
- consequence panel does not say waiting for first render if the render already failed

### TC-AN-003

Open Animate for a character with one or more completed spritesheets.

Expected:

- consequence panel shows the current result for the selected motion
- opening Preview from Animate lands on the matching result

## Preview

### TC-PR-001

Attempt to open Preview for a character with no completed spritesheets and no jobs.

Expected:

- Preview remains inaccessible
- next step points to Animate

### TC-PR-002

Attempt to open Preview for a character with failed jobs and no completed spritesheets.

Expected:

- Preview remains inaccessible, or shows a dedicated failed-build state
- the failure reason is visible
- the user is led to retry generation, not to inspect a non-existent result

### TC-PR-003

Open Preview for a character with completed spritesheets.

Expected:

- a result is loaded automatically
- frame controls operate on real data
- export approval and download controls are enabled only when meaningful

## Spritesheets

### TC-EX-001

Open Spritesheets for a character with completed results.

Expected:

- all listed artifacts belong to the selected character
- current export version is clearly marked
- Preview and file download actions work from the same artifact row

### TC-EX-002

Attempt to open Spritesheets for a character with no completed results.

Expected:

- stage is disabled or blocked
- user sees why exports are unavailable

## Design And Responsive

### TC-DS-001

Desktop first screen with a completed character selected.

Expected:

- scan path is obvious
- selected character, current result, and next action are visible without hunting
- duplicate navigation does not compete equally for attention

### TC-DS-002

Desktop first screen with a failed or zero-output character selected.

Expected:

- failure or no-result state is the dominant message
- dead controls do not overwhelm the screen

### TC-DS-003

Mobile first screen for completed and zero-output characters.

Expected:

- user can still find the active character, current state, and next step in the first meaningful screen
- critical navigation is not hidden without replacement
