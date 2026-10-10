import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Plot } from "@opencode/core/plot"

// No team holds any plot: edit tools write as they would in a project without them.
export const noPlotsNode = makeGlobalNode({
  service: Plot.Service,
  layer: Layer.succeed(
    Plot.Service,
    Plot.Service.of({
      claim: () => Effect.die("no plots in this test"),
      release: () => Effect.succeed(0),
      list: () => Effect.succeed([]),
      guard: () => Effect.void,
      holds: () => Effect.succeed(true),
    }),
  ),
  deps: [],
})
