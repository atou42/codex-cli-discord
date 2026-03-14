#!/usr/bin/env bash
set -euo pipefail

# Compatibility wrapper for environments still calling the shell entrypoint.
exec node scripts/agents-in-discord-auto-upgrade.mjs "$@"
