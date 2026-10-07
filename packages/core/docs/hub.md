# Universal Tool Hub

## Назначение
Библиотека готовых быстрых команд поверх modern CLI (rg, fd, jq, yq, mlr, git, docker, systemctl). Модель сначала ищет готовую запись каталога через тулзу `hub`, а `shell` остаётся fallback для всего остального. Рукописные `grep -r` / `find -name` / `cat | jq` прозрачно переписываются в быстрый инструмент, когда он установлен и ответ не меняется (флаги возвращают скрытые и .gitignore-файлы, регэкспы с разным смыслом в BRE и rg не трогаются). Работает одинаково на Linux, macOS и Windows: ОС определяется автоматически (`hub/host.ts`).

## Структура
Каталог: `packages/core/src/hub/catalog/` — 12 файлов категорий, 144 записи: search (12, rg/fd), files (14, lsd/tree/rsync), text (12, sd/mlr), json (14, jq/yq), data (12, mlr/sqlite3), git (14), docker (12), systemd (10), process (10), network (10), system (12), windows (10, только pwsh + `platforms: ["win32"]`).

Ядро: `hub/types.ts` (Entry, Backend `bash | nu | pwsh`, `placeholders`, слоты `{x}`, `{x?}`, `{x*}`), `hub/host.ts` (всё платформенное: порядок бэкендов, шелл бэкенда — на Windows bash = Git Bash, никогда не WSL-`System32ash.exe`; псевдонимы бинарников `fd`→`fdfind`, `pwsh`→`powershell`; каталоги winget/scoop/choco/cargo/~/.local/bin, которых ещё нет в PATH процесса; `privileged` для root), `hub/quote.ts` (экранирование значений под шелл и под контекст кавычек в шаблоне), `hub/resolve.ts` (choose/prepare/render/missingTools/available + MissingToolError/MissingArgumentError/NoBackendError; `Machine` — внедряемая модель машины для тестов), `hub/install.ts` (planFor/detectManager: apt, dnf, pacman, zypper, apk, brew, winget, scoop, choco; `sudo -n` для запуска из панели, без sudo под root; winget — только по точным id), `hub/match.ts` (3 правила rewrite), `hub/catalog/index.ts` (плоский `all` + assert уникальности id при загрузке модуля).

Тулза: `tool/plugin/hub.ts` — list/query/install/run через тот же Shell+Job+Permission пайплайн, что и shell. Метаданные вызова несут `hubID`, `backend`, `command` — их показывает TUI-бейдж.

Интеграция: `tool/plugin/shell.ts` (prepare переписывает распознанные формы до permission-скана), `plugin/internal.ts` (HubTool перед ShellTool), `skill/instructions.ts` (HUB_GUIDANCE: hub-first, shell-fallback), `tui/.../index.tsx` (компонент Hub поверх ShellDisplay + бейдж `HUB:<id> · <backend>`), `message-parts.tsx` (`"hub"` в toolDisplays).

## Точки входа
- `Hub.all`, `Hub.get(id)`, `Hub.categories()` — каталог.
- `Hub.prepare(entry, args, { backend })` — платформа, инструменты, рендер.
- `Hub.rewrite(command, available)` — матчер рукописных форм.
- `Hub.planFor(tools)` — install-команда под детектнутый менеджер.
- Тулза `hub`: `{list}`, `{query, category}`, `{id, args, backend}`, `{install: true, id}`.

## Потребители
Модель через тулзу `hub`; shell через rewrite; TUI через метаданные; Skill-инструкции через HUB_GUIDANCE. Тесты: `packages/core/test/hub.test.ts` (12 тестов).

## Ловушки
- `danger: true` записи (files.remove, docker.prune, kill-force, systemd restart/enable) никогда не получают silent allow — permission ask обязателен.
- rewrite срабатывает только на полное совпадение якорных regex и только когда инструмент на PATH; составные `&&` команды не трогает.
- windows-записи отфильтровываются `supportsPlatform` на linux/darwin; Linux-only записи (`ps aux --sort`, `ping -c`, `lscpu`, `journalctl`, systemd) — на win32, у них есть пары `windows.*`.
- Порядок бэкендов: Linux/macOS `bash → nu → pwsh`, Windows `pwsh → bash(Git Bash) → nu`; явный `backend` проверяется первым. Простой bash-шаблон без пайпов и кавычек (`portable`) на Windows без Git Bash исполняется в PowerShell; `curl` там вызывается как `curl.exe`.
- Команда исполняется в шелле выбранного бэкенда (`Rendered.shell`), а не в «совместимом» шелле сессии.
- Значения аргументов экранируются: голый слот → одно слово; слот внутри `'…'`/`"…"` шаблона остаётся внутри литерала. NUL отклоняется.
- Тулза `hub` с `install` только печатает команду (`planned`); ставит панель Registry в TUI (`HubActions`).
