export * as HubState from "./state.js"

import path from "path"
import fs from "fs/promises"
import { Option, Schema } from "effect"
import { Path } from "@opencode/util/global"

const StateSchema = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Record(Schema.String, Schema.Boolean),
})

const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(StateSchema))

export type State = Schema.Schema.Type<typeof StateSchema>

export type Options = {
  // Tests inject their own directory; production falls back to the Global state directory.
  readonly directory?: string
}

// A missing, unreadable, or foreign-shaped file means "nothing enabled": the hub is
// opt-in, so a broken state file must degrade to an empty prompt block, not fail.
export async function read(options: Options = {}): Promise<State> {
  const text = await fs.readFile(file(options), "utf8").catch(() => undefined)
  if (text === undefined) return { version: 1, enabled: {} }
  return Option.getOrElse(decodeState(text), () => ({ version: 1, enabled: {} }))
}

export async function setEnabled(id: string, enabled: boolean, options: Options = {}): Promise<void> {
  const state = await read(options)
  const destination = file(options)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const next: State = { version: 1, enabled: { ...state.enabled, [id]: enabled } }
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`
  // temp+rename in the same directory: a crash between write and rename leaves the previous
  // file intact, whereas a half-written hub.json would read back as "nothing enabled".
  await fs.writeFile(temporary, JSON.stringify(next, null, 2)).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
  await fs.rename(temporary, destination).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}

const file = (options: Options) => path.join(options.directory ?? Path.state, "hub.json")
