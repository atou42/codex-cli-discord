# Codex Surface Roadmap

## Scope

This roadmap focuses on the Codex-facing product surface inside `agents in discord`.

It intentionally excludes MCP, plugin marketplace, Codex Cloud, app-server platformization, and other platform/ops surfaces. Those can be planned later as a separate track.

## Current Baseline

The project already covers the core non-interactive execution path for Codex, plus Discord-native queueing, progress cards, session binding, model selection, compact controls, workspace selection, and reply delivery.

Native image input is now in place. Discord image attachments are staged into controlled temp files and passed to Codex through `--image`, with attachment text kept as fallback context.

## Phase 1: Expose Codex Profile

### Goal

Make the active Codex profile visible and configurable from Discord.

### Why

A lot of behavior that currently feels implicit is actually profile-driven. Search behavior, image-view capability, personality, service tier, and plan-mode reasoning are all easier to reason about once the profile becomes a first-class setting instead of an invisible local default.

Without this, users see effects but cannot reliably predict or control them. That creates confusion in `/status`, makes cross-machine behavior drift, and makes debugging much harder than it needs to be.

### Plan

Add a dedicated Codex profile setting that is separate from the bot's existing security profile.

Support the same inheritance model used elsewhere in the project. A thread can override its parent channel. A parent channel can override the global default. `/status` and the settings panel should always show both the effective value and the source.

Plumb the resolved profile into the Codex runner arguments through `--profile`. Keep the current behavior when no explicit profile is set.

Make the status output concrete. It should be obvious whether a task is running on the default profile or on a named profile, and whether that choice comes from the thread, the parent channel, or the global default.

## Phase 2: Add Native Review Mode

### Goal

Turn Codex review into a first-class Discord command instead of treating review as just a prompt style.

### Why

Codex already has a dedicated `review` subcommand. It understands review targets directly, and it is a cleaner fit for findings-first output than pushing review behavior through the generic exec path.

This is high-value and low-risk. It gives users a reliable review lane for working tree changes, branch diffs, and commit diffs without muddying ordinary execution flows.

### Plan

Add a `/review` surface with three target modes. The first reviews uncommitted changes. The second reviews changes against a base branch. The third reviews a specific commit.

Route Codex-backed review requests to `codex review` instead of `codex exec`. Preserve the existing prompt-level review stance as a fallback only for non-Codex providers.

Keep the output strict. Findings first. No code patching. No mixed execution side effects.

Make the status and progress surfaces explicit when a run is a review run, so it is clear that this is analysis-only work.

## Phase 3: Replace Safe and Dangerous with Real Execution Controls

### Goal

Expose Codex's actual sandbox and approval behavior instead of compressing everything into two coarse modes.

### Why

The current `safe` and `dangerous` labels are too blunt. They hide the real execution boundary and make it harder for users to understand what the agent is allowed to do.

This matters more as tasks get longer and more autonomous. The user should not have to infer whether the agent can write files, whether it will ask before risky commands, or whether it is running with no guardrails at all.

### Plan

Split execution control into two explicit settings. One controls sandbox mode. One controls approval policy.

Map them directly onto Codex semantics. The status view should always report the effective values in plain language and show where they came from.

Keep one important boundary clear. In Discord, these settings apply to the next task, not the task that is already running. The bot uses non-interactive task processes, so live mid-run permission switching should not be implied.

After the explicit controls land, keep `safe` and `dangerous` only as compatibility shims or remove them entirely, depending on migration cost.

## Phase 4: Plan-First Workflow (On Hold)

### Goal

Make long or risky tasks go through an explicit planning checkpoint before execution.

### Why

The current flow still encourages users to jump straight into a full run. That works for short tasks, but it is a poor fit for hours-long work, risky edits, or ambiguous requests.

Discord is a better home for plan-first than the terminal. It can show the plan as a durable object in the thread, let the user confirm it asynchronously, and keep the execution record separate from the planning step.

### Plan

This phase is intentionally on hold while fork is being clarified. The product shape for plan-first depends on the fork model, especially around whether execution should branch from the planning context or start from a separate clean path.

Do not implement this phase until the fork contract is stable. Keep the requirement visible, but treat it as blocked by Phase 5 design work.

## Phase 5: Add Fork as a Product-Level Branch

### Goal

Let users branch from a plan or result into a new path without losing the original thread of work.

### Why

Fork is valuable when there are multiple viable approaches, when a plan needs an alternate implementation, or when the user wants to preserve one line of work and try another. This becomes much more meaningful after plan-first exists.

True Codex-native forking is not yet a natural fit for the current non-interactive backend. Waiting for protocol-level parity would delay a useful product capability that can already be delivered at the Discord layer.

### Plan

Start with product-level fork, not protocol-level fork. A fork should create a new child thread or child session path, carry forward the relevant context, and record its parent source clearly.

Support forking from two moments. The first is from an approved plan before execution starts. The second is from a completed or failed result when the user wants to try a different approach.

Keep the branch identity visible. The forked thread should show its parent in status, and the original thread should remain untouched.

Revisit protocol-level fork later only if the current product-level approach proves insufficient.

## Delivery Order

The recommended order is profile first, then review, then execution controls, then fork. Plan-first remains on hold until the fork design is settled.

That order keeps the roadmap grounded in leverage. Profile makes hidden behavior visible. Review is a fast win. Execution controls make autonomy legible. Fork can now be designed as its own product surface instead of being forced to inherit an unfinished plan model.

## Definition of Done

This roadmap is only successful if each phase becomes visible in three places at the same time.

The settings panel must let the user set it. `/status` must report the effective value and the source. The runtime path must actually use the setting instead of merely storing it.

If any phase only updates the UI, only updates status, or only updates the backend, it is not done.
