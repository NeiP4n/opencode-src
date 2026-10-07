# core/src — файловая система, Git, терминалы, локации и плагины

## Что в папке

Двадцать файлов верхнего уровня `packages/core/src` — граница ядра и реального окружения: работа с файлами и поиск по ним, git-операции, история изменений, терминалы, жизненный цикл Location и загрузка плагинов. Почти все — Effect-сервисы (`Context.Service`), собранные через узлы графа: глобальные (`makeGlobalNode`) — `git.ts`, `repository-cache.ts`, `worktree.ts`, `location-activity.ts`; привязанные к Location (`makeLocationNode`) — `vcs.ts`, `filesystem.ts`, `file-access.ts`, `file-mutation.ts`, `ripgrep.ts`, `shell.ts`, `pty.ts`, `snapshot.ts`, `location-lifecycle.ts`, `plugin.ts`.

Файлы делятся на четыре слоя: низкий уровень ввода-вывода (`filesystem`, `file-access`, `file-mutation`, `ripgrep`, `shell`, `pty`), контроль версий (`git`, `vcs`, `snapshot`, `repository`, `repository-cache`, `worktree`), управление размещениями (`location`, `location-service-map`, `location-services`, `location-activity`, `location-lifecycle`) и расширения (`plugin`).

## Ключевые файлы

- `packages/core/src/git.ts` — единственная точка вызова git как процесса. Сервис `Git` с разделами `repo`, `remote`, `history`, `sync`, `worktree`, `index`, `tree`; ошибки `OperationError` и `WorktreeError`; локальный `KeyedMutex` на `gitDirectory`; конфиг хранилища `opencode.gitconfig` через `include.path`.
- `packages/core/src/vcs.ts` — независимый от git слой над провайдерами VCS из плагинов. Держит выбранного провайдера, `State`-редактор, `Bus`-события `VcsEvent.BranchUpdated`, следит за файлом метаданных ветки через `FileSystem.Event.Changed`.
- `packages/core/src/snapshot.ts` — снимки файловой системы Location как content-addressed git-деревья: `capture`, `files`, `diff`, `restore` плюс переключатель `enabled`.
- `packages/core/src/repository.ts` — разбор строки репозитория в `RemoteReference`/`FileReference`, проверка имени ветки, ключи кэша.
- `packages/core/src/repository-cache.ts` — сервис `RepositoryCache.ensure`: локальные чекауты по remote+branch с клонированием, ежедневным освежением и файловым flock.
- `packages/core/src/worktree.ts` — работа с рабочими копиями проекта: `list`, `create`, `remove`, `refresh` поверх стратегий и таблицы `worktree`.
- `packages/core/src/filesystem.ts` — Location-сервис чтения (`read`), листинга (`list`), поиска (`find`) и записи (`write`).
- `packages/core/src/file-access.ts` — лексическое разрешение пути в `Target`, батч-одобрение внешних директорий, `authorizeRead`.
- `packages/core/src/file-mutation.ts` — сериализация мутаций по пути и запись с сохранением BOM.
- `packages/core/src/ripgrep.ts` — адаптер запуска `rg`: `find`, `glob`, `grep` поверх `environment.spawner`.
- `packages/core/src/shell.ts` — неинтерактивные команды с выводом в файл: `create`, `list`, `get`, `wait`, `result`, `timeout`, `output`, `remove`.
- `packages/core/src/pty.ts` — интерактивные терминалы на нативном `#pty`: сессии, буфер, `attach` с реплеем.
- `packages/core/src/persistent-pty.ts` — одна строка-реэкспорт `PersistentPty` из `packages/core/src/persistent-pty/index.ts`.
- `packages/core/src/location.ts` — `Location.Service`: каталог, `workspaceID`, проект, опциональный `vcs`.
- `packages/core/src/location-service-map.ts` — `LayerMap` сервисов по `Location.Ref` плюс `canonical()` и `reload()`.
- `packages/core/src/location-services.ts` — сборка карты через `Instance.layer`, корректное закрытие и вытеснение записей.
- `packages/core/src/location-activity.ts` — учёт недавней активности Location и вытеснение простаивающих.
- `packages/core/src/location-lifecycle.ts` — `isClosed`/`shutdown`: закрытие прав, форм, RPC и публикация `LocationEvent.Shutdown`.
- `packages/core/src/file-retention.ts` — `cleanup`: удаление файлов старше порога по `mtime`.
- `packages/core/src/plugin.ts` — активация набора плагинов, инвентарь, `awaitActivation`, отключение после сбоя `transform`.

## Важные детали

- `git.repo.create` пишет собственный конфиг: `core.autocrlf=false`, `longpaths`, `feature.manyFiles`, `index.version=4`, `threads`; файл подключается через `include.path` в `$GIT_DIR/config`. При `seed` общие объекты подключаются через `objects/info/alternates`, индекс копируется с игнорированием ошибок.
- Все команды git запускаются с `--git-dir`/`--work-tree` явными путями репозитория, кроме clone и подкоманд worktree.
- `Git.tree.capture` обновляет индекс только в переданных scope, затем пишет дерево; `Git.tree.diff` делает три параллельных запуска (`--name-status`, `--numstat`, patch) вместо запуска на файл.
- Снимки хранятся в `global.data/snapshot/<projectID>/<hash(worktree)>`; `capture` отказывается работать вне git-проекта и отсекает untracked-файлы больше 2 МиБ.
- `Repository.cachePath` добавляет ветку как `@<percent-encoded>`; ключ KV — `repository-cache:<localPath>`, тот же ключ используется для flock; интервал «ежедневного» освежения — сутки.
- `repository-cache` читает `refresh: "daily"` как «не чаще суток», а `true` как «всегда»; статус результата — `cached`/`cloned`/`refreshed`.
- `Vcs.diff` ограничивает суммарный объём патчей `MAX_TOTAL_PATCH_BYTES`, файлы сверх лимита получают пустой патч; размер контекста по умолчанию — `PATCH_CONTEXT_LINES`.
- `FileSystem` содержит константы `DEFAULT_SEARCH_LIMIT = 100` и `DEFAULT_SEARCH_TIMEOUT_MS = 30000`.
- `Shell`: вывод пишется в `global.data/shell/<projectID>/<id>.out`, `RETENTION` — 7 суток, уборка запускается раз в час, в памяти держится до 25 завершившихся команд, чтение вывода по умолчанию не больше 65536 байт за курсор.
- `Shell.result` берёт хвост по `max_lines`/`max_bytes` из конфигурации `tool_output` и добавляет строку с указанием диапазона показанных строк.
- `Pty`: буфер сессии ограничен 2 МиБ, старые данные отбрасываются с продвижением `bufferCursor`; завершившиеся сессии хранятся до 25 штук; `attach` на нерабочей сессии даёт `ExitedError`, курсор `-1` означает «только с текущего конца».
- `Ripgrep` читает не больше `limit + 1` строк, чтобы отличить усечение от точного результата; подсовпадения обрезаются до 100, текст строки — до 2000 символов, stderr — до 8 КиБ.
- `LocationActivity`: время жизни записи 60 минут, фоновый проход раз в минуту; перед вытеснением прерываются исполнения сессий этой локации с ожиданием расчёта.
- `buildLocationServiceMap` задаёт `idleTimeToLive: Duration.infinity` — здоровые графы удерживаются, вытеснение только явное.
- `Plugin.activate` сравнивает определения по префиксу: перезагружается только суффикс после первого различия по id или ревизии.

## Связи

- `snapshot.ts` → `git.ts` (`repo.discover`, `repo.create`, `index.ignored`, `tree.*`) + `state.ts` для флага `enabled`; `noopLayer` отдаёт пустые ответы, когда снимки не нужны.
- `vcs.ts` → `location.ts` (каталог, `project`, `vcs.store`), `bus.ts`, `state.ts`, `vcs/patch.ts`; провайдеры приходят из плагинов, их ответы декодируются схемами `@opencode/schema/vcs`.
- `repository-cache.ts` → `git.ts`, `repository.ts`, `kv.ts`, `effect-flock`, `packages/util/src/global.ts`; кэш лежит под `Global.repos`.
- `worktree.ts` → `database/database.ts` и `worktree/sql.ts` (таблица), `worktree/strategies.ts` (набор стратегий), `worktree/directory.ts` (канонизация пути), `location-service-map.ts` (сервисы чужой локации), `app-node`-зависимость `Git.node` ради ошибок worktree.
- `filesystem.ts` → `filesystem/search.ts` (поиск поверх `ripgrep.ts`), `location.ts`, `schema.ts` (`AbsolutePath`/`RelativePath`).
- `file-access.ts` → `permission.ts` (одобрение действий `external_directory` и `read`), `project.ts` (корень проекта для `save`), `tool.ts` (тип контекста вызова).
- `file-mutation.ts` → `environment/index.ts` (`files.stat/read/write`), `effect/keyed-mutex.ts`, тип `FileAccess.Target`, `bom`-утилиты; `file-retention.ts` обслуживает файлы, которые оставляет `shell.ts`.
- `shell.ts` → `shell/select.ts` (выбор оболочки и аргументов), `environment` (spawner), `plugin/hooks.ts` (`shell/create.before`), `config.ts`, `tool-output.ts`, `bus.ts`, `session/environment.ts` (окружение сессии).
- `pty.ts` → ленивый импорт `#pty`, `shell/select.ts` (команда и логин-флаг), `bus.ts`; `persistent-pty.ts` переэкспортирует демон из `persistent-pty/index.ts`.
- `location-services.ts` → `instance.ts` (`Instance.layer` с подменами), `location-service-map.ts`, `location-lifecycle.ts`; кэш инстансов берёт граф владельца, а не удерживает его scope.
- `location-lifecycle.ts` → `permission.ts`, `form.ts`, `rpc.ts`, `project.ts`, `bus.ts`; `location-activity.ts` → `location-service-map.ts`, `session/execution.ts`, `session/store.ts`, `bus.ts`.
- `plugin.ts` → `plugin/host.ts` (реестр хост-функций и хранилище на `kv.ts`), `plugin/service.ts` (сервис и тип `Generation`), `state.ts` (наследование, пакетные обновления, откат).

## Ловушки

- `Git.index.refresh` удаляет из индекса игнорируемые и слишком крупные untracked-файлы через `rm --cached -f`: рабочие файлы остаются на месте, меняется только индекс. Стадится только разрешённая часть, всё остальное в репозитории не трогается.
- В `Git.tree.diff` имена и числа идут через `-z`, а патчи — без кавычек (`-c core.quotepath=false`): так разбиение патча по файлам продолжает совпадать для не-ASCII имён.
- `Git.tree.files` и `diff` всегда работают с `--no-renames`: отдаются обе стороны переименования, потому что откат меняет обе.
- `Git.tree.restore` сначала спрашивает `ls-tree`, а если пути в дереве нет — удаляет его с диска. Всё выполняется под блокировкой по `gitDirectory`.
- `Git.repo.discover` поднимается вверх по дереву, поэтому в `repository-cache` проверка повторного использования сравнивает `worktree` с самим путём кэша: иначе внешний репозиторий с тем же origin выдаст себя за запись кэша.
- `repository-cache` записывает время попытки до сетевой работы, поэтому неудачный клон тоже подпадает под суточный интервал; обновление идёт по принципу «новое побеждает» — `fetch` плюс `reset --hard` двигают чекаут под читателями.
- `FileSystem.read` ограничен `FSUtil.contains` дважды (по каталогу локации и по реальному пути), а `FileSystem.write` намеренно выходит за пределы локации — чтобы клиент мог класть файлы во временный каталог сервера.
- `FileAccess.resolve` считает внутренними и каталог локации, и каталог проекта; для внешнего пути `save` строится от корня проекта, найденного через `Project.root`, а не от каталога локации.
- `FileMutation.withLock` берёт глобальный мьютекс по отсортированным путям (обратный порядок обхода), поэтому блокировки не конфликтуют между локациями; лок, однако, только внутри процесса — внешние записи могут гоняться.
- `Shell.wait` резолвится до вытеснения команды из памяти, поэтому удалённая после завершения команда всё равно отдаёт свой код выхода, а не `NotFoundError`.
- `Shell` намеренно прерывает таймаут-фибру последним в `finish`: порядок нужен, чтобы ожидающие увидели терминальный статус.
- `Ripgrep`: код 1 — «совпадений нет» и это пустой успешный результат; код 2 вместе с текстом про разбор регулярки даёт `InvalidPatternError`; любой другой код — ошибка выполнения.
- `Ripgrep.glob` при `hidden: false` добавляет `--glob=!**/.*` после позитивного глоба: положительный паттерн иначе отменяет встроенный фильтр скрытых файлов.
- `Vcs`: для `info`, `branches`, `status` сбой провайдера превращается в предупреждение и пустой запасной ответ, а для `base` и `diff` — в ошибку `DiffError`; прерывания не глотаются, а превращаются в дефект.
- `Vcs.refresh` публикует событие в цикле: если ветка успела смениться, пока публиковались вложенные обновления, событие отправляется повторно с актуальным значением.
- `LocationServiceMap.canonical` нормализует путь только на win32; на остальных платформах эквивалентные по смыслу, но разные по написанию пути дают разные ключи кэша.
- `buildLocationServiceMap` при вытеснении сначала разрывает маршрутизацию и только потом закрывает запись, и всё это uninterруптибельно; упавшая сборка вытесняется в scope владельца, иначе замена успела бы вытесниться сама.
- `LocationActivity` при истечении срока сначала прерывает исполнения сессий с ожиданием расчёта и лишь потом отсоединяет запись кэша: у заёмщиков остаётся старый граф, пока они не передадут работу на границе шага.
- `Plugin.activate` при совпадении префикса переиспользует живые слоты; если перестановка здоровых регистраций затронула слот с той же неуспешной ревизией, повторной загрузки не будет до смены ревизии. Дубликат `Plugin.ID` приводит к `Effect.die`.
- `Plugin` никогда не присоединяет финализаторы пользователя под локом активации или под удержанием готовности — для этого отложенная очередь срабатываний развязана через `hold`/`release`.
