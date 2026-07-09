# Data Agent MCP tool contract

The Teams bot's `McpDataAgentClient` (`src/services/mcpDataAgentClient.ts`) talks
to the Data Agent as an **MCP server over Streamable HTTP**. This is the contract
the Data Agent must implement to be compatible — it is the single source of truth
for the tool name, input/output schema, progress, and auth the bot expects.

> Selected with `DATA_AGENT_CLIENT=mcp` and `MCP_ENDPOINT_URL=https://<host>/mcp`.
> A drop-in mock implementation lives in `src/mcp/mockMcpServer.ts` /
> `tools/mockMcpServer.ts` (`npm run mock-mcp`).

## 1. Connection & auth

- **Transport:** MCP **Streamable HTTP** at `MCP_ENDPOINT_URL`.
- **Per-request headers** the bot sends:
  | Header | When | Meaning |
  |--------|------|---------|
  | `Authorization: Bearer <token>` | always (if a token is available) | Per-user OBO JWT when `USER_AUTH_ENABLED`, else the static `DATA_AGENT_API_KEY`. |
  | `X-User-AAD-Object-Id` | if known | The caller's Entra object id. |
  | `X-User-Id` | if known | The caller's Teams user id. |

## 2. Tool

- **Name:** `query` (the bot can be pointed at another name via `MCP_TOOL_NAME`).
- **Input schema** (zod shape):
  ```ts
  {
    question: z.string(),          // the user's natural-language question
    sessionId: z.string().optional() // see §4 — present only when history is enabled
  }
  ```
  Unknown properties are ignored by the bot's mock; the Data Agent should do the
  same (non-strict object) so the contract can evolve safely.

## 3. Result

The bot maps the `CallToolResult` in this order of preference (see
`mapToolResult`):

1. **`structuredContent`** (preferred) — either
   - the full result envelope: `{ success: boolean; data?: ResponseData; error?: string; suggestions?: string[] }`, or
   - just the `ResponseData` payload (the bot wraps it as `success: true`).
2. a **text** content block whose `text` is the JSON of one of the above.
3. a plain **text** content block → rendered as a single-cell table.
4. an **image** content block (`{ type: "image", data: <base64>, mimeType }`) → rendered as a chart image.

`isError: true` is surfaced to the user as an error.

### `ResponseData` shape

```ts
{
  type: "table" | "metrics" | "timeseries";
  title: string;
  sql?: string;                                   // optional; shown under "Show SQL"

  // type === "table"
  columns?: string[];
  rows?: (string | number)[][];

  // type === "metrics"
  metrics?: { label: string; value: string; change?: string }[];

  // type === "timeseries"
  series?: { label: string; values: number[] }[];
  seriesLabels?: string[];                          // x-axis categories
  chartType?: "line" | "bar";                       // default "line"; "bar" = single-series VerticalBar
  chartImageUrl?: string;                           // fallback when native charts are disabled
  chartAltText?: string;
  interactiveChartUrl?: string;                     // optional MCP-hosted interactive chart (INTERACTIVE_CHARTS_ENABLED)
}
```

Time-series renders as a native Teams **`Chart.Line`** (multi-series) or
**`Chart.VerticalBar`** (single series + `chartType: "bar"`); `chartImageUrl` is
used only when `NATIVE_CHARTS_ENABLED=false`.

When `INTERACTIVE_CHARTS_ENABLED=true`, the result card also gets an **"Open
interactive chart"** action. If the tool returns `interactiveChartUrl`, the card
links to that; otherwise the bot hosts an interactive (Plotly) rendering of the
time-series at `/charts/:id` and links to it.

## 4. Conversation history (optional)

When `CONVERSATION_HISTORY_ENABLED=true`, the bot includes a stable **`sessionId`**
in the tool arguments (and `X-Conversation-Session` / `X-History-Policy: session`
on the REST path). The id is stable per Teams chat and **rotates when the user
starts a new conversation**. The Data Agent should key any server-side history off
this id. When `sessionId` is absent, treat the request as single-turn / stateless.

The bot stores only the opaque id — never message content — so it stays
effectively stateless.

## 5. Progress (optional — powers streamed "thoughts")

If the tool sends MCP **progress notifications** during execution, the bot
forwards each notification's `message` to Teams as an informative update (the
blue progress bar) while `STREAMING_ENABLED`. Recommended cadence ≈ 1/sec. The
bot supplies a `progressToken`, so standard MCP progress works out of the box.

## 6. Minimal example (server side)

```ts
server.registerTool(
  "query",
  {
    description: "Answer a financial data question.",
    inputSchema: { question: z.string(), sessionId: z.string().optional() },
  },
  async ({ question, sessionId }, extra) => {
    const token = extra._meta?.progressToken;
    if (token !== undefined) {
      await extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: 1, total: 2, message: "Generating SQL…" },
      });
    }
    const data = await runTextToSql(question, sessionId); // your implementation
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data }) }],
      structuredContent: { success: true, data },
    };
  }
);
```
