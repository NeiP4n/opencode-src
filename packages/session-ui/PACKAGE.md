# @opencode/session-ui — session page components

## What This Is

The web part of the session UI: 113 files, ~24 thousand lines in `src/`. Solid
components for rendering a run: the message feed, tool rendering,
diffs, Markdown, the timeline, line-level discussions.

The package does not run on its own — `app`, `gui-extensions`, and
`enterprise` bundle it into themselves.

## Layers and Dependencies

Layer **L5**: depends on `client`, `ui`, `util`.

Who depends on it:

- `packages/app` — the main application;
- `packages/gui-extensions` — UI extensions;
- `packages/enterprise` — the corporate surface.

Export map (`packages/session-ui/package.json`) — separate parts:

```json
"./actions": "./src/actions.ts",
"./document": "./src/document.ts",
"./message": "./src/message/current-message.tsx",
"./timeline": "./src/timeline/session-timeline.tsx",
"./timeline/projection": "./src/timeline/projection.ts",
"./basic-tool": "./src/components/basic-tool.tsx"
```

## Subsystems and Files

**Session feed** — the `packages/session-ui/src/timeline/` directory:
`session-timeline.tsx` (the feed), `session-timeline-row.tsx` (a row),
`projection.ts` (projection of events into rows), `detail.ts`,
`timeline-row.ts`, plus `*.stories.tsx` and `projection.test.ts`.

**Messages** — the `packages/session-ui/src/message/` directory:
`current-message.tsx` (the current message), `message-content.tsx`,
`attachment-card.tsx`, `comment-card.tsx`,
`current-tool-state.ts` (plus a test).

**Tools** — the `packages/session-ui/src/tools/` directory:
`tool-renderer.tsx` (rendering a tool call), `shell-output.ts`
(command output), and `*.stories.tsx`.

**Components** — the `packages/session-ui/src/components/` directory:
`file.tsx`, `file-search.tsx`, `file-media.tsx`, `image-preview.tsx`,
`line-comment.tsx` (plus `line-comment-annotations.tsx`,
`line-comment-styles.ts`), `markdown-cache.tsx`,
`markdown-code-state.ts`, `markdown-image.ts`, `apply-patch-file.ts`,
`dock-prompt.tsx`, `basic-tool.tsx`, `file-ssr.tsx`.

**Diffs** — the `packages/session-ui/src/pierre/` directory (integration with
`@pierre/diffs`): `commented-lines.ts`, `comment-hover.ts`,
`diff-selection.ts`, `file-find.ts`, `file-runtime.ts`,
`file-selection.ts`, `media.ts`, `selection-bridge.ts`, `virtualizer.ts`,
`worker.ts`, `index.ts`.

**Context** — the `packages/session-ui/src/context/` directory (including
`data.tsx`, `markdown.tsx`, `index.ts`).

**Misc** — `actions.ts`, `document.ts`, `file-presentation.ts` and the
`packages/session-ui/src/v2/` directory (the new version of the review panels:
`session-review-v2.tsx`, `session-file-panel-v2.tsx`,
`session-progress-indicator-v2.tsx`), `storybook/` (scenario fixtures).

## Entry Points

1. `packages/session-ui/src/timeline/session-timeline.tsx` (the `./timeline`
   export) — the feed the session page starts with.
2. `packages/session-ui/src/message/current-message.tsx` (the `./message`
   export) — rendering of a single message.
3. `packages/session-ui/src/actions.ts` (the `./actions` export) — user
   actions from the UI.
4. `packages/session-ui/src/timeline/projection.ts` (the `./timeline/projection`
   export) — turning events into feed rows.

## Where to Look Next

- `packages/app/PACKAGE.md` — the application the components are bundled into.
- `packages/ui/PACKAGE.md` — the base components (buttons, dialogs)
  that `session-ui` is built from.
- `packages/client/PACKAGE.md` — the `./solid` variant the data comes from.
- `packages/gui-extensions/PACKAGE.md` — the second build surface.

## Pitfalls

1. **There is no root export.** Only separate paths (`./timeline`,
   `./message`, `./actions`); importing `@opencode/session-ui` does not work.
2. **`v2/` is neither junk nor the only option.** The old and new review panels
   coexist; when making a change, check both branches.
3. **`pierre/` is a wrapper around the third-party library `@pierre/diffs`**
   from the `packages/ui` dependencies: its worker and virtualizer live here,
   while the diff rendering lives there.
4. **Stories and tests live in `src/`** (`*.stories.tsx`, `*.test.ts`),
   so the package has more lines than "visible" code.
5. **`file-ssr.tsx` is the server-rendering variant**, do not confuse it with
   `file.tsx`: they have different premises (DOM present/absent).
