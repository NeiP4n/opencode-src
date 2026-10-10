export * as PlotTool from "./plot.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import path from "node:path"
import { Location } from "../../location.js"
import { Plot } from "../../plot.js"

export const name = "plots"

const description = [
  "Plots (участки) keep AI teams from breaking each other's work in one project.",
  "Before changing a part of the project, claim it as your plot: the files or folders you will edit and why.",
  "Other teams, on this computer or reaching the project from other computers, then cannot edit there until you release it; edits inside their plots are refused to you the same way.",
  "Actions: claim takes paths (files or folders, relative to the project) with a purpose; release gives your plots back when the work is done, all of them or one by id; list shows every plot in the project.",
  "An orchestrator's claim covers its whole team. A plot runs out after 30 minutes without edits, so claim again after a long pause.",
].join("\n")

export const Input = Schema.Struct({
  action: Schema.Literals(["claim", "release", "list"]),
  paths: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "Files or folders to claim, relative to the project",
  }),
  purpose: Schema.optionalKey(Schema.String).annotate({ description: "What the team is doing there, for claim" }),
  id: Schema.optionalKey(Schema.String).annotate({ description: "One plot to release; all of yours when omitted" }),
})

export const Output = Schema.Struct({ output: Schema.String })

export const Plugin = {
  id: "opencode.tool.plot",
  effect: Effect.fn("PlotTool.Plugin")(function* (ctx: Context) {
    const plots = yield* Plot.Service
    const location = yield* Location.Service

    const describe = (plot: Plot.Info) =>
      `${plot.id} · ${plot.team} on ${plot.machine} · ${plot.paths.map((item) => path.relative(location.directory, item) || ".").join(", ")} · ${plot.purpose} · until ${new Date(plot.expires).toLocaleTimeString()}`

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              switch (input.action) {
                case "claim": {
                  if (!input.paths?.length)
                    return yield* new ToolFailure({ message: "Pass the files or folders to claim as paths" })
                  const plot = yield* plots
                    .claim({
                      sessionID: context.sessionID,
                      directory: location.directory,
                      paths: input.paths,
                      purpose: input.purpose ?? "",
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
                  return { output: `Claimed ${describe(plot)}. Release it when the work is done.` }
                }
                case "release": {
                  const count = yield* plots.release({
                    sessionID: context.sessionID,
                    directory: location.directory,
                    id: input.id,
                  })
                  return { output: count === 0 ? "You hold no plot to release." : `Released ${count} plot(s).` }
                }
                case "list": {
                  const all = yield* plots.list(location.directory)
                  return {
                    output:
                      all.length === 0
                        ? "No plots are taken in this project."
                        : (yield* Effect.forEach(all, (plot) =>
                            plots
                              .holds(plot, context.sessionID)
                              .pipe(Effect.map((own) => `${own ? "(yours) " : ""}${describe(plot)}`)),
                          )).join("\n"),
                  }
                }
              }
            }).pipe(Effect.map((output) => ({ output, content: output.output }))),
        }),
      )
      .pipe(Effect.orDie)

    // Every request shows the plots other teams hold, so the AI plans around them instead
    // of running into a refusal halfway through an edit.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (!event.tools[name]) return
        const all = yield* plots.list(location.directory)
        const foreign = yield* Effect.filter(all, (plot) =>
          plots.holds(plot, event.sessionID).pipe(Effect.map((own) => !own)),
        )
        if (foreign.length === 0) return
        event.system.push({
          type: "text",
          text: [
            "# Plots other teams hold in this project",
            "Do not edit inside these until they are released; claim your own plot with the plots tool before you change code.",
            ...foreign.map((plot) => `- ${describe(plot)}`),
          ].join("\n"),
        })
      }),
    )
  }),
}
