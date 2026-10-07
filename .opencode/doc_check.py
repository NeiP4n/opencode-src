#!/usr/bin/env python3
"""Валидатор документации ядра OpenCode.

Проверяет, что каждый пакет из .opencode/doc_manifest.txt имеет документ PACKAGE.md,
документ не пустой, в нём есть обязательные разделы и нет заглушек. Режим --dirs
делает то же самое для подпапочных документов из .opencode/doc_manifest_dirs.txt
(например packages/core/src/session/PACKAGE.md). В режиме --links
дополнительно проверяет, что все упомянутые в .md пути внутри packages/... реально
существуют на диске.

Запуск (из корня репозитория):
  python3 .opencode/doc_check.py                # форма и полнота по всем пакетам
  python3 .opencode/doc_check.py --links        # плюс проверка путей
  python3 .opencode/doc_check.py --package core # один пакет
  python3 .opencode/doc_check.py --surface      # сверка манифеста с packages/
  python3 .opencode/doc_check.py --sample       # символы из документов против исходников
  python3 .opencode/doc_check.py --dirs         # подпапочные документы (core/src/*, tui/src/*)
  python3 .opencode/doc_check.py --dirs --links --sample   # всё сразу по подпапкам

Код возврата: 0 — нарушений нет, 1 — нарушения найдены, 2 — нечем проверять (нет манифеста).
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_NAME = "doc_manifest.txt"
DIRS_MANIFEST_NAME = "doc_manifest_dirs.txt"
PACKAGE_DOC = "PACKAGE.md"

# Разделы, без которых документ бесполезен для ИИ.
REQUIRED_SECTIONS = [
    "Что это",
    "Слои и зависимости",
    "Подсистемы и файлы",
    "Точки входа",
    "На что смотреть дальше",
    "Ловушки",
]

# Слова-заглушки: документ с ними — недописанная заготовка.
PLACEHOLDER_PATTERNS = [
    r"\bTODO\b",
    r"\bFIXME\b",
    r"раскрыть позже",
    r"дописать позже",
    r"\bLorem\b",
    r"coming soon",
]

# Минимум строк: ниже — ИИ нечего читать.
MIN_LINES = 20

PATH_RE = re.compile(r"`(packages/[^`\s]+)`")
SYMBOL_RE = re.compile(r"`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)`")


def resolve_root(value):
    """Корень проверяемого дерева. По умолчанию — репозиторий, где лежит сам валидатор."""
    if value:
        return os.path.abspath(value)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_manifest(path, key_index=1):
    """Читает манифест пакетов или подпапок: строки через табуляцию, # — комментарий."""
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
    """Возвращает текст документа или None, если файла нет."""
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def doc_problems(label, text, deps, neighbor_ref):
    """Проверки, общие для документов пакетов и подпапок.

    label — как называть пакет в сообщениях; text — текст документа; deps — имя
    зависимости, которую документ обязан упоминать; neighbor_ref — строка, по
    которой ищется ссылка на соседний документ.
    """
    problems = []
    lines = text.splitlines()
    if len(lines) < MIN_LINES:
        problems.append(
            f"{label}: {PACKAGE_DOC} короче {MIN_LINES} строк ({len(lines)}) — читать нечего"
        )

    for section in REQUIRED_SECTIONS:
        if section not in text:
            problems.append(f"{label}: нет обязательного раздела «{section}»")

    for pattern in PLACEHOLDER_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            problems.append(
                f"{label}: заглушка «{match.group(0)}» — документ недописан"
            )

    if neighbor_ref and neighbor_ref not in text:
        problems.append(
            f"{label}: нет ссылки на соседний документ {neighbor_ref} — ИИ не знает, куда идти дальше"
        )

    if deps not in ("-", "") and deps not in text:
        first_dep = deps.split(",")[0].strip()
        if first_dep not in text:
            problems.append(f"{label}: не упомянут зависимый пакет {first_dep}")

    return problems


def check_package(entry):
    """Один пакет → список проблем (пустой список = ОК)."""
    pkg = entry["pkg"]
    doc_path = os.path.join(ROOT, "packages", pkg, PACKAGE_DOC)
    text = read_doc(doc_path)
    if text is None:
        return [f"{pkg}: нет {PACKAGE_DOC} в packages/{pkg}/"]

    # У этих пакетов соседних документов нет вовсе — требовать ссылку незачем.
    neighbor_ref = None if pkg in ("app", "ui", "web", "sdk") else PACKAGE_DOC
    return doc_problems(pkg, text, entry["deps"], neighbor_ref)


def check_dir_doc(entry):
    """Подпапочный документ (packages/<пакет>/<каталог>/PACKAGE.md) → список проблем."""
    pkg, sub = entry["pkg"], entry["dir"]
    label = f"{pkg}/{sub}"
    doc_path = os.path.join(ROOT, "packages", pkg, sub, PACKAGE_DOC)
    text = read_doc(doc_path)
    if text is None:
        return [f"{label}: нет {PACKAGE_DOC} в packages/{pkg}/{sub}/"]

    # Подпапочный документ обязан вести к документу своего пакета.
    parent_ref = f"packages/{pkg}/{PACKAGE_DOC}"
    return doc_problems(label, text, entry["deps"], parent_ref)


def check_links(doc_path, label):
    """Пути вида `packages/...`, упомянутые в документе, должны существовать.

    Ссылки на ещё не написанные документы (`.md`) — ожидаемое состояние на
    начальной стадии: их считаем отдельно и нарушением не делаем. Ссылки с
    `*` — это шаблон пути, а не путь, проверке не подлежат.
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
            problems.append(f"{label}: путь не существует — {candidate}")
    return sorted(set(problems))


def check_surface(entries):
    """Сверяет манифест с реальным packages/: каждый пакет с package.json обязан быть в манифесте."""
    on_disk = set()
    without_pkg = set()
    packages_dir = os.path.join(ROOT, "packages")
    if not os.path.isdir(packages_dir):
        return ["каталога packages/ нет"]
    for name in sorted(os.listdir(packages_dir)):
        if not os.path.isdir(os.path.join(packages_dir, name)):
            continue
        if os.path.isfile(os.path.join(packages_dir, name, "package.json")):
            on_disk.add(name)
        else:
            without_pkg.add(name)

    in_manifest = {entry["pkg"] for entry in entries}
    problems = [
        f"на диске, но нет в манифесте: {name}"
        for name in sorted(on_disk - in_manifest)
    ]
    problems += [
        f"в манифесте, но нет на диске: {name}"
        for name in sorted(in_manifest - on_disk)
    ]
    return problems


def read_src(package):
    """Тексты всех .ts/.tsx пакета — haystack для поиска символов."""
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
    """Символы вида `session.Session` из документов ищем в исходниках пакета.

    docs — список кортежей (метка, путь к документу, пакет, строк кода по манифесту).
    Два случая нельзя смешивать: пакет объявлен в манифесте с кодом, а каталога src нет —
    это дыра, по пакету оракул молчит (найдено мутацией 06.10); пакет с нулём строк кода
    по манифесту (storybook) — сверять нечего, и это не дефект документации.
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
                    f"{label}: нет packages/{pkg}/src, а манифест объявляет {code_lines} строк — "
                    "сверять символы нечем, оракул по пакету молчит"
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
                    f"{label}: символ не найден в исходниках {pkg} — {symbol}"
                )
    return sorted(set(problems))


def main():
    parser = argparse.ArgumentParser(description="Валидатор документации ядра OpenCode")
    parser.add_argument(
        "--links",
        action="store_true",
        help="проверять существование путей из документов",
    )
    parser.add_argument("--package", help="проверить один пакет")
    parser.add_argument(
        "--surface", action="store_true", help="сверка манифеста с packages/"
    )
    parser.add_argument(
        "--sample", action="store_true", help="сверить символы документов с исходниками"
    )
    parser.add_argument(
        "--dirs",
        action="store_true",
        help="проверять подпапочные документы по .opencode/doc_manifest_dirs.txt",
    )
    parser.add_argument(
        "--manifest",
        help="путь к манифесту (по умолчанию — doc_manifest.txt проверяемого дерева)",
    )
    parser.add_argument(
        "--root",
        help="корень проверяемого дерева (по умолчанию — репозиторий валидатора)",
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
        print(f"НЕТ МАНИФЕСТА: {manifest}", file=sys.stderr)
        return 2

    if args.package:
        entries = [entry for entry in entries if entry["pkg"] == args.package]
        if not entries:
            print(f"ПАКЕТ НЕ В МАНИФЕСТЕ: {args.package}", file=sys.stderr)
            return 2

    # Раскладка проверок: подпись для вывода, функция проверки, режим вывода.
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
                print(f"ПРОБЛЕМА  {problem}")
    else:
        for name, run in jobs:
            found = run()
            if found:
                problems.extend(found)
                for problem in found:
                    print(f"ПРОБЛЕМА  {problem}")
            else:
                print(f"ОК        {name}")

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
                print(f"ПРОБЛЕМА  {problem}")

    if problems:
        print(f"\nИТОГ: {len(problems)} нарушение(й)")
        return 1

    flags = [
        name for name in ("links", "surface", "sample", "dirs") if getattr(args, name)
    ]
    label = ", ".join(flags)
    print(f"\nИТОГ: ОК — {len(entries)} пакет(ов){' [' + label + ']' if label else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
