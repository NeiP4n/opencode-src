# core/oauth — ready HTML pages for local OAuth callback servers

## What's In This Folder

- `page.ts` — the only file: three functions returning a self-contained HTML document without external resources.
- There is neither an HTTP server nor a token exchange in the folder: this is only the layout of the result, which any transport hands over.

## Key Files

- `packages/core/src/oauth/page.ts` — `success`, `error`, `bootstrap`, the types `CallbackPageOptions` and `BootstrapOptions`.

## Important Details

- `success(options)` and `error(detail, options)` draw a finished card. Success by default adds `AUTO_CLOSE_SCRIPT`: `window.close()` after 2500 ms inside a `try/catch`, because browsers do not allow the window-closing script to every page. It is switched off with the flag `autoClose: false`.
- `bootstrap(options)` — the implicit grant script, for when the token arrives in the fragment of the URL. The embedded script reads `window.location.hash` and `window.location.search`, takes `error`/`error_description` or `access_token`/`expires_in`/`state`, sends this as a POST to `tokenPath` (a path relative to the current origin) and only then, based on the server response, switches the card to success or error.
- The server response is taken literally: a non-2xx turns into an error with the response body as `detail`, and `res.ok` with an `error` in the body still leads to `fail(...)`.
- The escaping is two-level. `escapeHtml` closes `&`, `<`, `>`, quotes and apostrophes and is applied to `headline`, `message`, `footnote`, `detail` and `<title>`. `scriptString` additionally replaces `<` with `\u003c` after `JSON.stringify` — that is not protection from XSS, but a way not to let the provider's value close the `script` tag.
- The `provider` value is substituted into the already escaped `message` string before `renderCard`, but inside `bootstrapScript` it goes through `scriptString` — two different paths for one and the same value.
- The card is the same for the three states: the `data-status` attribute on `#oc-card` decides which of the three icons (`ICON_SPINNER`, `ICON_CHECK`, `ICON_CROSS`) is shown. The bootstrap script changes this attribute in place, without a reload of the page.
- The design is set by a set of CSS variables `--oc-*` in two blocks, `LIGHT_VARS` and `DARK_VARS`. The dark theme is enabled both via `prefers-color-scheme` and forcibly via `:root[data-theme="dark"]`, so the host can set the scheme with a selector without changing the default values.
- `@media (prefers-reduced-motion: reduce)` switches off the spinner animation.
- The embedded SVG wordmark `WORDMARK` repeats the geometry from `packages/ui/src/components/logo.tsx`, and the set of tokens is a subset of `packages/ui/src/styles/theme.css`. This is stated by a comment at the top of the file: when the brand style changes, both there and here have to be edited.
- The document is marked `noindex` and `lang="en"`, regardless of the language of the message.

## Connections

- `packages/core/src/mcp/oauth.ts` — one of the consumers: the page for the OAuth exchange of the MCP server.
- `packages/core/src/plugin/provider/chatgpt.ts`, `packages/core/src/plugin/provider/digitalocean.ts`, `packages/core/src/plugin/provider/gitlab.ts`, `packages/core/src/plugin/provider/openai.ts`, `packages/core/src/plugin/provider/poe.ts`, `packages/core/src/plugin/provider/snowflake-cortex.ts` — the other consumers (found by searching for `OauthCallbackPage`).
- `packages/ui/src/components/logo.tsx` and `packages/ui/src/styles/theme.css` — the sources of the logo geometry and the token values.
- `packages/core/docs/credential.md` — the place where the result of the exchange settles: the tokens of the integrations.

## Pitfalls

- `error(detail, ...)` does not escape `detail` by itself — that is done by `renderCard`. Any new call must pass the detail so that it ends up in the markup exactly through this path.
- The fragment, and not the query: in `bootstrapScript` the `hash` value is taken by the slice `.slice(1)`, and if the provider returned the parameters in the query and not in the fragment, the handler will find them too — but only because it reads both sources.
- The page stores nothing and writes nothing by itself: without a `bootstrap` call the token from the fragment will stay in the browser's address bar. For flows with PKCE or an authorization code this scenario does not fit.
- Autoclosing of the window after 2.5 seconds is not a guarantee: the closing script triggers only for pages opened by a script. `autoClose: false` is needed where the user must have time to read the result.
- The dark theme is not picked up automatically at `data-theme="light"` on a host without support for `prefers-color-scheme` — the selector `:root:not([data-theme="light"])` inside the media query keeps the light scheme as the default.