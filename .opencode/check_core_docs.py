#!/usr/bin/env python3
"""Оракул O-CORE-DOCS: проверяет документацию папок packages/core/docs/.

Список папок берётся из самого дерева packages/core/src/*, а не из захардкоженного
списка: иначе оракул молча зеленеет, когда появляются новые папки без документов.

Запуск (из любого каталога):
  python3 .opencode/check_core_docs.py            # проверяет боевой packages/core/docs
  python3 .opencode/check_core_docs.py <каталог>  # проверяет копию (для отрицательного контроля)

Шаблон документа (решение владельца DEC-6, 07.10): один файл на одну папку ядра,
разделы «Что в папке / Ключевые файлы / Важные детали / Связи / Ловушки».

Код возврата: 0 — все папки описаны и оформлены, 1 — нарушения.
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE_SRC = os.path.join(REPO, "packages", "core", "src")
DOCS = os.path.join(REPO, "packages", "core", "docs")

# Темы без собственной папки в src: документ обязатежен, но каталога нет.
EXTRA_TOPICS = ["models-dev"]

SECTIONS = ["Что в папке", "Ключевые файлы", "Важные детали", "Связи", "Ловушки"]
MIN_LINES = 20
# Мелкая папка — короткий документ, большая — длиннее: иначе пришлось бы молчать
# о сложном коде или писать простыни в обход всех правил.
SMALL_CODE = 1000
MAX_LINES_SMALL = 150
MAX_LINES_BIG = 260
BANNED = ["TODO", "FIXME", "Lorem", "раскрыть позже", "дописать позже", "coming soon"]
PATH_RE = re.compile(r"`(packages/[^`\s]+)`")
# В имени папки бывают цифры (v1, oauth2), иначе заголовок такой папки даёт ложное нарушение.
HEAD_RE = re.compile(r"^# core/([a-z0-9-]+) — \S")


def code_lines(folder):
    """Сколько строк .ts/.tsx в папке — от этого зависит потолок длины документа."""
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
            problems.append(f"{label}: нет файла {folder}.md")
            continue
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        lines = text.splitlines()
        checked.append(label)

        if not text.strip():
            problems.append(f"{label}: файл пуст")
            continue
        if len(lines) < MIN_LINES:
            problems.append(f"{label}: {len(lines)} строк, минимум {MIN_LINES}")

        size = code_lines(folder)
        limit = MAX_LINES_SMALL if size < SMALL_CODE else MAX_LINES_BIG
        if len(lines) > limit:
            problems.append(
                f"{label}: {len(lines)} строк при коде {size}, потолок для такой папки {limit}"
            )

        head = HEAD_RE.match(lines[0]) if lines else None
        if not head:
            problems.append(
                f"{label}: первая строка не заголовок вида '# core/<папка> — назначение'"
            )
        elif head.group(1) != folder:
            problems.append(f"{label}: заголовок называет папку {head.group(1)}")

        for section in SECTIONS:
            if f"## {section}" not in text:
                problems.append(f"{label}: нет раздела «{section}»")

        for word in BANNED:
            if re.search(r"\b" + re.escape(word) + r"\b", text, re.IGNORECASE):
                problems.append(f"{label}: запрещённое слово «{word}»")

        for raw in PATH_RE.findall(text):
            candidate = raw.rstrip(".,;:)")
            if "*" in candidate or candidate.endswith(".md"):
                continue
            if not os.path.exists(os.path.join(REPO, candidate)):
                problems.append(f"{label}: путь не существует — {candidate}")

    for problem in problems:
        print("ПРОБЛЕМА ", problem)

    verdict = "нарушений нет" if not problems else f"{len(problems)} нарушение(й)"
    print(f"\nИТОГ: {verdict} — {len(checked)}/{len(folders)} документов в {root}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
