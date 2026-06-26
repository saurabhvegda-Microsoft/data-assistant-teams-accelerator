import axios from "axios";
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { MockDataAgentClient } from "./mockDataAgentClient";
import { createMcpDataAgentClient } from "./mcpDataAgentClient";
import { UserContext } from "../types";

const tracer = trace.getTracer("data-assistant-teams-bot");

export interface DataAgentQueryResult {
  success: boolean;
  data?: DataAgentResponseData;
  error?: string;
  suggestions?: string[];
}

export interface DataAgentResponseData {
  type: "table" | "metrics" | "timeseries";
  title: string;
  sql?: string;
  columns?: string[];
  rows?: (string | number)[][];
  metrics?: { label: string; value: string; change?: string }[];
  series?: { label: string; values: number[] }[];
  seriesLabels?: string[];
  chartType?: "line" | "bar";
  chartImageUrl?: string;
  chartAltText?: string;
}

export interface ProgressUpdate {
  message: string;
  progress?: number;
  total?: number;
}

export interface IDataAgentClient {
  query(
    question: string,
    userContext?: UserContext,
    onProgress?: (update: ProgressUpdate) => void
  ): Promise<DataAgentQueryResult>;
  healthCheck(): Promise<{ status: string; latency: number }>;
}

export class DataAgentClient implements IDataAgentClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  async query(
    question: string,
    userContext?: UserContext,
    _onProgress?: (update: ProgressUpdate) => void
  ): Promise<DataAgentQueryResult> {
    return tracer.startActiveSpan("dataAgent.api.query", { kind: SpanKind.CLIENT }, async (span) => {
      span.setAttribute("dataAgent.query.text", question);
      span.setAttribute("dataAgent.user.id", userContext?.userId ?? "unknown");
      const startTime = Date.now();

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (this.apiKey) {
          headers["Authorization"] = `Bearer ${this.apiKey}`;
        }
        if (userContext?.aadObjectId) {
          headers["X-User-AAD-Object-Id"] = userContext.aadObjectId;
        }
        if (userContext?.userId) {
          headers["X-User-Id"] = userContext.userId;
        }
        // Enforce stateless processing for every request.
        headers["X-Conversation-Context"] = "single-turn";
        headers["X-History-Policy"] = "none";

        const response = await axios.post(
          `${this.baseUrl}/api/query`,
          { question },
          { headers, timeout: 45000 }
        );

        const result: DataAgentQueryResult = response.data;
        span.setAttribute("dataAgent.query.success", result.success);
        span.setAttribute("dataAgent.query.duration_ms", Date.now() - startTime);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        if (err instanceof Error) span.recordException(err);
        span.setAttribute("dataAgent.query.duration_ms", Date.now() - startTime);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  async healthCheck(): Promise<{ status: string; latency: number }> {
    const startTime = Date.now();
    try {
      await axios.get(`${this.baseUrl}/api/health`, { timeout: 5000 });
      return { status: "healthy", latency: Date.now() - startTime };
    } catch {
      return { status: "unhealthy", latency: Date.now() - startTime };
    }
  }
}

/**
 * Selects the Data Agent client.
 *
 * `DATA_AGENT_CLIENT` (mock | rest | mcp) takes precedence when set. When it is
 * not set, the legacy `USE_MOCK_CLIENT` behavior is preserved for backward
 * compatibility (mock unless USE_MOCK_CLIENT=false, then REST).
 */
export function createDataAgentClient(): IDataAgentClient {
  const explicit = (process.env.DATA_AGENT_CLIENT || "").toLowerCase();

  if (explicit === "mock") return new MockDataAgentClient();
  if (explicit === "mcp") return createMcpDataAgentClient();
  if (explicit === "rest") return createRestClient();

  const useMock = process.env.USE_MOCK_CLIENT !== "false";
  if (useMock) return new MockDataAgentClient();
  return createRestClient();
}

function createRestClient(): IDataAgentClient {
  const baseUrl = process.env.DATA_AGENT_API_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "DATA_AGENT_API_BASE_URL is required when USE_MOCK_CLIENT is false"
    );
  }
  return new DataAgentClient(baseUrl, process.env.DATA_AGENT_API_KEY);
}
