import { Orchestra } from "@opencode/schema/orchestra"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ProjectNotFoundError, SessionNotFoundError } from "../errors.js"

export const OrchestraGroup = HttpApiGroup.make("server.orchestra")
  .add(
    HttpApiEndpoint.get("orchestra.get", "/api/orchestra/:projectID", {
      params: { projectID: Project.ID },
      success: Orchestra.State,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.get",
        summary: "Get project orchestra",
        description: "The project's main session, if opened, and the access it has to each session of the project.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("orchestra.main", "/api/orchestra/:projectID/main", {
      params: { projectID: Project.ID },
      success: Session.Info,
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.main",
        summary: "Open project main session",
        description: "Return the project's main session, creating it in the project directory on first use.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("orchestra.access", "/api/orchestra/access/:sessionID", {
      params: { sessionID: Session.ID },
      payload: Schema.Struct({ access: Orchestra.Access }),
      success: HttpApiSchema.NoContent,
      error: SessionNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.access",
        summary: "Set session access",
        description: "Set what the project's main session may do with this session.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "orchestra", description: "Project main sessions and their access." }))
