# core/oauth — готовые HTML-страницы для локальных callback-серверов OAuth

## Что в папке

- `page.ts` — единственный файл: три функции, возвращающие самодостаточный HTML-документ без внешних ресурсов.
- Ни HTTP-сервера, ни обмена токенами в папке нет: это только вёрстка результата, которую отдаёт любой транспорт.

## Ключевые файлы

- `packages/core/src/oauth/page.ts` — `success`, `error`, `bootstrap`, типы `CallbackPageOptions` и `BootstrapOptions`.

## Важные детали

- `success(options)` и `error(detail, options)` рисуют终 готовую карточку. Успех по умолчанию добавляет `AUTO_CLOSE_SCRIPT`: `window.close()` через 2500 мс в `try/catch`, потому что скрипт закрытия окна браузеры разрешают не всем страницам. Отключается флагом `autoClose: false`.
- `bootstrap(options)` — сценарий неявного гранта, когда токен приходит во фрагменте URL. Встраиваемый скрипт читает `window.location.hash` и `window.location.search`, достаёт `error`/`error_description` либо `access_token`/`expires_in`/`state`, отправляет это POST-ом на `tokenPath` (путь относительно текущего origin) и уже по ответу сервера переключает карточку в success или error.
- Ответ сервера трактуется буквально: не-2xx превращается в ошибку с телом ответа как `detail`, а `res.ok` при наличии `error` в теле всё равно ведёт к `fail(...)`.
- Экранирование двухуровневое. `escapeHtml` закрывает `&`, `<`, `>`, кавычки и апострофы и применяется к `headline`, `message`, `footnote`, `detail` и `<title>`. `scriptString` дополнительно заменяет `<` на `\u003c` после `JSON.stringify` — это не защита от XSS, а способ не дать значению провайдера закрыть тег `script`.
- Значение `provider` подставляется в уже экранированную строку `message` до `renderCard`, но внутри `bootstrapScript` идёт через `scriptString` — два разных пути для одного и того же значения.
- Карточка одна и та же для трёх состояний: атрибут `data-status` на `#oc-card` решает, какая из трёх иконок (`ICON_SPINNER`, `ICON_CHECK`, `ICON_CROSS`) показывается. Скрипт bootstrap меняет этот атрибут на месте, без перезагрузки страницы.
- Оформление задаётся набором CSS-переменных `--oc-*` в двух блоках, `LIGHT_VARS` и `DARK_VARS`. Тёмная тема включается и через `prefers-color-scheme`, и принудительно через `:root[data-theme="dark"]`, поэтому хост может задать схему селектором, не меняя значения по умолчанию.
- `@media (prefers-reduced-motion: reduce)` отключает анимацию спиннера.
- Встроенный SVG-логотип `WORDMARK` повторяет геометрию из `packages/ui/src/components/logo.tsx`, а набор токенов — подмножество `packages/ui/src/styles/theme.css`. Это заявлено комментарием в шапке файла: при смене фирменного стиля править нужно и там, и здесь.
- Документ помечается `noindex` и `lang="en"`, независимо от языка сообщения.

## Связи

- `packages/core/src/mcp/oauth.ts` — один из потребителей: страница для OAuth-обмена MCP-сервера.
- `packages/core/src/plugin/provider/chatgpt.ts`, `packages/core/src/plugin/provider/digitalocean.ts`, `packages/core/src/plugin/provider/gitlab.ts`, `packages/core/src/plugin/provider/openai.ts`, `packages/core/src/plugin/provider/poe.ts`, `packages/core/src/plugin/provider/snowflake-cortex.ts` — остальные потребители (найдены поиском по `OauthCallbackPage`).
- `packages/ui/src/components/logo.tsx` и `packages/ui/src/styles/theme.css` — источники геометрии логотипа и значений токенов.
- `packages/core/docs/credential.md` — место, где оседает результат обмена: токены интеграций.

## Ловушки

- `error(detail, ...)` не экранирует `detail` сам по себе — это делает `renderCard`. Любой новый вызов обязан передавать деталь так, чтобы она оказалась в разметке именно через этот путь.
- Фрагмент, а не query: в `bootstrapScript` значение `hash` берётся срезом `.slice(1)`, и если провайдер вернул параметры в query, а не во фрагменте, обработчик их тоже найдёт — но только потому, что читает оба источника.
- Страница ничего не хранит и никуда не пишет сама: без вызова `bootstrap` токен из фрагмента останется в адресной строке браузера. Для потоков с PKCE или кодом авторизации этот сценарий не подходит.
- Автозакрытие окна через 2.5 секунды — не гарантия: скрипт закрытия срабатывает только для страниц, открытых скриптом. `autoClose: false` нужен там, где пользователь должен успеть прочитать результат.
- Тёмная тема не подхватывается автоматически при `data-theme="light"` на хосте без поддержки `prefers-color-scheme` — селектор `:root:not([data-theme="light"])` внутри медиазапроса оставляет светлую схему по умолчанию.
