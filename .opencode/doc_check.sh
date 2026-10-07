#!/usr/bin/env bash
# Отрицательный контроль валидатора документации: ломаем документы на ВРЕМЕННОЙ копии
# и проверяем, что doc_check.py это замечает. Репозиторий не трогаем.
#
# Что проверяется:
#   мутация 1 — пустой PACKAGE.md              → должен ругаться на пустоту
#   мутация 2 — убран раздел «Точки входа»      → должен ругаться на отсутствие раздела
#   мутация 3 — путь packages/.../nope.ts       → --links должен найти битую ссылку
#   мутация 4 — вписано «TODO раскрыть»         → должен ругаться на заглушку
#   контроль — чистая копия проходит            → код 0
#
# Запуск: bash .opencode/doc_check.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d /tmp/opencode/docneg.XXXXXX)"
MANIFEST="$ROOT/.opencode/doc_manifest.txt"
failed=0

cleanup() { rm -r "$WORK"; }
trap cleanup EXIT

# Копия одного пакета целиком: документ плюс src, иначе --sample искать нечего.
PKG="${1:-util}"
SRC="$ROOT/packages/$PKG"
DEST="$WORK/packages/$PKG"
mkdir -p "$WORK/packages" "$WORK/.opencode"
cp -r "$SRC" "$DEST"

# Манифест проверки сужаем до одного пакета и кладём в корень копии:
# валидатор ходит по --root, поэтому манифест обязан лежать там же.
grep -E "^[^#[:space:]]" "$MANIFEST" | grep -E "[[:space:]]${PKG}[[:space:]]" > "$WORK/.opencode/doc_manifest.txt"
DOC="$DEST/PACKAGE.md"

fail() { echo "ПРОВАЛ: $1"; failed=1; }

if [[ ! -f "$DOC" ]]; then
  echo "ПРОВАЛ: нет исходного $PKG/PACKAGE.md — сначала напиши документ пакета"
  exit 1
fi

cp "$DOC" "$WORK/clean.md"

echo "=== контроль: чистая копия должна пройти ==="
if ! python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" > "$WORK/out_clean.txt" 2>&1; then
  fail "чистая копия не прошла: $(tail -1 "$WORK/out_clean.txt")"
else
  echo "ОК: чистая копия прошла"
fi

echo "=== мутация 1: пустой документ ==="
: > "$DOC"
if ! python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" > "$WORK/out1.txt" 2>&1; then
  echo "ОК: поймал — $(grep -m1 ПРОБЛЕМА "$WORK/out1.txt")"
else
  fail "пустой документ прошёл незамеченным"
fi

echo "=== мутация 2: убран раздел «Точки входа» ==="
python3 - "$DOC" "$WORK/clean.md" <<'PY'
import sys

doc, clean = sys.argv[1], sys.argv[2]
lines = open(clean, encoding="utf-8").readlines()
# Вырезаем заголовок раздела и тело под ним — до следующего заголовка ##.
out, skipping = [], False
for line in lines:
    if line.startswith("## "):
        skipping = "Точки входа" in line
    if not skipping:
        out.append(line)
open(doc, "w", encoding="utf-8").writelines(out)
PY
if ! python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" > "$WORK/out2.txt" 2>&1; then echo "ОК: поймал — $(grep -m1 ПРОБЛЕМА "$WORK/out2.txt")"; else fail "документ без раздела прошёл незамеченным"; fi

echo "=== мутация 3: битая ссылка в --links ==="
cp "$WORK/clean.md" "$DOC"
# shellcheck disable=SC2016  # обратные кавычки должны остаться буквальными: их ищет валидатор
printf '\nБитая ссылка: `packages/%s/src/nope.ts`\n' "$PKG" >> "$DOC"
if python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" --links > "$WORK/out3.txt" 2>&1; then
  fail "битая ссылка прошла незамеченной"
elif grep -q "nope.ts" "$WORK/out3.txt"; then
  echo "ОК: поймал именно битую ссылку — $(grep -m1 'nope.ts' "$WORK/out3.txt")"
else
  fail "валидатор покраснел, но не на битую ссылку nope.ts"
fi

echo "=== мутация 4: заглушка TODO ==="
cp "$WORK/clean.md" "$DOC"
printf '\nTODO раскрыть позже\n' >> "$DOC"
if ! python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" > "$WORK/out4.txt" 2>&1; then echo "ОК: поймал — $(grep -m1 заглушка "$WORK/out4.txt")"; else fail "заглушка прошла незамеченной"; fi

cp "$WORK/clean.md" "$DOC"

if [[ $failed -ne 0 ]]; then
  echo "ИТОГ: валидатор ПРОПУСТИЛ дефекты — мутации обязаны краснеть"
  exit 1
fi
echo "ИТОГ: ОК — все 4 мутации пойманы, чистая копия прошла"