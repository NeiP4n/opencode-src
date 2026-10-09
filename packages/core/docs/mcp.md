# core/mcp — the MCP client: connecting servers, stdio transport, OAuth, instructions

## What's In This Folder

Four files: `index.ts` — the MCP service with the lifecycle of servers,
`client.ts` — the connection of one server through the SDK, `stdio.ts` — our own
transport on top of the location's processes, `oauth.ts` — login and credential
storage. Plus `instructions.ts` — the instruction for the model about servers. The meaning:
local and remote MCP servers are connected as to the core, their tools
become ordinary tools, and their instructions get into the prompt.

## Key Files

- `packages/core/src/mcp/index.ts` — the service `@opencode/MCP`: `servers`,
  `add`, `connect`, `disconnect`, `remove`, `tools`, `callTool`,
  `instructions`, `prompts`, `prompt`, `resourceCatalog`, `resources`,
  `readResource`; the errors `NotFoundError` and `ToolCallError`.
- `packages/core/src/mcp/client.ts` — `connect(...)`, the `Connection`
  interface, the errors `NeedsAuthError`, `ConnectError`,
  `SessionExpiredError`, the response conversion `toCallToolResult`.
- `packages/core/src/mcp/stdio.ts` — `make(options)`: a transport that launches
  the server through the `Environment` of the location.
- `packages/core/src/mcp/oauth.ts` — `provider`, `loggedFetch`,
  `configuredDiscovery`, `authorize`, `connectProvider`, `memoryStore`,
  the credential conversion `toCredential` and `toTokens`; `instructions.ts` —
  the service `McpInstructions` with the instruction key `core/mcp-guidance`.

## Important Details

- Server statuses: `pending`, `connected`, `failed`, `needs_auth`,
  `disabled`; the texts for the model are assembled by the function `unavailable`.
  The connection is Location-scoped, but the start of **remote** servers
  is serialized by URL through a `KeyedMutex` named `endpointLoads`: a common
  point must not receive a batch of simultaneous connections.
- Each server holds a startup `Latch`: a tool call waits for
  `startup.await`, so a call to a server that is not connected yet does not fail,
  but waits for the handshake. The tools are read **as part of the connection**: a failure of
  their loading marks the server as `failed`, instead of leaving it connected with
  an empty list. A successful connection publishes three events:
  `ToolsChanged`, `ResourcesChanged`, `StatusChanged`; without the first a
  server that connected late would not appear in the tool registry at all.
- The expiration of the HTTP session is handled twice: a foreground request
  is repeated once through `recovering`, background refreshes — through
  `recover`. The expiration is determined by a 404 or by a 400 with the text «Bad
  Request: Server not initialized», and only when the transport has
  a `sessionId` — a sign of the obsolete protocol era.
- Late SDK callbacks are discarded: `whenLive` verifies that the connection is still
  current, otherwise the effect turns into nothing. The lifecycle operations
  are serialized by `locks`; everything that takes that lock from a connection callback
  must work in a fork, because the operations close scopes and call
  `onClose`. The connection scope is a fork from the root: its closure brings down
  the transport and the process, and for stdio also the process group.
- Registration of an OAuth integration: the identifier is counted as `mcp_` plus a sha1
  of the name and URL, cut to 16 characters — the name and URL together, and not only
  the URL: two servers with the same address under different names keep different
  credentials. This data **survives the removal** of the server from the config, and its
  change reconnects the server without a restart.
- Elicitation forms belong to the location, and not to the session, and hang on the fictitious
  identifier `global`: a server cannot attribute them to a stored session.
  Modes: URL (an external form field, a race with a request cancellation, only the obsolete
  era) and a form by a JSON schema. Machine headers of the kind «string with format
  email» are replaced with a description or a key; arrays become a multiselect.
- Client timeouts: startup 30 seconds, catalog 30 seconds, execution 12 hours;
  each is configurable in the server configuration. On a tool call
  `onprogress: () => {}` is passed — that keeps the SDK timeout from
  firing prematurely on long calls. Remote servers
  get the `?codemode=false` parameter, in order to give "raw" tools
  instead of their own Code Mode server; on a 400 or 404 response one
  retry is made with the original address.
- Identity of the resource in OAuth: an address with the same origin and path is equated
  to the configured one, because the servers return the transport query as
  resource; the token stays bound to the configured address.
- Simultaneous refreshes by one refresh token are merged into one
  request: the tokens are rotated, and a second parallel request would get
  `invalid_grant`.
- `oauth.ts` supports three client registrations: static `client_id`,
  CIMD (a public document at the address
  `https://opencode.ai/oauth/opencode/client.json`) and dynamic. The login
  order: first `initialize` with a 5 second timeout, to get the resource metadata
  address and the required scopes from the 401 response; without it the metadata
  search can only guess the well-known path.
- The OAuth receiver is a local HTTP server on `127.0.0.1`: the port is taken from
  `callback_port`, otherwise from the port of `redirect_uri`, otherwise random; the
  `node:http` module is loaded lazily, so that runtimes without loopback do not pay for
  the import. A token without an expiry is stored with `expires: 0`, which on
  a reverse read does not force the SDK to refresh the token.
- `stdio.ts` does not use the SDK transport: the server is launched through
  the `Environment` of the location, so a remote workspace runs
  the MCP servers there, where the rest of the commands run. The outgoing frames are put into
  a queue of 64 items, and not written directly: stdin must stay
  open for the whole session. The frame limit is 16 MiB, on exceeding it the read
  fails, and is not truncated. An unexpected exit of the server is reported with the code and
  the tail of stderr (the last 1000 characters), because that is exactly where the
  reason is named. Closing: SIGTERM after 2 seconds of waiting for the exit code, then
  SIGKILL.
- `instructions.ts` shows a server only if the session can reach at least
  one of its tools, and for Code Mode — only if `execute` is allowed.

## Connections

- `packages/core/src/tool/mcp.ts` — registers the MCP tools in the registry and
  imports `namespace` and `name` from here; `tool/plugin/mcp-resource.ts` —
  the `list_mcp_resources` and `read_mcp_resource` tools on top of the service.
- `@opencode/schema/mcp` — the server, status, resource and template types;
  `mcp-event` — the events `ToolsChanged`, `StatusChanged`, `ResourcesChanged`;
  `config/mcp` — the server configuration.
- `packages/core/src/state.ts` — `State.create` and `State.reconcile` give the
  config editor and the change notification; `credential.ts` —
  `Credential.Service` and `Credential.Event.Switched`; `integration.ts` —
  the OAuth integration registration.
- `packages/core/src/form.ts` — forms for elicitation; the URL field key is
  `elicitation`.
- `packages/core/src/effect/keyed-mutex.ts` — `KeyedMutex` for the locks.
- `@modelcontextprotocol/client` — the SDK: `Client`,
  `StreamableHTTPClientTransport`, `ReadBuffer`, `serializeMessage`, `auth`,
  `discoverOAuthServerInfo`.
- `packages/core/src/oauth/page.ts` — success and error pages of the OAuth
  receiver; `packages/core/src/util/error-summary.ts` — a summary of errors to the log;
  `packages/core/src/v1/config/mcp.ts` — the old configuration format.

## Pitfalls

- `McpStdio` deliberately does not take the SDK transport: a substitution with
  `StdioClientTransport` would return the servers to the host and break remote
  workspaces. The environment is extended through `extendEnv` by the spawner, and not in the
  transport itself, so that the host variables do not cross the boundary.
- The sign of session expiration is the presence of `sessionId` at the transport: on
  modern connections it is absent, and a 404 on an unknown method would wrongly be taken for
  an expiration.
- The sign "the server is not connected yet" in `callTool` is taken from the status: the text
  for the model suggests reconnecting or logging in via `/mcps`.
  `tools()` returns what is connected right now, so the servers in the `pending` status
  will get into the list after the publication of `ToolsChanged`.
- `prompts()` hides a failure: an error of loading the prompts turns into an empty
  list, whereas a failure of the tools on connection — into the `failed` status.
  The collection of the resource catalog goes in parallel, and a failure of one server gives an empty
  catalog instead of an error of the whole call.
- The refresh of shared refresh tokens in `connectProvider` deletes the credential
  row only if it still holds the presented token, otherwise it could
  have wiped someone else's refresh. On the revocation of a credential the scopes
  `verifier` and `discovery` are skipped: they do not mean that the token has expired.
- The redirect address and `state` are passed to the provider only during a real
  login. Without them the provider **refuses** to register the client and
  to redirect, and the connection ends in `needs_auth`, and not with an empty
  token. The absence of `redirectUrl` switches the SDK to the
  client-credentials grant, therefore the placeholder address `http://127.0.0.1/callback`
  is set always. The OAuth state (`state`) is 32 random bytes in
  base64url; on a mismatch the login is rejected before the code exchange, and the
  `codemode=false` parameter is added only if it is not yet in the address.