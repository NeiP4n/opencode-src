# core — folder documentation

Every file in this folder covers one folder of `packages/core/src/<folder>`
(or a topic of the root files `src/*.ts`): purpose, key files,
important details, connections and pitfalls. The facts were gathered by reading the sources end to end.

An overview of the whole package is in `packages/core/PACKAGE.md`.

## Folders

| Folder | Document |
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

## The `src/` Root (root files outside folders)

Split into four topical documents:

- [root-models.md](root-models.md) — models, providers, agents
  (`aisdk.ts`, `provider.ts`, `model-resolver.ts` and others);
- [root-runtime.md](root-runtime.md) — bus, RPC, state, jobs
  (`bus.ts`, `rpc.ts`, `state.ts`, `job.ts` and others);
- [root-fs-git.md](root-fs-git.md) — git, filesystem, location,
  shell/pty (`git.ts`, `filesystem.ts`, `location*.ts` and others);
- [root-config.md](root-config.md) — config, access rights, projects
  (`config.ts`, `credential.ts`, `permission.ts` and others).
