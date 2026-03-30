# AutoSprite Frontend Known Issues

## Severity P0

### P0-01 Character switch failures are effectively silent

When a character-detail request fails, the click path does not surface a visible load error.
The page can stay on the previous character, which makes the clicked card look broken rather than clearly failed.

Root area:

- `public/app.js` character-card click handling
- `public/app.js` `selectCharacter`

References:

- `public/app.js:2254`
- `public/app.js:3268`

## Severity P1

### P1-01 Character cards overstate readiness

Every card currently renders a success-like `ready` badge even when the character has zero completed spritesheets or only failed jobs.

Reference:

- `public/app.js:1376`

### P1-02 Preview accessibility is too loose

Preview is treated as accessible when a character has any job history, even if no completed spritesheet exists.
This lets the user enter a mostly empty Preview stage for failed builds.

Reference:

- `public/app.js:1001`

### P1-03 Preview copy contradicts actual availability

For zero-output or failed-output characters, Preview can be entered while the hero subtitle still says Preview will unlock automatically later.

References:

- `public/app.js:1074`
- `public/index.html:411`

### P1-04 Failure is disguised as pending

When a motion has no current sheet, Animate consequence copy says waiting for first render even if the only existing job already failed.

Reference:

- `public/app.js:1740`

## Severity P2

### P2-01 Current-result card does not distinguish failed from never-rendered

The hero current-result surface only splits into in-progress or no-result language.
A failed build is therefore collapsed into the same visual bucket as a never-attempted build.

Reference:

- `public/app.js:1316`

### P2-02 Queue exposes the truth, but only deep in the stage

The queue card does render failed status and the backend error, but the information appears too deep in Animate and Preview to serve as the primary state explanation.

Reference:

- `public/app.js:1883`

### P2-03 Navigation is duplicated on the first screen

The hero action deck and the stage tabs both act as primary navigation.
This splits attention and weakens the scan path.

References:

- `public/index.html:115`
- `public/index.html:149`

### P2-04 Preview empty state keeps too much dead chrome visible

When no result exists, Preview still renders the full runtime stage, compare area, atlas area, timeline, and multiple disabled actions.
The real message competes with a large volume of non-usable UI.

Reference:

- `public/index.html:433`

### P2-05 Mobile hides top navigation without a substitute

At widths below 900px the top navigation links are removed.
There is no separate mobile stage navigator in the header, so orientation depends entirely on the in-page stage section.

Reference:

- `public/styles.css:1900`
