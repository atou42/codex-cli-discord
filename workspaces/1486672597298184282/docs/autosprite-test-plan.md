# AutoSprite Frontend Test Plan

## Rule

This workspace does not accept self-certified frontend testing.

Formal verification must be delegated to subagents.
The main agent may coordinate, collect evidence, and consolidate defects, but should not sign off on the product based on its own browser pass.

## Test Objectives

The test plan exists to answer four questions:

- can a user reliably open and continue work on an existing character
- do stage permissions reflect real product state
- are failed and empty states explicit instead of disguised
- does the layout stay understandable on desktop and mobile

## Test Execution Model

### Delegated Node 1

Character library and character switching.

Scope:

- default landing state
- click character with completed outputs
- click character with zero outputs
- click character after backend interruption or load error
- character-card status truthfulness

Evidence required:

- Playwright snapshots
- console log if any request fails
- network trace if selection appears stale

### Delegated Node 2

Animate, Preview, and Spritesheets truthfulness.

Scope:

- zero-output character
- failed-job character
- completed-result character
- stage lock and unlock rules
- current-result and consequence-panel messaging

Evidence required:

- stage snapshots
- job-state evidence
- API proof when UI and data disagree

### Delegated Node 3

Design and usability review.

Scope:

- desktop first screen scan path
- mobile first screen scan path
- duplicated navigation or conflicting calls to action
- noise level of failed and empty states
- whether primary action is obvious

Evidence required:

- desktop screenshot
- mobile screenshot
- direct references to UI sections or CSS rules

## Failure Policy

A case is failed when any of the following happens:

- the visible state does not match backend reality
- the user is sent into a stage that cannot do useful work
- the user is not told why a blocked action is blocked
- a failed job is described as pending or still waiting
- a character appears ready when it is not actually usable
- mobile hides or buries the only useful next action

## Required Artifacts Per Test Run

Each delegated tester must return:

- repro steps
- actual result
- expected result
- severity
- one evidence link or file path
- one source code reference when a root cause is identifiable

## Exit Criteria For Future Fixes

The next frontend fix pass is not done until delegated tests confirm:

- existing character loading is deterministic
- no-output and failed-output characters are visibly distinct
- Preview is inaccessible without a completed render
- Animate and Preview do not describe failed jobs as merely pending
- desktop and mobile both show a clear next action in the first screen
