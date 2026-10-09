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
    HttpApiEndpoint.post("orchestra.template.create", "/api/orchestra/template", {
      payload: Orchestra.TemplateSpec,
      success: Orchestra.Template,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.template.create",
        summary: "Create team template",
        description: "Add the operator's own team: a name and the role sessions it opens.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("orchestra.template.update", "/api/orchestra/template/:templateID", {
      params: { templateID: Schema.String },
      payload: Orchestra.TemplateSpec,
      success: Orchestra.Template,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.template.update",
        summary: "Update team template",
        description: "Replace a team template, built-in or the operator's own.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("orchestra.template.remove", "/api/orchestra/template/:templateID", {
      params: { templateID: Schema.String },
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.template.remove",
        summary: "Remove team template",
        description: "Delete the operator's own team template, or restore a built-in one to its default.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("orchestra.role.list", "/api/orchestra/role", {
      success: Schema.Array(Orchestra.Role),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.role.list",
        summary: "List team roles",
        description: "The roles team sessions run: built-in ones with the operator's edits, then the operator's own.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("orchestra.role.create", "/api/orchestra/role", {
      payload: Orchestra.RoleSpec,
      success: Orchestra.Role,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.role.create",
        summary: "Create team role",
        description: "Add the operator's own role; its sessions run the team-<id> agent with the role's rules.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("orchestra.role.update", "/api/orchestra/role/:roleID", {
      params: { roleID: Schema.String },
      payload: Orchestra.RoleSpec,
      success: Orchestra.Role,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.role.update",
        summary: "Update team role",
        description: "Replace a role, built-in or the operator's own.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("orchestra.role.remove", "/api/orchestra/role/:roleID", {
      params: { roleID: Schema.String },
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.role.remove",
        summary: "Remove team role",
        description:
          "Delete the operator's own role, unless a team template still uses it, or restore a built-in one to its default.",
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
        category: Schema.Record(Schema.String, Schema.String),
      }),
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.project.sessions",
        summary: "List project sessions",
        description:
          "Recent top-level sessions in the project directory, the main session's access to each and the categories they are grouped under.",
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
  .add(
    HttpApiEndpoint.put("orchestra.category", "/api/orchestra/category/:sessionID", {
      params: { sessionID: Session.ID },
      payload: Schema.Struct({ category: Schema.String }),
      success: HttpApiSchema.NoContent,
      error: SessionNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "orchestra.category",
        summary: "Set session category",
        description: "Group a project session under a category; an empty category removes it.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "orchestra", description: "Operator projects and their main sessions." }))
