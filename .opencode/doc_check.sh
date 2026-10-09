#!/usr/bin/env bash
# Negative control of the documentation validator: we break documents on a TEMPORARY
# copy and check that doc_check.py notices. The repository is left untouched.
#
# What is checked:
#   mutation 1 — empty PACKAGE.md              → must complain about emptiness
#   mutation 2 — section «Entry Points» removed → must complain about the missing section
#   mutation 3 — path packages/.../nope.ts     → --links must find the broken link
#   mutation 4 — «TODO expand later» written in → must complain about the placeholder
#   control   — a clean copy passes           → exit code 0
#
# Run: bash .opencode/doc_check.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d /tmp/opencode/docneg.XXXXXX)"
MANIFEST="$ROOT/.opencode/doc_manifest.txt"
failed=0

cleanup() { rm -r "$WORK"; }
trap cleanup EXIT

# A full copy of one package: the document plus src, otherwise --sample has nothing to look at.
PKG="${1:-util}"
SRC="$ROOT/packages/$PKG"
DEST="$WORK/packages/$PKG"
mkdir -p "$WORK/packages" "$WORK/.opencode"
cp -r "$SRC" "$DEST"

# Narrow the check manifest down to a single package and put it at the root of the copy:
# the validator walks via --root, so the manifest has to live there too.
grep -E "^[^#[:space:]]" "$MANIFEST" | grep -E "[[:space:]]${PKG}[[:space:]]" > "$WORK/.opencode/doc_manifest.txt"
DOC="$DEST/PACKAGE.md"

fail() { echo "FAIL: $1"; failed=1; }

if [[ ! -f "$DOC" ]]; then
  echo "FAIL: no source $PKG/PACKAGE.md — write the package document first"
  exit 1
fi

cp "$DOC" "$WORK/clean.md"

echo "=== control: a clean copy must pass ==="
if ! python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" > "$WORK/out_clean.txt" 2>&1; then
  fail "clean copy did not pass: $(tail -1 "$WORK/out_clean.txt")"
else
  echo "OK: clean copy passed"
fi

echo "=== mutation 1: empty document ==="
: > "$DOC"
if ! python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" > "$WORK/out1.txt" 2>&1; then
  echo "OK: caught — $(grep -m1 PROBLEM "$WORK/out1.txt")"
else
  fail "empty document passed unnoticed"
fi

echo "=== mutation 2: section «Entry Points» removed ==="
python3 - "$DOC" "$WORK/clean.md" <<'PY'
import sys

doc, clean = sys.argv[1], sys.argv[2]
lines = open(clean, encoding="utf-8").readlines()
# Cut out the section heading and the body under it — up to the next ## heading.
out, skipping = [], False
for line in lines:
    if line.startswith("## "):
        skipping = "Entry Points" in line
    if not skipping:
        out.append(line)
open(doc, "w", encoding="utf-8").writelines(out)
PY
if ! python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" > "$WORK/out2.txt" 2>&1; then echo "OK: caught — $(grep -m1 PROBLEM "$WORK/out2.txt")"; else fail "document without the section passed unnoticed"; fi

echo "=== mutation 3: broken link in --links ==="
cp "$WORK/clean.md" "$DOC"
# shellcheck disable=SC2016  # backticks must stay literal: the validator looks for them
printf '\nBroken link: `packages/%s/src/nope.ts`\n' "$PKG" >> "$DOC"
if python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" --links > "$WORK/out3.txt" 2>&1; then
  fail "broken link passed unnoticed"
elif grep -q "nope.ts" "$WORK/out3.txt"; then
  echo "OK: caught exactly the broken link — $(grep -m1 'nope.ts' "$WORK/out3.txt")"
else
  fail "the validator turned red, but not on the broken link nope.ts"
fi

echo "=== mutation 4: TODO placeholder ==="
cp "$WORK/clean.md" "$DOC"
printf '\nTODO expand later\n' >> "$DOC"
if ! python3 "$ROOT/.opencode/doc_check.py" --root "$WORK" > "$WORK/out4.txt" 2>&1; then echo "OK: caught — $(grep -m1 placeholder "$WORK/out4.txt")"; else fail "placeholder passed unnoticed"; fi

cp "$WORK/clean.md" "$DOC"

if [[ $failed -ne 0 ]]; then
  echo "TOTAL: the validator MISSED defects — the mutations have to turn red"
  exit 1
fi
echo "TOTAL: OK — all 4 mutations caught, the clean copy passed"