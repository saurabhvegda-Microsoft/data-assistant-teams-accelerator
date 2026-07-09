import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getMockDataAgentResponse } from "../services/mockDataAgentClient";

const PROGRESS_STEPS = [
  "Understanding your question…",
  "Generating SQL…",
  "Querying the data warehouse…",
  "Formatting results…",
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Builds an in-process mock MCP server that mirrors the contract we expect from
 * the real Financial Data Agent: a single `query` tool that emits progress
 * notifications while it works and returns the result as both human-readable
 * text and `structuredContent`. Used by the local HTTP host (tools/mockMcpServer.ts)
 * and by unit tests via an in-memory transport.
 */
export function buildMockMcpServer(): McpServer {
  const server = new McpServer({ name: "mock-data-agent", version: "1.0.0" });

  server.registerTool(
    "query",
    {
      title: "Query financial data",
      description:
        "Ask a natural-language financial data question and receive structured results.",
      inputSchema: { question: z.string() },
    },
    async ({ question }, extra) => {
      const progressToken = extra._meta?.progressToken;
      if (progressToken !== undefined) {
        for (let i = 0; i < PROGRESS_STEPS.length; i++) {
          await extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: i + 1,
              total: PROGRESS_STEPS.length,
              message: PROGRESS_STEPS[i],
            },
          });
          await delay(25);
        }
      }

      const result = getMockDataAgentResponse(question);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }
  );

  return server;
}
