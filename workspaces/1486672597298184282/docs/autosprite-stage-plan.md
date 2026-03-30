# AutoSprite Stage Implementation Plan

## Goal

Rebuild the current single-page workbench into a staged workflow that follows the free path only.

The minimum closed loop stays the same:

- connect Neta token when needed
- upload one character
- select standard or custom motions
- generate spritesheets with queue visibility
- preview the first completed result
- download PNG spritesheet and JSON atlas

The difference is interaction shape, not backend scope.

## Product Frame

The shell stays stable while the center task changes.

- left rail keeps project memory
- center panel keeps one dominant task
- right rail keeps consequence and next step

This is the behavior to copy from the reference product, even though the local MVP keeps a smaller feature surface.

## Stages

### Character

Purpose:

- start from one clean upload flow
- show input guidance before animation choices appear
- keep existing character library reachable without mixing it into the form itself

Main action:

- create character

Support:

- token panel stays in sidebar
- active character summary appears as context

### Animate

Purpose:

- choose motions without being distracted by export cards and preview data
- make custom motion controls optional instead of always-on

Main action:

- generate spritesheets

Support:

- standard actions shown as large selection tiles
- pose creation and custom animation authoring hidden behind a motion lab disclosure
- selected action count shown next to generate action

### Preview

Purpose:

- inspect completed renders in a dedicated review step
- keep the queue visible while waiting for the first completed render

Main action:

- approve result and move to exports

Support:

- spritesheet chooser for switching results
- live animation player
- direct download for the current result

### Spritesheets

Purpose:

- make exports feel like final artifacts, not mixed build output

Main action:

- download PNG spritesheet and atlas

Support:

- preview shortcut
- artifact metadata

## Persistent Shell

### Left rail

- new character entry
- token connection
- character library

### Top banner

- active workflow title
- stage tabs
- workspace counts

### Right rail

- active character art
- input analysis
- queue snapshot
- stage-aware next step card

## Auto Advance Rules

- creating or selecting a character moves to Animate
- submitting generation moves to Preview
- preview remains available while jobs are running
- exports unlock as soon as at least one spritesheet exists

## Definition Of Done

- no permanent create form in the sidebar
- no long scrolling mixed workbench in the center
- every stage has one obvious primary action
- stage locking follows real prerequisites
- custom action controls still support first frame and first plus last frame modes
- preview canvas still plays generated output
- export stage still exposes PNG and atlas downloads

## Validation

- `node --check public/app.js`
- `npm test`
- desktop browser smoke check
- mobile browser smoke check

## Current Status Snapshot

- staged shell is in place across Character, Animate, Preview, and Spritesheets
- Animate now includes a consequence panel that shows queue impact and any current result for the selected motion
- Preview now has runtime inspection, version compare, redo, and explicit export approval
- exports still ship PNG, atlas, and full character pack downloads
- remaining non-free-path gaps stay out of scope for this plan
