# @opencode/simulation — Drive mode: simulated run

## What This Is

Simulation of opencode without a real model and a real terminal: 13 files,
~2.2 thousand lines in `src/`. The package consists of two halves — a
"frontend" (UI rendering with external control) and a "backend" (replacement
of the server layers with simulated ones), joined by the `Drive` manifest and
their own protocol.

Its purpose is reproducible runs: a test or a tool drives the UI, and all
outgoing requests go into a routing table instead of the network.

## Layers and Dependencies

Layer **L4**: depends on `ai`, `core`, `plugin`, `protocol`, `util`.

Who depends on it:

- `packages/server` — layer replacement when starting in simulation mode;
- `packages/tui` — the frontend part;
- `packages/simulation` itself.

There is no root `exports`, only separate paths:

```json
"./backend": "./src/backend/index.ts",
"./frontend": "./src/frontend/simulation.ts",
"./protocol": "./src/protocol/index.ts",
"./recording": "./src/recording.ts"
```

## Subsystems and Files

**Manifest** — `packages/simulation/src/manifest.ts`: `Manifest` on
Effect Schema with two endpoints (`ui`, `backend`) — both must be
`ws://127.0.0.1:<port>` (loopback and an explicit port are checked by the
schema), plus `InstanceName` (regex `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`) and
absolute paths. `DriveManifest.resolve()` reads it from disk.

**Frontend** — the `packages/simulation/src/frontend/` directory:
- `simulation.ts` → `Drive.create(options, version)`: selects the renderer
  (`createCliRenderer` from `@opentui/core` or headless according to the
  `OPENCODE_DRIVE_RENDERER=headless` variable), starts `SimulationServer` at
  the `manifest.endpoints.ui` endpoint and writes the address to stderr;
- `renderer.ts` (headless renderer, capable of replaying a recording),
  `server.ts`, `actions.ts` (`createHarness(renderer)`), `semantics.ts`.

**Backend** — the `packages/simulation/src/backend/` directory:
`index.ts` → `simulationReplacements(...)` — the layers the server
mixes in when simulation is enabled (via dynamic import, so that the
module is not loaded needlessly); `network.ts` — the routing table, unknown
destinations are forbidden; `openai.ts` — the endpoint served by the driver;
`simulated-provider.ts` — the substituted provider.

**Control and protocol** — `packages/simulation/src/control-server.ts`,
`packages/simulation/src/protocol/index.ts`.

**Recording** — `packages/simulation/src/recording.ts` (the `./recording`
export): the timeline along which the headless renderer replays the scenario.

## Entry Points

1. `packages/simulation/src/frontend/simulation.ts` → `Drive.create(...)`
   — starting the frontend part.
2. `packages/simulation/src/backend/index.ts` → `simulationReplacements(...)`
   — replacing the server layers.
3. `packages/simulation/src/manifest.ts` → `DriveManifest.resolve()` —
   where to get the run manifest.
4. `packages/simulation/src/protocol/index.ts` — the protocol between the
   driver and the simulation.

## Where to Look Next

- `packages/server/PACKAGE.md` — where `simulationReplacements` are mixed
  into the assembly.
- `packages/tui/PACKAGE.md` — the frontend and `@opentui/core`.
- `packages/ai/PACKAGE.md` — the real providers that `simulated-provider`
  substitutes.
- `packages/protocol/PACKAGE.md` → `./simulation` — the simulation contract.

## Pitfalls

1. **Endpoints are loopback only.** The schema in `manifest.ts` accepts
   exclusively `ws:` on `127.0.0.1` with a port; an external address will
   not pass manifest validation.
2. **The backend module is loaded dynamically.** A direct import of
   `simulation/backend` outside simulation mode will substitute the layers
   too early — the server itself decides when to wire it in.
3. **`network.ts` forbids unknown destinations.** In simulation mode a real
   model call silently turns into a failure if the route is not
   registered.
4. **Headless mode depends on `OPENCODE_DRIVE_RENDERER`.** The default value
   is `visible`; set it explicitly for a screenless run.
