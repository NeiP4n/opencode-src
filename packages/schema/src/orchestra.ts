export * as Orchestra from "./orchestra.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"
import { SessionID } from "./session-id.js"

// What a project's main session may do with another session of the project.
// Each level includes the ones before it: hidden < read < write < full.
//   hidden — the main session does not see the session at all
//   read   — list it and read its history
//   write  — also send it messages, which start its model
//   full   — also stop it while it runs
export const Access = Schema.Literals(["hidden", "read", "write", "full"]).annotate({ identifier: "Orchestra.Access" })
export type Access = typeof Access.Type

export const levels: readonly Access[] = ["hidden", "read", "write", "full"]

export function allows(access: Access, required: Access) {
  return levels.indexOf(access) >= levels.indexOf(required)
}

export const defaultAccess: Access = "read"

export const ProjectID = Schema.String.check(Schema.isStartsWith("prj")).pipe(
  Schema.brand("OrchestraProjectID"),
  statics((schema) => ({ create: () => schema.make("prj_" + ascending()) })),
)
export type ProjectID = typeof ProjectID.Type

// A project the operator created: a name and a directory. Its sessions are the
// sessions opened in that directory or below it; `main` is its orchestra
// session, absent until it is opened the first time.
export const Project = Schema.Struct({
  id: ProjectID,
  name: Schema.String,
  directory: Schema.String,
  main: SessionID.pipe(Schema.optional),
  created: Schema.Number,
}).annotate({ identifier: "Orchestra.Project" })
export interface Project extends Schema.Schema.Type<typeof Project> {}

// Whether a session directory belongs to a project directory.
export function contains(project: string, directory: string) {
  if (directory === project) return true
  const root =
    project.endsWith("/") || project.endsWith("\\") ? project : project + (project.includes("\\") ? "\\" : "/")
  return directory.startsWith(root)
}
