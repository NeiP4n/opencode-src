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
// switching it to another agent is ignored, so the orchestrator stays one.
export const agent = Agent.ID.make("orchestrator")

// Team roles are built-in agents with a "team-" prefix, so an operator's own
// agents of the same name (often subagents) never replace them.
export const role = (name: string) => Agent.ID.make(`team-${name}`)

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

// Where a role or team comes from. "builtin" ships with opencode, "edited" is
// a built-in the operator changed (removing it restores the default) and
// "custom" is one the operator created (removing it deletes it).
export const Origin = Schema.Literals(["builtin", "edited", "custom"]).annotate({ identifier: "Orchestra.Origin" })
export type Origin = typeof Origin.Type

// What the operator edits about a role. `rules` are the role's own
// instructions, added after the shared team prompt; `model` is an optional
// "provider/model" the role's sessions run instead of the default.
export const RoleSpec = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  rules: Schema.String,
  category: Schema.String,
  readOnly: Schema.Boolean,
  model: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Orchestra.RoleSpec" })
export interface RoleSpec extends Schema.Schema.Type<typeof RoleSpec> {}

// A team role: the agent its sessions run is `role(id)`.
export const Role = Schema.Struct({
  ...RoleSpec.fields,
  id: Schema.String,
  agent: Agent.ID,
  origin: Origin,
}).annotate({ identifier: "Orchestra.Role" })
export interface Role extends Schema.Schema.Type<typeof Role> {}

// One session a team template opens: the role agent it runs, its title and
// the category it is grouped under in the project.
export const Member = Schema.Struct({
  agent: Agent.ID,
  title: Schema.String,
  category: Schema.String,
}).annotate({ identifier: "Orchestra.Member" })
export interface Member extends Schema.Schema.Type<typeof Member> {}

export const TemplateSpec = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  members: Schema.Array(Member),
}).annotate({ identifier: "Orchestra.TemplateSpec" })
export interface TemplateSpec extends Schema.Schema.Type<typeof TemplateSpec> {}

// A ready-made AI team: creating a project from it opens one session per member
// next to the main session and gives the orchestra full access to them.
export const Template = Schema.Struct({
  ...TemplateSpec.fields,
  id: Schema.String,
  origin: Origin,
}).annotate({ identifier: "Orchestra.Template" })
export interface Template extends Schema.Schema.Type<typeof Template> {}

// The roles opencode ships with. Planning roles come before building, quality after it.
export const roles: readonly (RoleSpec & { id: string })[] = [
  {
    id: "architect",
    name: "Architect",
    category: "Planning",
    description: "Designs the approach before code: options, trade-offs, boundaries and a step plan with checks.",
    rules:
      "Role: architect. Study how the code works now, compare two or three approaches, choose one and explain why, name the files and boundaries of the change, and write a step plan where every step has a check. You do not edit project files.",
    readOnly: true,
  },
  {
    id: "developer",
    name: "Developer",
    category: "Build",
    description: "Implements changes in code, tests and docs, and verifies them by running them.",
    rules:
      "Role: developer. Implement the task with the smallest change that fully solves it, matching the surrounding code. Run the relevant build, type check or tests and report their real output.",
    readOnly: false,
  },
  {
    id: "tester",
    name: "Tester",
    category: "Quality",
    description: "Checks work by running it: acceptance criteria, edge cases and regression tests.",
    rules:
      "Role: tester. Verify the claimed result by running it, not by reading it. Check every acceptance criterion and the edge cases, write tests that fail on the defect and pass on the fix, and report each check as passed or failed with the command and output.",
    readOnly: false,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    category: "Quality",
    description: "Reviews diffs for correctness, security, regressions and quality without editing them.",
    rules:
      "Role: reviewer. Review the change (start from git diff) against the task: correctness, security, regressions, missing tests, needless complexity. Report findings from most to least severe with file and line. You do not edit project files.",
    readOnly: true,
  },
  {
    id: "debugger",
    name: "Debugger",
    category: "Quality",
    description: "Finds the proven root cause of a bug by reproducing and narrowing it down.",
    rules:
      "Role: debugger. Reproduce the bug, narrow it down and prove the root cause with evidence (a failing command, a log, a minimal case). Explain the mechanism and the fix you recommend. You do not edit project files.",
    readOnly: true,
  },
  {
    id: "researcher",
    name: "Researcher",
    category: "Planning",
    description: "Researches the codebase, documentation and the web and reports facts with sources.",
    rules:
      "Role: researcher. Answer the question from the code, documentation and the web. Separate facts (with a file, line or link) from guesses, and say what you could not find. You do not edit project files.",
    readOnly: true,
  },
  {
    id: "designer",
    name: "Designer",
    category: "Planning",
    description: "Designs and builds user interfaces and interaction, then checks them on screen.",
    rules:
      "Role: designer. Work on screens and interaction: layout, states (empty, loading, error), wording and accessibility. Follow the project's existing components and theme, build the change, and check it the way a user would see it.",
    readOnly: false,
  },
  {
    id: "writer",
    name: "Writer",
    category: "Build",
    description: "Writes documentation, guides and texts and keeps them true to the code.",
    rules:
      "Role: writer. Write clear documentation and texts for the stated reader. Check every claim, command and example against the current code before you write it down.",
    readOnly: false,
  },
  {
    id: "devops",
    name: "DevOps",
    category: "Build",
    description: "Owns builds, CI, packaging and deployment scripts.",
    rules:
      "Role: devops. Work on builds, CI, packaging and deployment. Prefer reversible changes, never run deployments or destructive commands without being told to, and prove changes by running the build or pipeline step.",
    readOnly: false,
  },
]

const member = (name: string, title: string): Member => ({
  agent: role(name),
  title,
  category: roles.find((item) => item.id === name)?.category ?? "Team",
})

// The teams opencode ships with.
export const templates: readonly (TemplateSpec & { id: string })[] = [
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
