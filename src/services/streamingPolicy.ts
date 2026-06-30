/**
 * Pure policy for streamed-progress UX, so the bot's behavior is testable
 * without loading the Agents SDK.
 *
 * - `streamingEnabled`: master toggle for the in-place "working" indicator.
 * - `verboseThoughtsEnabled`: when true, EACH MCP progress step is relayed as
 *   its own update (chatty). Default false → a single "Working on your
 *   question…" status until the result is ready (minimizes what is shown
 *   between the prompt and the result).
 */
type Env = Record<string, string | undefined>;

export function streamingEnabled(env: Env = process.env): boolean {
  return (env.STREAMING_ENABLED ?? "true") !== "false";
}

export function verboseThoughtsEnabled(env: Env = process.env): boolean {
  return (env.STREAMING_THOUGHTS_ENABLED ?? "false") === "true";
}
