#!/usr/bin/env python3
"""Oracle O-CORE-DOCS: checks the documentation of the packages/core/docs/ folders.

The list of folders is taken from the packages/core/src/* tree itself, not from a
hardcoded list: otherwise the oracle silently turns green when new folders appear
without documents.

Run (from any directory):
  python3 .opencode/check_core_docs.py            # checks the real packages/core/docs
  python3 .opencode/check_core_docs.py <directory>  # checks a copy (for the negative control)

Document template (owner decision DEC-6, 07.10): one file per core folder,
sections «What's In This Folder / Key Files / Important Details / Connections / Pitfalls».

Exit code: 0 — all folders are described and formatted, 1 — violations.
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE_SRC = os.path.join(REPO, "packages", "core", "src")
DOCS = os.path.join(REPO, "packages", "core", "docs")

# Topics without their own folder in src: a document is mandatory, but there is no directory.
EXTRA_TOPICS = ["models-dev"]

SECTIONS = [
    "What's In This Folder",
    "Key Files",
    "Important Details",
    "Connections",
    "Pitfalls",
]
MIN_LINES = 20
# A small folder — a short document, a big one — longer: otherwise we would have to stay
# silent about complex code or write essays bypassing all the rules.
SMALL_CODE = 1000
MAX_LINES_SMALL = 150
MAX_LINES_BIG = 260
# The Russian entries stay on purpose: they still catch documents written in Russian.
BANNED = [
    "TODO",
    "FIXME",
    "Lorem",
    "раскрыть позже",
    "дописать позже",
    "expand later",
    "fill in later",
    "describe later",
    "coming soon",
]
PATH_RE = re.compile(r"`(packages/[^`\s]+)`")
# Folder names contain digits (v1, oauth2), otherwise such a folder heading gives a false violation.
HEAD_RE = re.compile(r"^# core/([a-z0-9-]+) — \S")


def code_lines(folder):
    """How many .ts/.tsx lines the folder has — the document length ceiling depends on it."""
    total = 0
    for root, _dirs, names in os.walk(os.path.join(CORE_SRC, folder)):
        for name in names:
            if name.endswith((".ts", ".tsx")):
                try:
                    with open(
                        os.path.join(root, name), encoding="utf-8", errors="replace"
                    ) as fh:
                        total += sum(1 for _ in fh)
                except OSError:
                    continue
    return total


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else DOCS
    folders = (
        sorted(
            name
            for name in os.listdir(CORE_SRC)
            if os.path.isdir(os.path.join(CORE_SRC, name))
        )
        + EXTRA_TOPICS
    )

    problems = []
    checked = []
    for folder in folders:
        path = os.path.join(root, folder + ".md")
        label = f"core/{folder}"
        if not os.path.isfile(path):
            problems.append(f"{label}: no file {folder}.md")
            continue
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        lines = text.splitlines()
        checked.append(label)

        if not text.strip():
            problems.append(f"{label}: file is empty")
            continue
        if len(lines) < MIN_LINES:
            problems.append(f"{label}: {len(lines)} lines, minimum is {MIN_LINES}")

        size = code_lines(folder)
        limit = MAX_LINES_SMALL if size < SMALL_CODE else MAX_LINES_BIG
        if len(lines) > limit:
            problems.append(
                f"{label}: {len(lines)} lines for {size} lines of code, the ceiling for such a folder is {limit}"
            )

        head = HEAD_RE.match(lines[0]) if lines else None
        if not head:
            problems.append(
                f"{label}: the first line is not a heading of the form '# core/<folder> — purpose'"
            )
        elif head.group(1) != folder:
            problems.append(f"{label}: the heading names the folder {head.group(1)}")

        for section in SECTIONS:
            if f"## {section}" not in text:
                problems.append(f"{label}: missing section «{section}»")

        for word in BANNED:
            if re.search(r"\b" + re.escape(word) + r"\b", text, re.IGNORECASE):
                problems.append(f"{label}: banned word «{word}»")

        for raw in PATH_RE.findall(text):
            candidate = raw.rstrip(".,;:)")
            if "*" in candidate or candidate.endswith(".md"):
                continue
            if not os.path.exists(os.path.join(REPO, candidate)):
                problems.append(f"{label}: path does not exist — {candidate}")

    for problem in problems:
        print("PROBLEM  ", problem)

    verdict = "no violations" if not problems else f"{len(problems)} violation(s)"
    print(f"\nTOTAL: {verdict} — {len(checked)}/{len(folders)} documents in {root}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
