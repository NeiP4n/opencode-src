export * as Hub from "./index.js"

export type { Backend, Category, Entry, Platform } from "./types.js"
export { placeholders } from "./types.js"
export { all, categories, get } from "./catalog/index.js"
export {
  available,
  chooseBackend,
  missingTools,
  prepare,
  render,
  supportsPlatform,
  type Rendered,
  MissingArgumentError,
  MissingToolError,
} from "./resolve.js"
export { planFor, removeCommand, detectManager, installable, type Manager, type Plan } from "./install.js"
export { read, setEnabled, type State } from "./state.js"
export * as HubActions from "./actions.js"
export type { ActionResult } from "./actions.js"
export { renderHubHints, type Hints } from "./prompt.js"
export { hinted, discoverable } from "./visibility.js"
export { rewrite } from "./match.js"
