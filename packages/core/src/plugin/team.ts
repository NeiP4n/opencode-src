export * as TeamPlugin from "./team.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Model } from "@opencode/schema/model"
import { Effect, Stream } from "effect"
import { Agent } from "../agent.js"
import { Orchestra } from "../orchestra.js"

const TEAM = `You are one session of a project's AI team. Tasks usually come from the project's Orchestrator session, which leads the team; treat them like requests from the operator. Do exactly the task you are given and stay inside its limits. Your final message is sent back to the Orchestrator as your report, so end every task with it: first line done / partly done / not done, then what changed (files), how you checked it (command and real result), and anything left or risky. Keep it short; details stay in this session.`

// Registers every team role, built-in or the operator's own, as a "team-" agent.
// The operator edits roles at runtime, so the agents are rebuilt on every change.
export const Plugin = define({
  id: "opencode.team",
  effect: Effect.fn(function* (ctx) {
    const orchestra = yield* Orchestra.Service
    const team = { roles: yield* orchestra.roles() }
    yield* orchestra.changes.pipe(
      Stream.runForEach(() =>
        orchestra.roles().pipe(
          Effect.tap((roles) => Effect.sync(() => (team.roles = roles))),
          Effect.andThen(ctx.agent.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* ctx.agent.transform((editor) => {
      for (const role of team.roles)
        editor.update(role.agent, (item) => {
          item.name = Agent.Name.make(role.name)
          item.description = role.description
          item.system = role.rules ? `${TEAM}\n\n${role.rules}` : TEAM
          item.mode = "primary"
          if (role.model) item.model = Model.Ref.parse(role.model)
          item.permissions.push({ action: "question", resource: "*", effect: "allow" })
          if (role.readOnly) item.permissions.push({ action: "edit", resource: "*", effect: "deny" })
        })
    })
  }),
})
