#!/usr/bin/env bash
# Oracle O-FREE: a live check of all 10 free opencode models on the current binary.
#
# Every run goes through --standalone: its own server from the same binary, whose
# User-Agent header carries the version being checked. The background service may have
# been started before the binary was replaced and holds the old code in memory.
#
# Exit code 0 — all 10 answered; 1 — some models errored (they are marked in the output).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

BIN="${BIN:-$(command -v opencode)}"
MODELS=(
  space-bunny-free
  fledge-alpha-free
  exo-free
  muse-spark-1.3-contributor-free
  ling-3.1-flash-free
  mimo-v2.6-flash-free
  nemotron-3-ultra-free
  nemotron-3.5-lightning-free
  longcat-2.5-preview-free
  ling-3.0-flash-fin-free
)

echo "binary: $BIN"
echo "version: $("$BIN" --version 2>&1 | tail -1)"
echo

ok=0
bad=0
for model in "${MODELS[@]}"; do
  out=$(cd /tmp/opencode && timeout 240 "$BIN" run --standalone -m "opencode/$model" "say one word: ok" < /dev/null 2>&1 | tr -d '\033' | sed 's/\[[0-9;]*m//g')
  last=$(printf '%s' "$out" | grep -v '^$' | tail -1)
  if printf '%s' "$out" | grep -q "1.18.0 or newer"; then
    verdict="VERSION BLOCK"
    bad=$((bad + 1))
  elif printf '%s' "$out" | grep -qi "^Error:"; then
    verdict="ERROR"
    bad=$((bad + 1))
  else
    verdict="ANSWER"
    ok=$((ok + 1))
  fi
  printf '%-34s %-16s %s\n' "$model" "$verdict" "${last:0:70}"
done

echo
echo "TOTAL: answered $ok of ${#MODELS[@]}, with an error $bad"
[ "$bad" -eq 0 ]
