import { DataAgentResponseData } from "./dataAgentClient";
import { getPublicBaseUrl } from "./interactiveChart";
import { createLogger } from "../logger";

const logger = createLogger("resultExport");

/**
 * Hosted export of a tabular result, so large or slow answers can be delivered
 * as a downloadable CSV / an HTML table link instead of an oversized card.
 *
 * This is NOT conversation state: it holds only the columns/rows of a result
 * the user already asked for, keyed by an opaque id, evicted by size/TTL.
 * Mirrors `interactiveChart` (same store/TTL/eviction shape).
 */
export interface StoredResult {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  createdAt: number;
}

const MAX_RESULTS = 200;
const TTL_MS = 30 * 60 * 1000; // 30 minutes
const store = new Map<string, StoredResult>();

type Env = Record<string, string | undefined>;

/** Master flag for hosted result exports (CSV / HTML link). Default off. */
export function resultExportEnabled(env: Env = process.env): boolean {
  return env.RESULT_EXPORT_ENABLED === "true";
}

/**
 * Row count above which a result is "too large for the card frame" and is
 * offered as a downloadable file / link instead. Default 25.
 */
export function largeResultThreshold(env: Env = process.env): number {
  const parsed = parseInt(env.LARGE_RESULT_ROWS ?? "25", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
}

/**
 * Elapsed time (ms) above which a query is "long-running" and its result is
 * delivered as an HTML link (à la Shelly's email) rather than inline. Default 90s.
 */
export function longRunningThresholdMs(env: Env = process.env): number {
  const parsed = parseInt(env.LONG_RUNNING_MS ?? "90000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90000;
}

/** True when a result has more rows than the card should display inline. */
export function isLargeResult(data: DataAgentResponseData, env: Env = process.env): boolean {
  const rows = data.rows ?? [];
  return rows.length > largeResultThreshold(env);
}

/** True when a query ran long enough to warrant link-delivery. */
export function isLongRunning(elapsedMs: number, env: Env = process.env): boolean {
  return elapsedMs > longRunningThresholdMs(env);
}

function evictIfNeeded(): void {
  const now = Date.now();
  for (const [id, result] of store) {
    if (now - result.createdAt > TTL_MS) store.delete(id);
  }
  while (store.size >= MAX_RESULTS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Stores a tabular result so it can be served at /results/:id(.csv). */
export function registerResult(data: DataAgentResponseData): string {
  evictIfNeeded();
  const id = newId();
  store.set(id, {
    title: data.title,
    columns: data.columns ?? [],
    rows: data.rows ?? [],
    createdAt: Date.now(),
  });
  logger.info("result.registered", { id, rows: data.rows?.length ?? 0 });
  return id;
}

export function getResult(id: string): StoredResult | undefined {
  const result = store.get(id);
  if (!result) return undefined;
  if (Date.now() - result.createdAt > TTL_MS) {
    store.delete(id);
    return undefined;
  }
  return result;
}

/** Hosted links for a stored result: `{ csvUrl, htmlUrl }`. */
export interface ResultExportUrls {
  csvUrl: string;
  htmlUrl: string;
}

/**
 * Registers `data` and returns hosted CSV + HTML links when result export is
 * enabled AND the result is large (rows > threshold), or when `force` is set
 * (used for long-running queries regardless of size). Returns undefined
 * otherwise, so small results and disabled deployments are unchanged.
 */
export function resolveResultExportUrls(
  data: DataAgentResponseData,
  env: Env = process.env,
  opts: { force?: boolean } = {}
): ResultExportUrls | undefined {
  if (!resultExportEnabled(env)) return undefined;
  if (data.type !== "table" && data.type !== "metrics") return undefined;
  if (!opts.force && !isLargeResult(data, env)) return undefined;
  if (!data.columns?.length || !data.rows?.length) return undefined;

  const id = registerResult(data);
  const base = getPublicBaseUrl();
  return { csvUrl: `${base}/results/${id}.csv`, htmlUrl: `${base}/results/${id}` };
}

/** Serializes columns/rows to CSV (RFC-4180 quoting). */
export function toCsv(columns: string[], rows: (string | number)[][]): string {
  const escape = (value: string | number): string => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(escape).join(",")];
  for (const row of rows) {
    lines.push(columns.map((_, i) => escape(row[i] ?? "")).join(","));
  }
  return lines.join("\r\n");
}

function escapeHtml(value: string | number): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Renders a stored result as a standalone HTML table page. */
export function renderResultHtml(result: StoredResult): string {
  const head = result.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = result.rows
    .map(
      (row) =>
        `<tr>${result.columns.map((_, i) => `<td>${escapeHtml(row[i] ?? "")}</td>`).join("")}</tr>`
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(result.title)}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; margin: 24px; color: #242424; }
  h1 { font-size: 18px; }
  .meta { color: #616161; font-size: 13px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #e0e0e0; padding: 6px 10px; text-align: left; }
  th { background: #f5f5f5; position: sticky; top: 0; }
  tr:nth-child(even) td { background: #fafafa; }
</style>
</head>
<body>
  <h1>${escapeHtml(result.title)}</h1>
  <div class="meta">${result.rows.length} rows &middot; ${result.columns.length} columns</div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`;
}

/** Test-only: clear the in-memory store between cases. */
export function _clearResultStore(): void {
  store.clear();
}
