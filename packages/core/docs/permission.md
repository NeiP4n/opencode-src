# core/permission — saved user permissions by projects

## What's In This Folder

- `sql.ts` — the `permission` table with a unique index over the triple project+action+resource.
- `saved.ts` — the Effect service `PermissionSaved`: listing, adding and removing saved permissions.

## Key Files

- `packages/core/src/permission/saved.ts` — `Service`, `layer`, `node`, the input schemas `ListInput`, `AddInput`.
- `packages/core/src/permission/sql.ts` — `PermissionTable`.

## Important Details

- The `permission` table: `id` (of type `PermissionSaved.ID` from `packages/schema/src/permission-saved.ts`), `project_id` — `.notNull()` with a reference to `ProjectTable.id` and `onDelete: "cascade"`, `action`, `resource`, plus `Timestamps`.
- The unique index `permission_project_action_resource_idx` on `(project_id, action, resource)` is exactly the semantics of "save a permission": a repeated save of the same triple does not create a second row.
- `add` makes one row per element of `input.resources` and finishes the insert via `.onConflictDoNothing()`. Two properties follow from this: an empty array of resources gives an empty insert (there is an early exit in the code), and a conflict on the unique index is swallowed without an error.
- Each row gets its own `ID.create()`, and not one common ID per call: a saved permission can be removed by the ID of a specific resource.
- `remove(id)` removes strictly one row by `id` — an operation without a check of the project and the action.
- `list` without `projectID` returns all the rows of the table: the `where` condition is substituted only when `projectID` is set. Selecting by one project is already a filter, and not a requirement.
- All queries end with `.pipe(Effect.orDie)`: a database error turns into a defect and not into a typed failure, so the caller has no branch for "could not read".
- The service is assembled via `makeGlobalNode({ service, layer, deps: [Database.node] })` — a global node living for the whole application, in contrast to the location-scoped nodes.
- `ID` and `Info` in the module are not its own: they are re-exports from `packages/schema/src/permission-saved.ts`.

## Connections

- `packages/core/src/permission/sql.ts` — imports `ProjectTable` from `packages/core/src/project/sql.ts` for the foreign key and `Project.ID` from `packages/schema/src/project.ts`.
- `packages/core/src/permission.ts` — the root module: the live permission checking engine. A search for `PermissionTable` gives only `saved.ts` and `sql.ts` itself, that is, the table is read by the saved-permissions service, and not by the checking engine.
- `packages/core/src/database/database.ts` — the `Database` service handing out the connection that `layer` uses.
- `packages/core/src/config/plugin/agent.ts` — brings the agent permission rules from the config to the form of `Permission.Ruleset`, that is, to the form that this service stores.

## Pitfalls

- `list` without `projectID` reads the whole table, and not "the current project". The filter has to be set explicitly.
- An insert conflict is not visible to the caller: `onConflictDoNothing` turns a repeated save into silence. You can check that a permission was saved only with a subsequent `list`.
- `remove` does not check the project: an ID obtained from another source will remove a row of someone else's project.
- The early exit in `add` on an empty `resources` means that a call without resources creates no record and does not report it.
- `Effect.orDie` on all operations: an unavailable database is a process defect, and not a failure that the caller could have handled.