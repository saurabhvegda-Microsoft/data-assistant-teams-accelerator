import { McpDataAgentClient, mapToolResult } from "../src/services/mcpDataAgentClient";
import { buildMockMcpServer } from "../src/mcp/mockMcpServer";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UserContext } from "../src/types";

const USER: UserContext = {
  userId: "u1",
  aadObjectId: "aad-1",
  conversationId: "c1",
  channelId: "msteams",
};

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMockMcpServer();
  await server.connect(serverTransport);
  const client = new McpDataAgentClient({
    toolName: "query",
    transportFactory: () => clientTransport,
  });
  return { client, server };
}

describe("McpDataAgentClient", () => {
  it("invokes the MCP tool and maps a structured table result", async () => {
    const { client, server } = await connectedClient();
    const result = await client.query("revenue by region", USER);

    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("table");
    expect(result.data?.columns).toContain("Region");
    expect(result.data?.rows?.length).toBeGreaterThan(0);
    await server.close();
  });

  it("forwards MCP progress notifications to the onProgress callback", async () => {
    const { client, server } = await connectedClient();
    const updates: string[] = [];

    await client.query("monthly revenue trend", USER, (u) => updates.push(u.message));

    expect(updates.length).toBeGreaterThan(0);
    expect(updates.some((m) => m.includes("Generating SQL"))).toBe(true);
    await server.close();
  });

  it("maps an unsuccessful structured result (unknown query)", async () => {
    const { client, server } = await connectedClient();
    const result = await client.query("random gibberish xyz", USER);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    await server.close();
  });

  it("reports healthy when the MCP server lists tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMockMcpServer();
    await server.connect(serverTransport);
    const client = new McpDataAgentClient({ transportFactory: () => clientTransport });

    const health = await client.healthCheck();
    expect(health.status).toBe("healthy");
    await server.close();
  });
});

describe("McpDataAgentClient auth headers", () => {
  async function captureHeadersFor(options: {
    getAuthToken?: () => Promise<string | undefined>;
    apiKey?: string;
  }) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMockMcpServer();
    await server.connect(serverTransport);
    let captured: Record<string, string> = {};
    const client = new McpDataAgentClient({
      ...options,
      transportFactory: (headers) => {
        captured = headers;
        return clientTransport;
      },
    });
    await client.query("revenue by region", USER);
    await server.close();
    return captured;
  }

  it("sends the per-user SSO/OBO token and identity headers", async () => {
    const headers = await captureHeadersFor({
      getAuthToken: async () => "user-jwt-123",
    });
    expect(headers["Authorization"]).toBe("Bearer user-jwt-123");
    expect(headers["X-User-AAD-Object-Id"]).toBe("aad-1");
    expect(headers["X-User-Id"]).toBe("u1");
  });

  it("falls back to the static apiKey when no token provider is configured", async () => {
    const headers = await captureHeadersFor({ apiKey: "static-key" });
    expect(headers["Authorization"]).toBe("Bearer static-key");
  });

  it("falls back to apiKey when the token provider throws", async () => {
    const headers = await captureHeadersFor({
      getAuthToken: async () => {
        throw new Error("token service down");
      },
      apiKey: "fallback-key",
    });
    expect(headers["Authorization"]).toBe("Bearer fallback-key");
  });
});

describe("mapToolResult", () => {
  it("uses structuredContent that is a full query result", () => {
    const r = mapToolResult({
      structuredContent: { success: true, data: { type: "metrics", title: "M", metrics: [] } },
      content: [{ type: "text", text: "ignored" }],
    });
    expect(r.success).toBe(true);
    expect(r.data?.type).toBe("metrics");
  });

  it("wraps structuredContent that is only a data payload", () => {
    const r = mapToolResult({
      structuredContent: { type: "table", title: "T", columns: ["A"], rows: [["1"]] },
    });
    expect(r.success).toBe(true);
    expect(r.data?.type).toBe("table");
  });

  it("parses JSON embedded in a text content block", () => {
    const r = mapToolResult({
      content: [{ type: "text", text: JSON.stringify({ type: "metrics", title: "M", metrics: [] }) }],
    });
    expect(r.data?.type).toBe("metrics");
  });

  it("renders non-JSON plain text as a single-cell table", () => {
    const r = mapToolResult({ content: [{ type: "text", text: "hello world" }] });
    expect(r.success).toBe(true);
    expect(r.data?.type).toBe("table");
    expect(r.data?.rows?.[0]?.[0]).toBe("hello world");
  });

  it("maps image content to a base64 data URI", () => {
    const r = mapToolResult({
      content: [{ type: "image", data: "QUJD", mimeType: "image/png" }],
    });
    expect(r.data?.chartImageUrl).toBe("data:image/png;base64,QUJD");
  });

  it("maps isError to an unsuccessful result with the text as the error", () => {
    const r = mapToolResult({ isError: true, content: [{ type: "text", text: "boom" }] });
    expect(r.success).toBe(false);
    expect(r.error).toBe("boom");
  });

  it("returns an error for empty content", () => {
    const r = mapToolResult({ content: [] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });
});
