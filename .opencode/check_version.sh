#!/usr/bin/env bash
# Проверка версии, которую объявит локальная сборка OpenCode.
#
# Не задаёт OPENCODE_VERSION: так проверяется именно запасной путь, который берёт
# версию из git-тега (см. releaseTagVersion в packages/script/src/index.ts).
# Скрипт обязан напечатать version=2.0.22 channel=local — число ≥ 1.18.0, иначе
# провайдер opencode.ai откажет в бесплатных моделях.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out=$(cd "$ROOT" && OPENCODE_CHANNEL=local bun -e 'const m = await import("./packages/script/src/index.ts"); console.log("version=" + m.Script.version, "channel=" + m.Script.channel)' | tail -1)
echo "$out"
printf '%s' "$out" | grep -qE "version=[0-9]+\.[0-9]+\.[0-9]+"
version=$(printf '%s' "$out" | sed -n 's/^version=//p')
major=$(printf '%s' "$version" | cut -d. -f1)
minor=$(printf '%s' "$version" | cut -d. -f2)
[ "$major" -gt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -ge 18 ]; }
