import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  IDataAgentClient,
  DataAgentQueryResult,
  DataAgentResponseData,
  ProgressUpdate,
} from "./dataAgentClient";
import { UserContext } from "../types";
import { createLogger } from "../logger";

const logger = createLogger("mcpClient");
const tracer = trace.getTracer("data-assistant-teams-bot");

/**
 * Optional async hook that returns a per-user bearer token for the Data Agent.
 * This is where a per-user Teams SSO / On-Behalf-Of token will be plugged in.
 * Until then, a static `apiKey` is used as a fallback.
 */
export type AuthTokenProvider = (
  userContext?: UserContext
) => Promise<string | undefined>;

export interface McpClientOptions {
  /** MCP server endpoint (Streamable HTTP). Ignored when `transportFactory` is supplied. */
  endpointUrl?: string;
  /** Name of the tool to invoke on the MCP server. Defaults to "query". */
  toolName?: string;
  /** Static fallback bearer token (used when `getAuthToken` is not provided). */
  apiKey?: string;
  /** Per-user token provider (SSO/OBO). Takes precedence over `apiKey`. */
  getAuthToken?: AuthTokenProvider;
  /** Per-request timeout in ms. Defaults to 45000. */
  requestTimeoutMs?: number;
  /**
   * Transport factory override — primarily for tests (in-memory transport).
   * Receives the resolved auth headers so HTTP transports can attach them.
   */
  transportFactory?: (headers: Record<string, string>) => Transport;
}

/**
 * Talks to the Data Agent over the Model Context Protocol (MCP) instead of a
 * plain REST call. A fresh client + transport is created per query so the bot
 * stays stateless; progress notifications emitted by the MCP tool are surfaced
 * via the `onProgress` callback (consumed by the Teams streaming UI).
 */
export class McpDataAgentClient implements IDataAgentClient {
  private readonly toolName: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: McpClientOptions) {
    this.toolName = options.toolName ?? "query";
    this.timeoutMs = options.requestTimeoutMs ?? 45000;
  }

  async query(
    question: string,
    userContext?: UserContext,
    onProgress?: (update: ProgressUpdate) => void
  ): Promise<DataAgentQueryResult> {
    return tracer.startActiveSpan(
      "dataAgent.mcp.query",
      { kind: SpanKind.CLIENT },
      async (span) => {
        span.setAttribute("dataAgent.query.text", question);
        span.setAttribute("dataAgent.user.id", userContext?.userId ?? "unknown");
        span.setAttribute("dataAgent.mcp.tool", this.toolName);
        const startTime = Date.now();

        const { client, transport } = await this.connect(userContext);
        try {
          const result = await client.callTool(
            { name: this.toolName, arguments: { question } },
            undefined,
            {
              timeout: this.timeoutMs,
              resetTimeoutOnProgress: true,
              onprogress: (p) => {
                onProgress?.({
                  message: p.message ?? "Working…",
                  progress: p.progress,
                  total: p.total,
                });
              },
            }
          );

          const mapped = mapToolResult(result);
          span.setAttribute("dataAgent.query.success", mapped.success);
          span.setAttribute("dataAgent.query.duration_ms", Date.now() - startTime);
          span.setStatus({ code: SpanStatusCode.OK });
          return mapped;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          if (err instanceof Error) span.recordException(err);
          throw err;
        } finally {
          await client.close().catch(() => {});
          await transport.close().catch(() => {});
          span.end();
        }
      }
    );
  }

  async healthCheck(): Promise<{ status: string; latency: number }> {
    const startTime = Date.now();
    try {
      const { client, transport } = await this.connect();
      try {
        await client.listTools();
        return { status: "healthy", latency: Date.now() - startTime };
      } finally {
        await client.close().catch(() => {});
        await transport.close().catch(() => {});
      }
    } catch {
      return { status: "unhealthy", latency: Date.now() - startTime };
    }
  }

  private async connect(
    userContext?: UserContext
  ): Promise<{ client: Client; transport: Transport }> {
    const headers = await this.buildHeaders(userContext);
    const transport = this.options.transportFactory
      ? this.options.transportFactory(headers)
      : this.buildHttpTransport(headers);

    const client = new Client({
      name: "data-assistant-teams-bot",
      version: "1.0.0",
    });
    await client.connect(transport);
    return { client, transport };
  }

  private buildHttpTransport(headers: Record<string, string>): Transport {
    if (!this.options.endpointUrl) {
      throw new Error(
        "McpDataAgentClient requires endpointUrl (or a transportFactory)"
      );
    }
    return new StreamableHTTPClientTransport(new URL(this.options.endpointUrl), {
      requestInit: { headers },
    });
  }

  private async buildHeaders(
    userContext?: UserContext
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    // Prefer the per-user Data Agent token resolved by the bot (Teams SSO + OBO);
    // fall back to the configured token provider, then the static API key.
    let token: string | undefined = userContext?.userToken;
    if (!token && this.options.getAuthToken) {
      try {
        token = await this.options.getAuthToken(userContext);
      } catch (err) {
        logger.warn("mcp.authToken.failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    token = token ?? this.options.apiKey;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    // User identity passthrough for RLS (until full per-user JWT support lands).
    if (userContext?.aadObjectId) {
      headers["X-User-AAD-Object-Id"] = userContext.aadObjectId;
    }
    if (userContext?.userId) headers["X-User-Id"] = userContext.userId;
    return headers;
  }
}

/**
 * Maps an MCP CallToolResult into the bot's `DataAgentQueryResult`.
 *
 * Order of preference (kept flexible because the Data Agent's concrete tool
 * contract may evolve): structuredContent → JSON in a text block → plain text →
 * image content. This is the single place to adapt to the real tool schema.
 */
export function mapToolResult(result: unknown): DataAgentQueryResult {
  const r = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  };

  if (r.isError) {
    return {
      success: false,
      error: firstText(r.content) ?? "The data agent returned an error.",
    };
  }

  const fromStructured = coerce(r.structuredContent);
  if (fromStructured) return fromStructured;

  const text = firstText(r.content);
  if (text) {
    try {
      const coerced = coerce(JSON.parse(text));
      if (coerced) return coerced;
    } catch {
      /* not JSON — fall through to plain-text rendering */
    }
    return {
      success: true,
      data: { type: "table", title: "Result", columns: ["Result"], rows: [[text]] },
    };
  }

  const image = firstImage(r.content);
  if (image) {
    return {
      success: true,
      data: {
        type: "timeseries",
        title: "Result",
        seriesLabels: [],
        series: [],
        chartImageUrl: image,
        chartAltText: "Chart",
      },
    };
  }

  return { success: false, error: "Empty response from the data agent." };
}

/** Coerce an unknown object into a DataAgentQueryResult, if it looks like one. */
function coerce(value: unknown): DataAgentQueryResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  // Already a full query result.
  if (typeof obj.success === "boolean") {
    return obj as unknown as DataAgentQueryResult;
  }
  // Just the data payload (has a known response `type`).
  if (obj.type === "table" || obj.type === "metrics" || obj.type === "timeseries") {
    return { success: true, data: obj as unknown as DataAgentResponseData };
  }
  return undefined;
}

function firstText(
  content?: Array<{ type: string; text?: string }>
): string | undefined {
  return content?.find((c) => c.type === "text" && typeof c.text === "string")?.text;
}

function firstImage(
  content?: Array<{ type: string; data?: string; mimeType?: string }>
): string | undefined {
  const img = content?.find((c) => c.type === "image" && c.data);
  if (!img?.data) return undefined;
  return `data:${img.mimeType ?? "image/png"};base64,${img.data}`;
}

export function createMcpDataAgentClient(): McpDataAgentClient {
  const endpointUrl =
    process.env.MCP_ENDPOINT_URL || process.env.DATA_AGENT_API_BASE_URL;
  if (!endpointUrl) {
    throw new Error(
      "MCP_ENDPOINT_URL (or DATA_AGENT_API_BASE_URL) is required when DATA_AGENT_CLIENT=mcp"
    );
  }
  return new McpDataAgentClient({
    endpointUrl,
    toolName: process.env.MCP_TOOL_NAME || "query",
    apiKey: process.env.DATA_AGENT_API_KEY,
    requestTimeoutMs: parseInt(process.env.DATA_AGENT_TIMEOUT_MS || "45000", 10),
  });
}
