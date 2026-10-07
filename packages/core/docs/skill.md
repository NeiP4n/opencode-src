# core/skill — скачивание навыков из внешнего индекса и инструкция о них для модели

## Что в папке

Два файла: `packages/core/src/skill/discovery.ts` — загрузка навыков из
внешнего HTTP-индекса в кэш, и `packages/core/src/skill/instructions.ts` —
инструкция для модели со списком доступных навыков.

## Ключевые файлы

- `packages/core/src/skill/discovery.ts` — сервис `SkillDiscovery`
  (`@opencode/SkillDiscovery`) с единственным методом `pull(url)`:
  возвращает массив абсолютных путей к скачанным навыкам.
- `packages/core/src/skill/instructions.ts` — сервис `SkillInstructions`
  (`@opencode/SkillInstructions`) с `load(permissions)`.
- Схемы в `discovery.ts`: `Index` (`{ skills: [...] }`) и `IndexSkill`
  (`name`, необязательный `version`, `files`).

## Важные детали

- Протокол индекса: по адресу `url` (с приведённым `/` на конце) читается
  `index.json`, у каждого навыка — `files`, у каждого файла — URL
  относительно `<name>/`.
- Навык берётся, только если у него есть `SKILL.md` либо `<name>.md`.
  Оба варианта проверяются и при скачивании, и в готовом каталоге.
- Каталог навыка: `path.resolve(global.cache, "skills", Hash.fast(base))`,
  то есть подкаталог кэша, названный хешем адреса индекса, и внутри него
  каталог навыка.
- Проверки безопасности путей многослойные и срабатывают **до** скачивания:
  `isSafeSegment` для имени, `isSafeRelativePath` для каждого файла,
  `FSUtil.contains` для каталога, совпадение `resource.origin === source.origin`
  для URL. Любой провал отбрасывает навык целиком.
- `isSafeRelativePath` отсекает `\` и `\0`, `?`, `#`, абсолютные пути в
  posix и win32, URL-подобные строки, и каждый сегмент проверяется после
  `decodeURIComponent` — нераспарсенный процент даёт отказ.
- Файлы одного навыка качаются параллельно, константа `fileConcurrency`
  равна 8; навыки обрабатываются параллельно, `skillConcurrency` равна 4.
- HTTP-клиент перенастроен: повтор транзиентных ошибок два раза по
  экспоненциальному расписанию с джиттером (база 200 мс) и фильтр
  не-2xx ответов.
- Скачивание каждого файла идемпотентно: если цель уже существует,
  `download` ничего не делает и возвращает `true`.
- Обновление безопасно заменяет каталог. Если версия навыка задана и не
  совпадает с содержимым `.opencode-version`, файлы качаются в
  `staging` = `<root>.tmp-<uuid>`, наличие манифеста проверяется, пишется
  новая версия, затем старый каталог уезжает в `backup` = `<root>.old-<uuid>`,
  staging переименовывается на место, а backup удаляется.
- Замена каталога обёрнута в `Effect.uninterruptible`, а ошибка переименования
  откатывает `backup` обратно на место.
- Любой сбой при обновлении логируется и **не** прерывает: в staging
  остаётся нетронутым, а `ensuring` удаляет его рекурсивно.
- `instructions.ts` показывает навык, только если у него есть `description`
  и `autoinvoke` не равен `false`.
- Перед выводом навыки фильтруются по правам: `Skill.available(list, permissions)`,
  куда передаётся объединённый ruleset агента и сессии.
- Ключ инструкции — `core/skill-guidance`; сортировка по `id`.
- Инструкция прямо говорит модели: скилл, уже пришедший блоком
  `<skill_content>` в переписке, вызывать повторно не нужно.

## Связи

- `packages/core/src/skill.ts` — соседний файл корня `src`: сервис
  `Skill.Service` со списком скиллов, типы `Skill.ID`, `Skill.Name` и
  функция `Skill.available`.
- `packages/core/src/instructions/index.ts` — `Instructions.make`,
  `Key`, `diffByKey`, `removed`; движок дельт.
- `packages/core/src/permission.ts` — тип `Permission.Ruleset`, который
  фильтрует список навыков.
- `@opencode/util/fs-util` — `exists`, `readFileStringSafe`, `writeWithDirs`,
  `writeFileString`, `rename`, `remove`, `contains`.
- `@opencode/util/hash` — `Hash.fast` для имени каталога в кэше.
- `effect/unstable/http` — клиент, повторы и `schemaBodyJson` для разбора
  `index.json`.
- `@opencode/util/effect/app-node` — `makeGlobalNode` для discovery и
  `makeLocationNode` для инструкции.

## Ловушки

- `SkillInstructions` создан через `makeLocationNode`, а `SkillDiscovery` —
  через `makeGlobalNode`: первый пересобирается на локацию, второй общий.
- `pull` возвращает только те навыки, у которых после скачивания нашёлся
  манифест. Навык без файлов в индексе молча выпадает из результата.
- Отсутствие `version` у навыка означает, что апдейт не проверяется: файлы
  просто докачиваются поверх, `.opencode-version` не пишется.
- `Hash.fast` от адреса индекса, а не от навыка: смена адреса сбрасывает
  весь кэш навыков для этого индекса.
- Фильтр по `autoinvoke === false` сравнивает строго: скилл без поля
  `autoinvoke` попадает в инструкцию, если описания достаточно.
- Сравнение прав в `load` происходит на стороне вызывающего: если передать
  не тот ruleset, в инструкцию попадут навыки, которые агент вызвать не
  сможет.
