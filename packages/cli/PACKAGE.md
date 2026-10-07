# @opencode/cli — командная строка

## Что это

Точка входа opencode: 109 файлов, ~12.3 тыс. строк в `src/`. Реестр команд
(`serve`, `run`, `tui`, `pair`, `service`, `auth`, `mcp`, `plugin`, `session`,
`models`, `debug`, …), их обработчики, запуск сервера, служба (service),
TUI и режим ACP (Agent Client Protocol).

Именно `packages/cli/src/index.ts` запускается, когда в терминале набран
`opencode`.

## Слои и зависимости

Слой **L6 — поверхность**: зависит от `client`, `plugin`, `schema`,
`server`, `tui`, `util`.

Кто подключает: `app`, `desktop`, `enterprise`, `gui-extensions`,
`session-ui` (по `@opencode/cli/run`), сам `cli`.

Экспорт (`packages/cli/package.json`):

```json
"./vite-host": "./dev/host.js",
"./run": "./src/run/index.ts",
"./server-process": "./src/server-process.ts"
```

## Подсистемы и файлы

**Реестр команд** — `packages/cli/src/index.ts` + `commands/commands.ts`:
таблица `Handlers`, каждая команда подгружается лениво через динамический
импорт.

**Обработчики** — каталог `packages/cli/src/commands/handlers/`:
`run.ts`, `serve.ts`, `mini.ts`, `models.ts`, `pair.ts`, `reload.ts`,
`api.ts`, `stats.ts`, `upgrade.ts`, `uninstall.ts`, `default.ts` плюс
подкаталоги `auth/` (7 файлов: `login`, `logout`, `list`, `switch`,
`import`, `export`, `account`), `mcp/` (`add`, `auth`, `list`, `logout`,
`resolve`), `plugin/` (`add`, `remove`, `list`, `check`, `update`,
`inventory`), `service/` (`start`, `stop`, `restart`, `status`, `get`,
`set`, `unset`), `session/` (`list`, `delete`, `import`, `export`),
`debug/` (`agents`, `config`, `paths`, `redact`).

**Режимы запуска** — каталог `packages/cli/src/run/`: `run.ts`,
`noninteractive.ts` (пайп/скрипты), `ui.ts`, `v1.ts`, `index.ts`.

**Служба** — каталог `packages/cli/src/services/`: `service-config.ts`
(каналы и порты службы), `service-registration.ts`,
`server-connection.ts` (подключение к чужому серверу),
`standalone.ts`, `web-ui.ts`, `updater.ts` (обновления),
`update-preflight.tsx`, `retained-image.ts`.

**Конфиг CLI** — каталог `packages/cli/src/config/`: `config.ts`,
`schema.ts`, `migrate.ts`, `index.ts`.

**ACP** — каталог `packages/cli/src/acp/` (15 файлов): агент
(`agent.ts`), соединение (`connection.ts`), разрешение (`permission.ts`),
сессии (`sessions.ts`), ход (`turn.ts`), перевод (`translate.ts`).

**Сервер и рантайм** — `server-process.ts`, `mini-host.ts`, `mini.ts`,
`node/` (`plugin-runtime.effect.ts`, `plugin-runtime.promise.ts`,
`target.ts`), `framework/` (`spec.ts`, `runtime.ts`).

**UI-примочки** — `packages/cli/src/ui/` (`prompt.ts`,
`integration-picker.ts`, `timeline.tsx`), `env.ts`, `version.ts`,
`cpu-profile.ts`, `heap.ts`, `database-path.ts`, `ssh-askpass.ts`,
`session-target.ts`, `app-assets.ts`, `util/`.

## Точки входа

1. `packages/cli/src/index.ts` — корень `opencode`: реестр команд.
2. `packages/cli/src/commands/commands.ts` — сама таблица команд.
3. `packages/cli/src/run/index.ts` (экспорт `./run`) — программный запуск
   сессии из другого пакета.
4. `packages/cli/src/server-process.ts` (экспорт `./server-process`) —
   управление процессом сервера.
5. `packages/cli/src/services/service-config.ts` — каналы, порты и
   переменные службы.

## На что смотреть дальше

- `packages/server/PACKAGE.md` — что делает команда `serve`.
- `packages/tui/PACKAGE.md` — что открывает команда `tui`.
- `packages/core/PACKAGE.md` — логика, которую команды вызывают.
- `packages/script/PACKAGE.md` — версии, которые печатает `--version`.

## Ловушки

1. **Команды ленивые.** Хендлер импортируется только при вызове — ошибка
   в неиспользуемой команде не мешает остальным; но и «команда не найдена»
   бывает из-за упавшего импорта.
2. **`service` — фоновая служба, а не локальный процесс.** Порты, каналы
   и пути состояния задаются в `services/service-config.ts`; чтение
   не тех переменных даёт данные из чужого канала.
3. **Три рантайма плагинов** (`node/plugin-runtime.*`, `mini-host.ts`)
   подбираются по среде запуска — поведение `opencode run` и
   `opencode mini` отличается.
4. **ACP — отдельный протокол**, не HTTP-API: `src/acp/` не ходит в
   `server` теми же маршрутами.
5. **`./vite-host` указывает на `dev/host.js`** — это dev-хост для
   разработки, а не часть прод-бинарника.
