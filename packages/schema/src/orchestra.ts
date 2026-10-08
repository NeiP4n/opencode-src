export * as Orchestra from "./orchestra.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
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

// The agent of every project's main session. A session running it keeps it:
// switching it to another agent is ignored, so the orchestra stays an orchestra.
export const agent = Agent.ID.make("orchestra")

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

// One session a team template opens: the role agent it runs and its title.
export const Member = Schema.Struct({
  agent: Agent.ID,
  title: Schema.String,
}).annotate({ identifier: "Orchestra.Member" })
export interface Member extends Schema.Schema.Type<typeof Member> {}

// A ready-made AI team: creating a project from it opens one session per member
// next to the main session and gives the orchestra full access to them.
export const Template = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  members: Schema.Array(Member),
}).annotate({ identifier: "Orchestra.Template" })
export interface Template extends Schema.Schema.Type<typeof Template> {}

const member = (agent: string, title: string): Member => ({ agent: Agent.ID.make(agent), title })

export const templates: readonly Template[] = [
  {
    id: "feature",
    name: "Feature",
    description: "Design, build, test and review a new feature",
    members: [
      member("architect", "Architect"),
      member("developer", "Developer"),
      member("tester", "Tester"),
      member("reviewer", "Reviewer"),
    ],
  },
  {
    id: "full",
    name: "Full team",
    description: "Larger work split between two developers",
    members: [
      member("architect", "Architect"),
      member("developer", "Developer 1"),
      member("developer", "Developer 2"),
      member("tester", "Tester"),
      member("reviewer", "Reviewer"),
    ],
  },
  {
    id: "bugfix",
    name: "Bug fix",
    description: "Find the root cause, fix it and prove the fix",
    members: [member("debugger", "Debugger"), member("developer", "Developer"), member("tester", "Tester")],
  },
  {
    id: "ui",
    name: "UI",
    description: "Screens and interaction, built and checked",
    members: [member("designer", "Designer"), member("developer", "Developer"), member("tester", "Tester")],
  },
  {
    id: "research",
    name: "Research",
    description: "Study a question and write up the findings",
    members: [member("researcher", "Researcher"), member("writer", "Writer")],
  },
  {
    id: "docs",
    name: "Docs",
    description: "Write documentation and check it against the code",
    members: [member("writer", "Writer"), member("reviewer", "Reviewer")],
  },
  {
    id: "release",
    name: "Release",
    description: "Build, CI and deployment",
    members: [member("devops", "DevOps"), member("tester", "Tester"), member("reviewer", "Reviewer")],
  },
]
