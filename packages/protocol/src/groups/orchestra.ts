import { Orchestra } from "@opencode/schema/orchestra"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ProjectNotFoundError, SessionNotFoundError } from "../errors.js"

const root = "/api/orchestra/project"

export const OrchestraGroup = HttpApiGroup.make("server.orchestra")
  .add(
    HttpApiEndpoint.get("orchestra.project.list", root, {
      success: Schema.Array(Orchestra.Project),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.project.list",
        summary: "List projects",
        description: "List the projects the operator created, oldest first.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("orchestra.template.list", "/api/orchestra/template", {
      success: Schema.Array(Orchestra.Template),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.template.list",
        summary: "List team templates",
        description: "Ready-made AI teams a project can be created with: the role sessions each one opens.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("orchestra.project.create", root, {
      payload: Schema.Struct({
        name: Schema.String,
        directory: Schema.String,
        template: Schema.String.pipe(Schema.optional),
      }),
      success: Orchestra.Project,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.project.create",
        summary: "Create project",
        description:
          "Create a named project for an existing directory; its sessions are those opened in or below it. With a template, also open the main session and one session per team member.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("orchestra.project.update", `${root}/:projectID`, {
      params: { projectID: Orchestra.ProjectID },
      payload: Schema.Struct({
        name: Schema.String.pipe(Schema.optional),
        directory: Schema.String.pipe(Schema.optional),
      }),
      success: Orchestra.Project,
      error: [ProjectNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.project.update",
        summary: "Update project",
        description: "Rename a project or point it at another directory.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("orchestra.project.remove", `${root}/:projectID`, {
      params: { projectID: Orchestra.ProjectID },
      success: HttpApiSchema.NoContent,
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.project.remove",
        summary: "Remove project",
        description: "Forget a project. Its sessions, including its main session, are kept.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("orchestra.project.main", `${root}/:projectID/main`, {
      params: { projectID: Orchestra.ProjectID },
      success: Session.Info,
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.project.main",
        summary: "Open project main session",
        description: "Return the project's main session, creating it in the project directory on first use.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("orchestra.project.sessions", `${root}/:projectID/session`, {
      params: { projectID: Orchestra.ProjectID },
      success: Schema.Struct({
        data: Schema.Array(Session.Info),
        access: Schema.Record(Schema.String, Orchestra.Access),
      }),
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.project.sessions",
        summary: "List project sessions",
        description: "Recent top-level sessions in the project directory and the main session's access to each.",
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
  .annotateMerge(OpenApi.annotations({ title: "orchestra", description: "Operator projects and their main sessions." }))
