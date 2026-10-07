# core — документация по папкам

Каждый файл этой папки раскрывает одну папку `packages/core/src/<folder>`
(или тему корневых файлов `src/*.ts`): назначение, ключевые файлы,
важные детали, связи и ловушки. Факты собраны сплошным чтением исходников.

Обзор всего пакета целиком — в `packages/core/PACKAGE.md`.

## Папки

| Папка | Документ |
| --- | --- |
| account | [account.md](account.md) |
| codemode | [codemode.md](codemode.md) |
| config | [config.md](config.md) |
| credential | [credential.md](credential.md) |
| database | [database.md](database.md) |
| effect | [effect.md](effect.md) |
| environment | [environment.md](environment.md) |
| event | [event.md](event.md) |
| filesystem | [filesystem.md](filesystem.md) |
| formatter | [formatter.md](formatter.md) |
| github-copilot | [github-copilot.md](github-copilot.md) |
| id | [id.md](id.md) |
| image | [image.md](image.md) |
| instance | [instance.md](instance.md) |
| instructions | [instructions.md](instructions.md) |
| integration | [integration.md](integration.md) |
| kv | [kv.md](kv.md) |
| mcp | [mcp.md](mcp.md) |
| modal | [modal.md](modal.md) |
| models-dev | [models-dev.md](models-dev.md) |
| oauth | [oauth.md](oauth.md) |
| permission | [permission.md](permission.md) |
| persistent-pty | [persistent-pty.md](persistent-pty.md) |
| plugin | [plugin.md](plugin.md) |
| project | [project.md](project.md) |
| pty | [pty.md](pty.md) |
| reference | [reference.md](reference.md) |
| ripgrep | [ripgrep.md](ripgrep.md) |
| session | [session.md](session.md) |
| shell | [shell.md](shell.md) |
| skill | [skill.md](skill.md) |
| tool | [tool.md](tool.md) |
| util | [util.md](util.md) |
| v1 | [v1.md](v1.md) |
| vcs | [vcs.md](vcs.md) |
| wellknown | [wellknown.md](wellknown.md) |
| workspace | [workspace.md](workspace.md) |
| worktree | [worktree.md](worktree.md) |

## Корень `src/` (корневые файлы вне папок)

Разбиты на четыре тематических документа:

- [root-models.md](root-models.md) — модели, провайдеры, агенты
  (`aisdk.ts`, `provider.ts`, `model-resolver.ts` и др.);
- [root-runtime.md](root-runtime.md) — шина, RPC, состояние, джобы
  (`bus.ts`, `rpc.ts`, `state.ts`, `job.ts` и др.);
- [root-fs-git.md](root-fs-git.md) — git, файловая система, location,
  shell/pty (`git.ts`, `filesystem.ts`, `location*.ts` и др.);
- [root-config.md](root-config.md) — конфиг, доступы, проекты
  (`config.ts`, `credential.ts`, `permission.ts` и др.).
