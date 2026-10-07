# core/plugin — слой плагинов: реестр, загрузка модулей, встроенные плагины, провайдеры, веб-поиск и VCS-адаптеры

## Что в папке

68 файлов `.ts` плюс текстовые ассеты: `packages/core/src/plugin/command/`
(`initialize.txt`, `review.txt`), `packages/core/src/plugin/skill/`
(`opencode.md`, `report.md`), `packages/core/src/plugin/system-prompt/`
(шесть файлов: `gpt.txt`, `gpt-astra.txt`, `anthropic.txt`, `kimi.txt`,
`meta.txt`, `trinity.txt`).

Подпапки: `provider/` — 33 файла адаптеров и слоёв поверх каталога
models.dev; `websearch/` — 7 файлов (5 поисковиков плюс общий MCP-клиент);
`vcs/` — 2 адаптера (`git.ts`, `hg.ts`).

Плагин — это `{ id, effect }`; `effect` получает `Plugin.Context` и работает
через редакторы (`transform`) сервисов и хуки (`hook`).

## Ключевые файлы

- `packages/core/src/plugin/internal.ts` — реестр встроенных плагинов: список
  `services`, `requirements` (LayerNode.group), порядок `pre`, порядок `post`,
  множество `guarded`. `list()` снимает сервисы из текущего контекста и
  оборачивает каждый `effect` через `Effect.provide`.
- `packages/core/src/plugin/supervisor.ts` — сборка поколения плагинов:
  `resolve()` применяет операции конфига, `activate()` строит список,
  `Queue.sliding(1)` + дебаунс 100 мс схлопывают всплеск запросов,
  `hold()`/`release()` держат `awaitActivation`.
- `packages/core/src/plugin/host.ts` — сборка `Plugin.Context` из сервисов
  (агент, модель, провайдер, команда, MCP, скилл, tool, vcs, веб-поиск,
  worktree, session, хранилище).
- `packages/core/src/plugin/service.ts` — тег `@opencode/Plugin` и тип
  `Generation` (`revision`, `source`, `features` поверх определения плагина).
- `packages/core/src/plugin/hooks.ts` — реестр хуков по доменам `aisdk`,
  `session`, `permission`, `shell`, `tool`; ключ — строка `домен.имя`.
- `packages/core/src/plugin/module.ts` — загрузка модуля: npm-установка или
  локальный путь, `Host.load` либо `sources.read`, валидация `Module` схемой.
- `packages/core/src/plugin/sdk.ts` и `packages/core/src/plugin/instance.ts` —
  два источника плагинов: глобальный для хоста (`SdkPlugins`) и набор при
  рождении инстанса (`InstancePlugins`).
- `packages/core/src/plugin/update.ts` — проверка и обновление npm-пакетов
  плагинов, кэш проверки на сутки, `KeyedMutex` на каждый target.
- `packages/core/src/plugin/provider.ts` — список `ProviderPlugins` (32 позиции).
- `packages/core/src/plugin/vcs/git.ts`, `packages/core/src/plugin/vcs/hg.ts` —
  адаптеры `Adapter` из `packages/core/src/vcs.ts`.
- `packages/core/src/plugin/websearch/mcp.ts` — общий JSON-RPC клиент
  `tools/call`, разбор прямого JSON и потока `data: `.

## Важные детали

- Порядок в `pre` — семантика, а не стиль: `PatchTool.Plugin` идёт раньше
  `OptimizePlugin.Plugins`, потому что подсказки про инструменты рендерятся
  после выбора доступных инструментов правки.
- `post` — плагины конфигурации (`config/plugin/*.ts`), они видят результат
  встроенных.
- `guarded` содержит `opencode.provider.opencode` и плагин политики: операции
  `remove` их пропускают, иначе репозиторный конфиг мог бы отключить
  enforcement политики или связь с Console.
- `InstancePlugins` добавляются последними в `pre`: более поздняя активация
  перекрывает более ранние записи контейнера, поэтому явный выбор инстанса
  выигрывает у глобальных настроек.
- Активация двухпроходная: сначала `resolve` с `install: false`, затем, если
  остались `pending`, второй проход с установкой. Пакеты, доступные локально,
  активируются без ожидания сети.
- `awaitActivation` существует потому, что холодный `Location` активирует
  плагины асинхронно: без ожидания ранний запрос увидит пустой реестр.
- `revision` определяет, «тот же» ли плагин: у `SdkPlugins` это счётчик, у
  `InstancePlugins` — постоянная строка `instance` (список неизменяем после
  создания).
- Из хуков провалиться может только `tool.execute.before`: остальные домены
  объявлены с `never` на канале ошибки.
- `tool-input-repair.ts` чинит вход только при однозначной поддержке схемой,
  глубина ограничена; инструмент `execute` пропускается — внешний Code Mode
  строится на каждый снимок и не регистрируется.
- `verbosity.ts` ставит `textVerbosity: "low"` моделям gpt-6 и gpt-5 с
  известной поддержкой, распознавая префиксы `openai/` и `openai.` у
  gateway- и bedrock-пакетов.
- `optimize.ts`: Anthropic-подсказка дописывается в конец (`append`),
  остальные заменяют системный промпт; агент со своим `system` пропускается.
- `plan.ts`: агент `plan` — read-only, `edit` запрещён везде, кроме
  `~/.opencode/plan`; напоминания о режиме добавляются синтетическим
  сообщением с `resume: false` и сверяются на каждый запрос.
- `warming.ts` пропускает сессии с `parentID`, а собственный прогревочный
  запрос распознаёт по совпадению текста промпта.
- `skill.ts` регистрирует навыки `opencode` и `report`; содержимое report
  дополняется снимком диагностики: версия, канал, ОС, `TERM`, `SHELL` и
  список плагинов из конфига.
- `models-dev.ts` вырезает устаревшие алиасы `azure-cognitive-services` и
  `google-vertex-anthropic`, модели со статусом `deprecated` и список
  `BEDROCK_PROFILE_ONLY_IDS` из каталога amazon-bedrock.
- Git: список команд исполняется из каталога, пофайловые — из корня worktree;
  патчи сначала собираются одним `git diff` в пределах
  `MAX_TOTAL_PATCH_BYTES`, при превышении бюджета файл получает пустой патч.
- Mercurial: `hg diff --git` не показывает неотслеживаемые (`?`) и удалённые
  (`!`) файлы — их патчи синтезируются из содержимого; запрос committed или
  явного base завершается `DiffError`.
- Локальные провайдеры (`ollama`, `lmstudio`, `vllm`) устроены одинаково:
  кэш обнаружения под `Semaphore(1)`, повтор по расписанию, снятие
  интеграции при непустом списке моделей.
- `provider/opencode.ts` получает от Console провайдеров, веб-поиск, MCP и
  политики организации; при отсутствии ключа провайдер включается с
  `apiKey: "public"`, а платные модели выключаются; `withoutCredentials`
  вычищает `apiKey`, `authToken`, `accessToken` из пришедших настроек.

## Связи

- `packages/core/src/plugin.ts` — публичный реестр: `Interface`, `Generation`,
  `Info`, `State`, `Source`. Оттуда приходят типы в `service.ts` и `host.ts`.
- `packages/core/src/config/plugin/source.ts` — операции `add`/`remove`,
  которые применяет `supervisor`.
- `packages/core/src/vcs.ts` и `packages/core/src/vcs/patch.ts` — контракт
  `Adapter`, `DiffError` и бюджеты патчей для `vcs/`.
- Редакторы, в которые пишут плагины: `packages/core/src/provider.ts`,
  `packages/core/src/model.ts`, `packages/core/src/agent.ts`,
  `packages/core/src/command.ts`, `packages/core/src/skill.ts`,
  `packages/core/src/tool.ts`, `packages/core/src/mcp/index.ts`,
  `packages/core/src/websearch.ts`, `packages/core/src/worktree/strategies.ts`.
- `packages/core/src/session/affinity.ts` — стабильный идентификатор сессии
  для заголовков `session-id` и `X-Interaction-Id`.
- `packages/core/src/modal/models.ts`, `packages/core/src/github-copilot/models.ts`
  — снапшоты моделей, которые догружают соответствующие провайдеры.
- Вспомогательные модули: `packages/core/src/effect/keyed-mutex.ts`,
  `packages/core/src/util/iife.ts`, `packages/core/src/util/git-executable.ts`,
  `packages/core/src/tool/http-body.ts`, `packages/core/src/tool/runtime.ts`,
  `packages/core/src/session/system-prompt.ts`.

## Ловушки

- Дубликат `id` валит активацию реестра целиком, вместе со встроенными.
  `supervisor` оставляет первое вхождение в порядке загрузки, а второе
  показывает в `failures` как `Duplicate plugin ID`.
- Ошибка загрузки пакета не выключает уже работавший: поколение, которое не
  загрузилось, не заменяет прежнее — оно остаётся в `packages`/`running`.
- `remove` с целью `"*"` чистит список ошибок, но записи из `guarded`
  отключить нельзя.
- Смена credential перестраивает каталог: `modal`, `digitalocean`, `openai`,
  `chatgpt`, `azure`, `gitlab`, `github-copilot` подписаны на
  `Credential.Event.Switched`.
- GitLab требует ровно `http://127.0.0.1:8080/callback` и публичное
  (не «Confidential») OAuth-приложение; встроенный client ID существует
  только на `gitlab.com`.
- DigitalOcean держит порт 1456, GitLab — 8080, OpenAI — 1455 с откатом на 1457. Порт занят — вход в провайдер не состоится.
- Хуки `identity.ts` и `optimize.ts` глушат свои ошибки (`Effect.catch` к
  пустому эффекту): сбой подсказки не должен ломать запрос.
- Локальные HTTP-провайдеры не убирают модели при обрыве — они сохраняют
  последний успешный список, чтобы доступность не мигала.
- `source-directory.ts` принимает и файлы `.ts`/`.js`, и каталоги, и
  симлинки (проверяя цель через файловую систему), и возвращает список,
  отсортированный по пути: порядок влияет на порядок загрузки.
