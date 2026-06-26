/**
 * Local mock MCP server over Streamable HTTP — the MCP analogue of
 * tools/mockDataAgentApi.ts. Lets you exercise the MCP client and the
 * Teams streaming UX without the real Data Agent.
 *
 *   npm run mock-mcp           # starts on http://localhost:4100/mcp
 *   DATA_AGENT_CLIENT=mcp MCP_ENDPOINT_URL=http://localhost:4100/mcp npm run dev
 *
 * Runs in stateless mode: a fresh server + transport is created per request.
 */
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMockMcpServer } from "../src/mcp/mockMcpServer";

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = buildMockMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("mock-mcp error", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET/DELETE are used by the streamable-HTTP transport for SSE/session teardown.
// In stateless mode we simply reject them.
const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless mock)." },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

const port = parseInt(process.env.MCP_MOCK_PORT || "4100", 10);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Mock MCP server listening on http://localhost:${port}/mcp`);
});
