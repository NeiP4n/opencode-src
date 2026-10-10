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

function badTemplate(error: Orchestra.TemplateNotFoundError) {
  return Effect.fail(
    new InvalidRequestError({ message: `Unknown team template: ${error.template}`, field: "template" }),
  )
}

function badDirectory(error: Orchestra.DirectoryError) {
  return Effect.fail(
    new InvalidRequestError({ message: `Not an existing directory: ${error.directory}`, field: "directory" }),
  )
}

function badTeam(error: Orchestra.TeamError) {
  return Effect.fail(new InvalidRequestError({ message: error.message, field: error.field }))
}

export const OrchestraHandler = HttpApiBuilder.group(Api, "server.orchestra", (handlers) =>
  Effect.gen(function* () {
    const orchestra = yield* Orchestra.Service
    const sessions = yield* Session.Service

    return handlers
      .handle("orchestra.project.list", () => orchestra.projects())
      .handle("orchestra.template.list", () => orchestra.templates())
      .handle("orchestra.template.create", (ctx) =>
        orchestra.saveTemplate(undefined, ctx.payload).pipe(Effect.catchTag("Orchestra.TeamError", badTeam)),
      )
      .handle("orchestra.template.update", (ctx) =>
        orchestra
          .saveTemplate(ctx.params.templateID, ctx.payload)
          .pipe(Effect.catchTag("Orchestra.TeamError", badTeam)),
      )
      .handle(
        "orchestra.template.remove",
        Effect.fn(function* (ctx) {
          yield* orchestra.removeTemplate(ctx.params.templateID).pipe(Effect.catchTag("Orchestra.TeamError", badTeam))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("orchestra.role.list", () => orchestra.roles())
      .handle("orchestra.role.create", (ctx) =>
        orchestra.saveRole(undefined, ctx.payload).pipe(Effect.catchTag("Orchestra.TeamError", badTeam)),
      )
      .handle("orchestra.role.update", (ctx) =>
        orchestra.saveRole(ctx.params.roleID, ctx.payload).pipe(Effect.catchTag("Orchestra.TeamError", badTeam)),
      )
      .handle(
        "orchestra.role.remove",
        Effect.fn(function* (ctx) {
          yield* orchestra.removeRole(ctx.params.roleID).pipe(Effect.catchTag("Orchestra.TeamError", badTeam))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("orchestra.project.create", (ctx) =>
        orchestra
          .create(ctx.payload)
          .pipe(
            Effect.catchTag("Orchestra.DirectoryError", badDirectory),
            Effect.catchTag("Orchestra.TemplateNotFoundError", badTemplate),
          ),
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
          const ids = data.map((session) => session.id)
          return { data, access: yield* orchestra.accessMany(ids), category: yield* orchestra.categories(ids) }
        }),
      )
      .handle("orchestra.owner.list", () => orchestra.owners())
      .handle(
        "orchestra.owner.set",
        Effect.fn(function* (ctx) {
          yield* sessions.get(ctx.params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          yield* orchestra
            .claim(ctx.params.sessionID, ctx.payload.projectID)
            .pipe(Effect.catchTag("Orchestra.ProjectNotFoundError", missingProject))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "orchestra.category",
        Effect.fn(function* (ctx) {
          yield* sessions.get(ctx.params.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          yield* orchestra.setCategory(ctx.params.sessionID, ctx.payload.category)
          return HttpApiSchema.NoContent.make()
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
