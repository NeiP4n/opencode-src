import { createResource, onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"

// The operator's own projects. The layout reads the count to decide whether the
// project tree takes room on the left; the tree and its dialogs read the list.
export const { use: useProjects, provider: ProjectsProvider } = createSimpleContext({
  name: "Projects",
  init: () => {
    const client = useClient()
    const [list, { refetch, mutate }] = createResource(() => client.api.orchestra.project.list().catch(() => []))
    onCleanup(client.event.on("server.connected", () => void refetch()))
    return {
      list: () => list() ?? [],
      loaded: () => list() !== undefined,
      refetch: () => void refetch(),
      mutate,
    }
  },
})
