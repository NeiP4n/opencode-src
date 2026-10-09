#!/usr/bin/env python3
"""OpenCode core documentation validator.

Checks that every package listed in .opencode/doc_manifest.txt has a PACKAGE.md
document, that the document is not empty, that it has the required sections and
that it has no placeholders. The --dirs mode does the same for the subfolder
documents from .opencode/doc_manifest_dirs.txt (for example
packages/core/src/session/PACKAGE.md). In --links mode it additionally checks
that all `packages/...` paths mentioned in the .md files really exist on disk.

Run (from the repository root):
  python3 .opencode/doc_check.py                # form and completeness for all packages
  python3 .opencode/doc_check.py --links        # plus path checking
  python3 .opencode/doc_check.py --package core # a single package
  python3 .opencode/doc_check.py --surface      # reconcile the manifest with packages/
  python3 .opencode/doc_check.py --sample       # symbols from documents against sources
  python3 .opencode/doc_check.py --dirs         # subfolder documents (core/src/*, tui/src/*)
  python3 .opencode/doc_check.py --dirs --links --sample   # everything at once for subfolders

Exit code: 0 — no violations, 1 — violations found, 2 — nothing to check (no manifest).
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_NAME = "doc_manifest.txt"
DIRS_MANIFEST_NAME = "doc_manifest_dirs.txt"
PACKAGE_DOC = "PACKAGE.md"

# Sections without which a document is useless to an AI.
REQUIRED_SECTIONS = [
    "What This Is",
    "Layers and Dependencies",
    "Subsystems and Files",
    "Entry Points",
    "Where to Look Next",
    "Pitfalls",
]

# Placeholder words: a document containing them is an unfinished draft.
# The Russian entries stay on purpose: they still catch documents written in Russian.
PLACEHOLDER_PATTERNS = [
    r"\bTODO\b",
    r"\bFIXME\b",
    r"раскрыть позже",
    r"дописать позже",
    r"expand later",
    r"fill in later",
    r"describe later",
    r"\bLorem\b",
    r"coming soon",
]

# Minimum number of lines: below it there is nothing for an AI to read.
MIN_LINES = 20

PATH_RE = re.compile(r"`(packages/[^`\s]+)`")
SYMBOL_RE = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)`")


def resolve_root(value):
    """Root of the tree being checked. Defaults to the repository holding the validator."""
    if value:
        return os.path.abspath(value)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_manifest(path, key_index=1):
    """Reads a package or subfolder manifest: tab-separated lines, # marks a comment."""
    entries = []
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if not line or line.lstrip().startswith("#"):
                continue
            parts = [part.strip() for part in line.split("\t")]
            if len(parts) <= key_index:
                continue
            entry = {"layer": parts[0], "pkg": parts[1], "deps": "-", "lines": "0"}
            if key_index == 2:
                entry["dir"] = parts[2]
                entry["lines"] = parts[3] if len(parts) > 3 else "0"
                entry["deps"] = parts[5] if len(parts) > 5 else "-"
            else:
                entry["lines"] = parts[2] if len(parts) > 2 else "0"
                if len(parts) > 4:
                    entry["deps"] = parts[4]
            entries.append(entry)
    return entries


def read_doc(path):
    """Returns the document text, or None when the file does not exist."""
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def doc_problems(label, text, deps, neighbor_ref):
    """Checks shared by package documents and subfolder documents.

    label — how to name the package in messages; text — the document text; deps — the
    name of the dependency the document is required to mention; neighbor_ref — the
    string by which the link to the neighbouring document is looked up.
    """
    problems = []
    lines = text.splitlines()
    if len(lines) < MIN_LINES:
        problems.append(
            f"{label}: {PACKAGE_DOC} is shorter than {MIN_LINES} lines ({len(lines)}) — nothing to read"
        )

    for section in REQUIRED_SECTIONS:
        if section not in text:
            problems.append(f"{label}: missing required section «{section}»")

    for pattern in PLACEHOLDER_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            problems.append(
                f"{label}: placeholder «{match.group(0)}» — the document is unfinished"
            )

    if neighbor_ref and neighbor_ref not in text:
        problems.append(
            f"{label}: no link to the neighbouring document {neighbor_ref} — an AI does not know where to go next"
        )

    if deps not in ("-", "") and deps not in text:
        first_dep = deps.split(",")[0].strip()
        if first_dep not in text:
            problems.append(f"{label}: dependent package {first_dep} is not mentioned")

    return problems


def check_package(entry):
    """One package → list of problems (an empty list means OK)."""
    pkg = entry["pkg"]
    doc_path = os.path.join(ROOT, "packages", pkg, PACKAGE_DOC)
    text = read_doc(doc_path)
    if text is None:
        return [f"{pkg}: no {PACKAGE_DOC} in packages/{pkg}/"]

    # These packages have no neighbouring documents at all — requiring a link is pointless.
    neighbor_ref = None if pkg in ("app", "ui", "web", "sdk") else PACKAGE_DOC
    return doc_problems(pkg, text, entry["deps"], neighbor_ref)


def check_dir_doc(entry):
    """Subfolder document (packages/<package>/<directory>/PACKAGE.md) → list of problems."""
    pkg, sub = entry["pkg"], entry["dir"]
    label = f"{pkg}/{sub}"
    doc_path = os.path.join(ROOT, "packages", pkg, sub, PACKAGE_DOC)
    text = read_doc(doc_path)
    if text is None:
        return [f"{label}: no {PACKAGE_DOC} in packages/{pkg}/{sub}/"]

    # A subfolder document must lead back to the document of its own package.
    parent_ref = f"packages/{pkg}/{PACKAGE_DOC}"
    return doc_problems(label, text, entry["deps"], parent_ref)


def check_links(doc_path, label):
    """Paths of the form `packages/...` mentioned in the document must exist.

    Links to documents not written yet (`.md`) are the expected state at the
    starting stage: we count them separately and do not treat them as violations.
    Links with a `*` are a path template, not a path, and are not checked.
    """
    text = read_doc(doc_path)
    if text is None:
        return []

    problems = []
    for raw in PATH_RE.findall(text):
        candidate = raw.rstrip(".,;:)")
        if "*" in candidate:
            continue
        if not os.path.exists(os.path.join(ROOT, candidate)) and not candidate.endswith(
            ".md"
        ):
            problems.append(f"{label}: path does not exist — {candidate}")
    return sorted(set(problems))


def check_surface(entries):
    """Reconciles the manifest with the real packages/: every package with a package.json must be in the manifest."""
    on_disk = set()
    without_pkg = set()
    packages_dir = os.path.join(ROOT, "packages")
    if not os.path.isdir(packages_dir):
        return ["no packages/ directory"]
    for name in sorted(os.listdir(packages_dir)):
        if not os.path.isdir(os.path.join(packages_dir, name)):
            continue
        if os.path.isfile(os.path.join(packages_dir, name, "package.json")):
            on_disk.add(name)
        else:
            without_pkg.add(name)

    in_manifest = {entry["pkg"] for entry in entries}
    problems = [
        f"on disk but not in the manifest: {name}"
        for name in sorted(on_disk - in_manifest)
    ]
    problems += [
        f"in the manifest but not on disk: {name}"
        for name in sorted(in_manifest - on_disk)
    ]
    return problems


def read_src(package):
    """Texts of all .ts/.tsx files of the package — the haystack for symbol lookup."""
    src_dir = os.path.join(ROOT, "packages", package, "src")
    if not os.path.isdir(src_dir):
        return None
    haystack = []
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            try:
                with open(
                    os.path.join(root, name), encoding="utf-8", errors="replace"
                ) as handle:
                    haystack.append(handle.read())
            except OSError:
                continue
    return haystack


def check_sample(entries, docs):
    """Symbols of the form `session.Session` found in documents are looked up in the sources of the package.

    docs — a list of tuples (label, document path, package, code lines per the manifest).
    Two cases must not be mixed up: the package is declared in the manifest with code,
    but there is no src directory — that is a hole, and the oracle stays silent for that
    package (found by mutation on 06.10); a package with zero code lines per the manifest
    (storybook) has nothing to compare, and that is not a documentation defect.
    """
    cache = {}
    problems = []
    for label, doc_path, pkg, code_lines in docs:
        text = read_doc(doc_path)
        if text is None:
            continue
        if pkg not in cache:
            cache[pkg] = read_src(pkg)
        haystack = cache[pkg]
        if haystack is None:
            if code_lines not in ("0", ""):
                problems.append(
                    f"{label}: no packages/{pkg}/src, while the manifest declares {code_lines} lines — "
                    "there is nothing to compare symbols against, the oracle stays silent for this package"
                )
            continue
        blob = "\n".join(haystack)
        for symbol in SYMBOL_RE.findall(text):
            tail = symbol.rsplit(".", 1)[-1]
            if len(tail) < 4:
                continue
            if tail in blob:
                continue
            if not any(symbol in file_text for file_text in haystack):
                problems.append(
                    f"{label}: symbol not found in the sources of {pkg} — {symbol}"
                )
    return sorted(set(problems))


def main():
    parser = argparse.ArgumentParser(
        description="Validator of the OpenCode core documentation"
    )
    parser.add_argument(
        "--links",
        action="store_true",
        help="check that paths from the documents exist",
    )
    parser.add_argument("--package", help="check a single package")
    parser.add_argument(
        "--surface", action="store_true", help="reconcile the manifest with packages/"
    )
    parser.add_argument(
        "--sample",
        action="store_true",
        help="compare document symbols with the sources",
    )
    parser.add_argument(
        "--dirs",
        action="store_true",
        help="check subfolder documents from .opencode/doc_manifest_dirs.txt",
    )
    parser.add_argument(
        "--manifest",
        help="path to the manifest (defaults to doc_manifest.txt of the checked tree)",
    )
    parser.add_argument(
        "--root",
        help="root of the checked tree (defaults to the validator's repository)",
    )
    args = parser.parse_args()

    global ROOT
    ROOT = resolve_root(args.root)
    opencode_dir = os.path.join(ROOT, ".opencode")
    manifest = args.manifest
    if manifest is None:
        manifest = os.path.join(
            opencode_dir, DIRS_MANIFEST_NAME if args.dirs else MANIFEST_NAME
        )

    entries = read_manifest(manifest, key_index=2 if args.dirs else 1)
    if entries is None:
        print(f"NO MANIFEST: {manifest}", file=sys.stderr)
        return 2

    if args.package:
        entries = [entry for entry in entries if entry["pkg"] == args.package]
        if not entries:
            print(f"PACKAGE NOT IN MANIFEST: {args.package}", file=sys.stderr)
            return 2

    # Check layout: output label, check function, output mode.
    jobs = []
    for entry in entries:
        pkg = entry["pkg"]
        doc_path = os.path.join(
            ROOT, "packages", pkg, entry.get("dir", ""), PACKAGE_DOC
        )
        label = f"{pkg}/{entry['dir']}" if args.dirs else pkg
        check = check_dir_doc if args.dirs else check_package
        jobs.append((label, lambda e=entry, c=check: c(e)))
        if args.links:
            jobs.append(
                (f"{label} [links]", lambda p=doc_path, n=label: check_links(p, n))
            )

    problems = []
    if args.surface:
        found = check_surface(entries)
        if found:
            problems.extend(found)
            for problem in found:
                print(f"PROBLEM   {problem}")
    else:
        for name, run in jobs:
            found = run()
            if found:
                problems.extend(found)
                for problem in found:
                    print(f"PROBLEM   {problem}")
            else:
                print(f"OK        {name}")

    if args.sample:
        docs = [
            (
                f"{entry['pkg']}/{entry['dir']}" if args.dirs else entry["pkg"],
                os.path.join(
                    ROOT, "packages", entry["pkg"], entry.get("dir", ""), PACKAGE_DOC
                ),
                entry["pkg"],
                entry.get("lines", "0"),
            )
            for entry in entries
        ]
        found = check_sample(entries, docs)
        if found:
            problems.extend(found)
            for problem in found:
                print(f"PROBLEM   {problem}")

    if problems:
        print(f"\nTOTAL: {len(problems)} violation(s)")
        return 1

    flags = [
        name for name in ("links", "surface", "sample", "dirs") if getattr(args, name)
    ]
    label = ", ".join(flags)
    print(
        f"\nTOTAL: OK — {len(entries)} package(s){' [' + label + ']' if label else ''}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
