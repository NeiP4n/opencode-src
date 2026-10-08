export * as Orchestra from "./orchestra.js"

import { Schema } from "effect"
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

export const State = Schema.Struct({
  // The project's main session, absent until it is opened the first time.
  main: SessionID.pipe(Schema.optional),
  // Access per session of the project; sessions without an entry use `defaultAccess`.
  access: Schema.Record(Schema.String, Access),
}).annotate({ identifier: "Orchestra.State" })
export interface State extends Schema.Schema.Type<typeof State> {}

export const defaultAccess: Access = "read"
