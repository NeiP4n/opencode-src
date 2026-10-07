# @opencode/function — серверная функция share и GitHub App

## Что это

Облачная функция на Cloudflare Workers: 2 файла, ~400 строк в `src/`. Пакет
не входит в бинарник CLI и не импортируется ни одним пакетом `@opencode/*` —
это бэкенд веб-части opencode: публикация сессий (share) и обмен токенами
GitHub App.

Пакет `private: true`, в npm не публикуется. Зависимости: `hono` (роутер),
`jose` (JWT), `@octokit/rest` и `@octokit/auth-app` (GitHub), `sst`
(переменные окружения инфраструктуры).

## Слои и зависимости

Слой **L0 — лист**: от других пакетов `@opencode/*` не зависит. С ядром
связан только по формату данных: сессии, которые он раздаёт, приходят с
сервера opencode в том же виде.

Потребителей в `packages/*/src` нет — пакет деплоится отдельно и работает
с клиентом по HTTP/WebSocket.

## Подсистемы и файлы

**`packages/function/src/api.ts`** — вся серверная логика, Hono-приложение
(`export default new Hono<...>()`, строка 117) и Durable Object `SyncServer`:

- `SyncServer` — состояние одной публикуемой сессии. При подключении отдаёт
  сохранённые ключи `session/*` через WebSocket, метод `publish(key, content)`
  проверяет, что ключ принадлежит текущей сессии (`session/info/<id>`,
  `session/message/<id>/`, `session/part/<id>/`), кладёт JSON в R2-бакет
  (`share/<key>.json`) и в память объекта, затем рассылает всем подписчикам.
- `share(sessionID)` — выдаёт секрет публикации (первый раз — `randomUUID`,
  дальше возвращает сохранённый); `assertSecret(secret)` сверяет его.
- `clear()` — удаляет из бакета все сообщения сессии и память объекта.
- `static shortName(id)` — короткое имя ссылки.
- Ручки обмена токенами GitHub: `POST /exchange_github_app_token`
  (по установке приложения), `POST /exchange_github_app_token_with_pat`
  (для `opencode github run` локально, дополнительно проверяет права
  `admin|push|maintain` у репозитория), `GET /get_github_app_installation`
  (проверка, установлено ли приложение).

**`packages/function/src/github.ts`** — `parseRepositoryClaim(payload)`:
достаёт и проверяет claim `repository` из JWT (`jose`), без него — ошибка.

## Точки входа

1. `packages/function/src/api.ts` → `export default` — Hono-роутер, который
   разворачивает Cloudflare Worker.
2. `packages/function/src/github.ts` → `parseRepositoryClaim` — единственная
   функция файла, используется внутри `api.ts`.
3. Внешних импортёров в `packages/*/src` нет: точка входа — сам деплой.

## На что смотреть дальше

- `packages/cli/PACKAGE.md` — команды, которые ходят в этот бэкенд
  (`opencode github run`, share-ссылки).
- `packages/core/PACKAGE.md` — сессии и сообщения, формат которых хранится
  в бакете.
- `packages/schema/PACKAGE.md` — типы данных, общие для сервера и клиента.

## Ловушки

1. **`Resource.GITHUB_APP_ID` и `Resource.GITHUB_APP_PRIVATE_KEY` берутся из
   `sst`** — без развёрнутой инфраструктуры функция падает на первом же
   обращении к GitHub.
2. **Приватный ключ в ручке `/exchange_github_app_token_with_pat`** передаётся
   через `Authorization: Bearer <PAT>`; ошибки авторизации отвечают статусом
   401, ошибки обмена — 502.
3. **`publish` молча отбрасывает чужие ключи**, возвращая `400` — но только
   когда проверка ключа не прошла; сама рассылка идёт всем WebSocket-подписчикам
   объекта без проверки секрета на этом этапе.
4. **`webSocketMessage` пустой** — клиент ничего не отправляет в объект,
   канал односторонний; вход только через HTTP-ручки.
