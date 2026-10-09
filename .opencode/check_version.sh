#!/usr/bin/env bash
# Checks the version that the local OpenCode build reports.
#
# It does not set OPENCODE_VERSION: that is exactly the fallback path being checked,
# the one that takes the version from a git tag (see releaseTagVersion in
# packages/script/src/index.ts). The script must print version=2.0.22 channel=local —
# a number ≥ 1.18.0, otherwise the opencode.ai provider refuses the free models.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out=$(cd "$ROOT" && OPENCODE_CHANNEL=local bun -e 'const m = await import("./packages/script/src/index.ts"); console.log("version=" + m.Script.version, "channel=" + m.Script.channel)' | tail -1)
echo "$out"
printf '%s' "$out" | grep -qE "version=[0-9]+\.[0-9]+\.[0-9]+"
version=$(printf '%s' "$out" | sed -n 's/^version=//p')
major=$(printf '%s' "$version" | cut -d. -f1)
minor=$(printf '%s' "$version" | cut -d. -f2)
[ "$major" -gt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -ge 18 ]; }
