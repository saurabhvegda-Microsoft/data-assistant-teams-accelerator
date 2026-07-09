# Feature status

Status of the conversational-experience capabilities in this accelerator. Every
new capability is **feature-flagged and defaults to the original behavior**, so
existing deployments are unaffected until a flag is enabled.

Legend: ✅ Available · 🟡 Implemented, requires configuration/decision to enable.

| # | Capability | Status | Flag (default) | To enable |
|---|------------|--------|----------------|-----------|
| 1 | Streamed progress as a single status update | ✅ Available | `STREAMING_ENABLED` (on) | — |
| 2 | Conversation history + "start fresh" | 🟡 Scaffolded | `CONVERSATION_HISTORY_ENABLED` (off) | Server-side history in the Data Agent + retention decision |
| 3 | Data Agent consumed as an MCP tool | ✅ Available | `DATA_AGENT_CLIENT=mcp` (mock) | A reachable MCP endpoint |
| 4 | Per-user JWT to the Data Agent (SSO + OBO) | 🟡 Implemented | `USER_AUTH_ENABLED` (off) | Data Agent API scope/audience + Azure Bot OAuth connection |
| 5 | Interactive charts in Teams | ✅ Available | `NATIVE_CHARTS_ENABLED` (on) | — |
| 6 | Interactive chart web view (Stage View) | ✅ Available | `INTERACTIVE_CHARTS_ENABLED` (off) | Set `PUBLIC_BASE_URL` + add the bot host to manifest `validDomains` |

---

## 1. Streamed progress as a single status update

**Goal:** show backend/MCP progress as one in-place "thinking/working" indicator
between the prompt and the result — **not** as a stream of separate chat
messages.

**What's implemented:** while a query runs, the bot shows a single
`Working on your question…` indicator (the in-place progress bar in Teams), then
delivers the result card as the stream's final message. It does **not** relay
each backend step as its own chat message, and the final card does not carry the
SDK's `end of stream response` placeholder.

**Configuration:**
- `STREAMING_ENABLED` (default `true`) — master toggle. When the channel does not
  support streaming, the bot falls back to a typing indicator + the result card.
- `STREAMING_THOUGHTS_ENABLED` (default `false`) — opt in to relay **each**
  progress step. In real Teams these collapse into a single updating bar; on
  other surfaces they render as separate messages, so this is off by default.

**Code:** `src/bot.ts`, `src/services/streamingPolicy.ts`.

## 2. Conversation history + "start fresh"

**Goal:** keep context across turns in a chat, and let users reset to a clean
conversation.

**What's implemented (bot side):** when enabled, the bot generates a **stable
session id per chat** and sends it to the Data Agent (MCP tool argument
`sessionId`, plus `X-Conversation-Session` / `X-History-Policy: session` on the
REST path). A `/new` command or a **New conversation** action on the result card
rotates the id (clearing server-side context). The result card footer switches
from "Stateless" to "Contextual". The bot stores only the opaque id — never
message content — so it remains effectively stateless.

**To enable:**
- Set `CONVERSATION_HISTORY_ENABLED=true`.
- The **Data Agent must maintain history** keyed by `sessionId` (see
  [MCP_CONTRACT.md](./MCP_CONTRACT.md) §4). The bot does not store transcripts.
- Make the retention/compliance decision to move away from the
  single-turn/stateless default.

**Note:** the in-memory session map is per-replica; for multi-replica
deployments back it with a shared store (e.g. SDK `ConversationState` over Azure
Blob/Cosmos).

**Code:** `src/services/conversationSession.ts`, `src/bot.ts`, `src/cards/queryResultCard.ts`.

## 3. Data Agent consumed as an MCP tool

**Goal:** talk to the Data Agent over the Model Context Protocol instead of a
plain REST call.

**What's implemented:** `McpDataAgentClient` connects over **Streamable HTTP**
using the official MCP SDK, calls the configured tool (default `query`),
subscribes to progress notifications, and maps the tool result (structured
content → JSON text → plain text → image) to the bot's card model. A drop-in
mock MCP server supports local development.

**Configuration:**
- `DATA_AGENT_CLIENT` — `mock` | `rest` | `mcp` (backward compatible with
  `USE_MOCK_CLIENT`).
- `MCP_ENDPOINT_URL`, `MCP_TOOL_NAME` (default `query`).

**To enable:** point `MCP_ENDPOINT_URL` at a reachable MCP endpoint that
implements the contract in [MCP_CONTRACT.md](./MCP_CONTRACT.md).

**Local:** `npm run mock-mcp` (server) + `npm run dev:mcp` (bot wired to it).

**Code:** `src/services/mcpDataAgentClient.ts`, `src/mcp/mockMcpServer.ts`, `tools/mockMcpServer.ts`.

## 4. Per-user JWT to the Data Agent (Teams SSO + OBO)

**Goal:** the Data Agent receives the **end user's own token** (so Row-Level
Security is enforced for the actual user) rather than a shared service
credential.

**What's implemented:** an MSAL **On-Behalf-Of** exchange turns the user's Teams
SSO token into a Data Agent-scoped token, cached per user and sent as the
`Authorization: Bearer` header. The MCP and REST clients prefer this per-user
token over the static key. The manifest declares `webApplicationInfo` for Teams
SSO. Tokens are never logged.

**Configuration:** `USER_AUTH_ENABLED`, `DATA_AGENT_SCOPE`,
`AAD_APPLICATION_ID_URI`, and optional `AAD_CLIENT_ID` / `AAD_CLIENT_SECRET` /
`AAD_TENANT_ID` (default to the bot's app registration).

**To enable:**
1. Expose an API scope on the Data Agent's Entra app (e.g.
   `api://<data-agent-app-id>/access_as_user`); grant the bot delegated
   permission + admin consent.
2. Configure Teams SSO (`AAD_APPLICATION_ID_URI`).
3. Provide a mechanism to obtain the SSO assertion each turn (an Azure Bot
   **OAuth connection** / the `signin/tokenExchange` flow). Until configured, the
   bot falls back to the static credential.

**Code:** `src/services/userAuth.ts`, `src/bot.ts`, `appPackage/manifest.json`.

## 5. Interactive charts in Teams

**Goal:** render charts directly in the Teams chat.

**What's implemented:** time-series responses render as **native Teams Adaptive
Card charts** — `Chart.Line` (multi-series) or `Chart.VerticalBar`
(single-series, `chartType: "bar"`) — which support tooltips and legends in the
Teams client. An accessible data table is always included; a static chart image
is used as a fallback.

**Configuration:** `NATIVE_CHARTS_ENABLED` (default `true`; set `false` to use the
static image).

**Interactive chart web view (implemented, opt-in):** when
`INTERACTIVE_CHARTS_ENABLED=true`, the result card adds an **"Open interactive
chart"** `Action.OpenUrl`. If the Data Agent returns its own hosted chart via
`interactiveChartUrl`, the card links to that; otherwise the bot serves a
self-contained, fully-interactive **Plotly** rendering of the time-series at
`/charts/:id` (zoom/pan/hover/download). To open **inside** Teams as a Stage
View, set `PUBLIC_BASE_URL` to the bot's public host and add that host to the
manifest `validDomains`; otherwise the action opens in the browser.

**Code:** `src/charts/interactiveChartPage.ts`, `src/services/interactiveChart.ts`, `src/index.ts` (`/charts/:id`).

**Code:** `src/cards/queryResultCard.ts`.

---

## Quick reference — feature flags

| Flag | Default | Effect |
|------|---------|--------|
| `STREAMING_ENABLED` | `true` | Single in-place progress indicator while a query runs. |
| `STREAMING_THOUGHTS_ENABLED` | `false` | Relay each progress step (verbose) instead of one status. |
| `DATA_AGENT_CLIENT` | (mock) | `mock` \| `rest` \| `mcp` backend selector. |
| `NATIVE_CHARTS_ENABLED` | `true` | Native Adaptive Card charts vs. static image. |
| `INTERACTIVE_CHARTS_ENABLED` | `false` | "Open interactive chart" action → interactive web view at `/charts/:id`. |
| `PUBLIC_BASE_URL` | (localhost) | Public base URL used to build the interactive-chart link. |
| `USER_AUTH_ENABLED` | `false` | Per-user JWT to the Data Agent (SSO + OBO). |
| `CONVERSATION_HISTORY_ENABLED` | `false` | Server-side conversation history + reset UX. |

See [`env/.env.dev.example`](../env/.env.dev.example) for the full list.
