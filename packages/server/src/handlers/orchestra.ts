import { Orchestra } from "@opencode/core/orchestra"
import { Session } from "@opencode/core/session"
import { InvalidRequestError, ProjectNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { missingSession } from "./session-error"

function missingProject(error: Orchestra.ProjectNotFoundError) {
  return Effect.fail(
    new ProjectNotFoundError({ projectID: error.projectID, message: `Project not found: ${error.projectID}` }),
  )
}

function badDirectory(error: Orchestra.DirectoryError) {
  return Effect.fail(
    new InvalidRequestError({ message: `Not an existing directory: ${error.directory}`, field: "directory" }),
  )
}

export const OrchestraHandler = HttpApiBuilder.group(Api, "server.orchestra", (handlers) =>
  Effect.gen(function* () {
    const orchestra = yield* Orchestra.Service
    const sessions = yield* Session.Service

    return handlers
      .handle("orchestra.project.list", () => orchestra.projects())
      .handle("orchestra.project.create", (ctx) =>
        orchestra.create(ctx.payload).pipe(Effect.catchTag("Orchestra.DirectoryError", badDirectory)),
      )
      .handle("orchestra.project.update", (ctx) =>
        orchestra
          .update(ctx.params.projectID, ctx.payload)
          .pipe(
            Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject),
            Effect.catchTag("Orchestra.DirectoryError", badDirectory),
          ),
      )
      .handle(
        "orchestra.project.remove",
        Effect.fn(function* (ctx) {
          yield* orchestra
            .remove(ctx.params.projectID)
            .pipe(Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("orchestra.project.main", (ctx) =>
        orchestra.main(ctx.params.projectID).pipe(Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject)),
      )
      .handle(
        "orchestra.project.sessions",
        Effect.fn(function* (ctx) {
          const data = yield* orchestra
            .sessions(ctx.params.projectID)
            .pipe(Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject))
          return { data, access: yield* orchestra.accessMany(data.map((session) => session.id)) }
        }),
      )
      .handle(
        "orchestra.access",
        Effect.fn(function* (ctx) {
          yield* sessions.get(ctx.params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          yield* orchestra.setAccess(ctx.params.sessionID, ctx.payload.access)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
