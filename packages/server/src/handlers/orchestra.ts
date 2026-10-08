import { Orchestra } from "@opencode/core/orchestra"
import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { ProjectNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { missingSession } from "./session-error"

export const OrchestraHandler = HttpApiBuilder.group(Api, "server.orchestra", (handlers) =>
  Effect.gen(function* () {
    const orchestra = yield* Orchestra.Service
    const sessions = yield* Session.Service

    return handlers
      .handle("orchestra.get", (ctx) => orchestra.state(ctx.params.projectID))
      .handle(
        "orchestra.main",
        Effect.fn(function* (ctx) {
          const projects = yield* Project.Service
          const project = (yield* projects.list()).find((item) => item.id === ctx.params.projectID)
          if (!project)
            return yield* new ProjectNotFoundError({
              projectID: ctx.params.projectID,
              message: `Project not found: ${ctx.params.projectID}`,
            })
          return yield* orchestra.main(project)
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
