#!/usr/bin/env bash
# Оракул O-FREE: живая проверка всех 10 бесплатных моделей opencode на текущем бинаре.
#
# Каждый прогон идёт через --standalone: свой сервер из того же бинаря, у которого
# заголовок User-Agent несёт проверяемую версию. Фоновый сервис мог быть запущен
# до замены бинаря и держит старый код в памяти.
#
# Код возврата 0 — все 10 ответили; 1 — есть модели с ошибкой (в выводе они помечены).
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

echo "бинарь: $BIN"
echo "версия: $("$BIN" --version 2>&1 | tail -1)"
echo

ok=0
bad=0
for model in "${MODELS[@]}"; do
  out=$(cd /tmp/opencode && timeout 240 "$BIN" run --standalone -m "opencode/$model" "скажи одно слово: ок" < /dev/null 2>&1 | tr -d '\033' | sed 's/\[[0-9;]*m//g')
  last=$(printf '%s' "$out" | grep -v '^$' | tail -1)
  if printf '%s' "$out" | grep -q "1.18.0 or newer"; then
    verdict="ВЕРСИОННЫЙ БЛОК"
    bad=$((bad + 1))
  elif printf '%s' "$out" | grep -qi "^Error:"; then
    verdict="ОШИБКА"
    bad=$((bad + 1))
  else
    verdict="ОТВЕТ"
    ok=$((ok + 1))
  fi
  printf '%-34s %-16s %s\n' "$model" "$verdict" "${last:0:70}"
done

echo
echo "ИТОГ: ответили $ok из ${#MODELS[@]}, с ошибкой $bad"
[ "$bad" -eq 0 ]
