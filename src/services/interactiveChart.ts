import { DataAgentResponseData } from "./dataAgentClient";
import { createLogger } from "../logger";

const logger = createLogger("interactiveChart");

export interface StoredChart {
  title: string;
  seriesLabels: string[];
  series: { label: string; values: number[] }[];
  chartType: "line" | "bar";
  createdAt: number;
}

const MAX_CHARTS = 200;
const TTL_MS = 30 * 60 * 1000; // 30 minutes

// Ephemeral render cache for interactive chart pages. This is NOT conversation
// state: it holds only the numeric series needed to re-render a chart the user
// already received, keyed by an opaque id, evicted by size/TTL. The bot still
// sends no conversation history to the backend.
const store = new Map<string, StoredChart>();

export function interactiveChartsEnabled(): boolean {
  return process.env.INTERACTIVE_CHARTS_ENABLED === "true";
}

/** Absolute base URL used to build interactive-chart links (bot FQDN / dev tunnel). */
export function getPublicBaseUrl(): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  const base =
    explicit && explicit.length > 0
      ? explicit
      : `http://localhost:${process.env.PORT || 3978}`;
  return base.replace(/\/+$/, "");
}

function evictIfNeeded(): void {
  const now = Date.now();
  for (const [id, chart] of store) {
    if (now - chart.createdAt > TTL_MS) store.delete(id);
  }
  while (store.size >= MAX_CHARTS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Stores plottable time-series so it can be rendered at /charts/:id. */
export function registerChart(data: DataAgentResponseData): string {
  evictIfNeeded();
  const id = newId();
  store.set(id, {
    title: data.title,
    seriesLabels: data.seriesLabels ?? [],
    series: data.series ?? [],
    chartType: data.chartType === "bar" ? "bar" : "line",
    createdAt: Date.now(),
  });
  logger.info("chart.registered", { id, series: data.series?.length ?? 0 });
  return id;
}

export function getChart(id: string): StoredChart | undefined {
  const chart = store.get(id);
  if (!chart) return undefined;
  if (Date.now() - chart.createdAt > TTL_MS) {
    store.delete(id);
    return undefined;
  }
  return chart;
}

/**
 * Resolves the URL for the "Open interactive chart" action, or undefined when
 * there is nothing interactive to show. The whole capability is gated by
 * INTERACTIVE_CHARTS_ENABLED (defaults off → original behavior).
 *   1. If the Data Agent supplied its own hosted chart (`interactiveChartUrl`),
 *      link to it directly.
 *   2. Otherwise, for plottable time-series, register it and link to the
 *      bot-hosted `/charts/:id` page.
 */
export function resolveInteractiveChartUrl(
  data: DataAgentResponseData
): string | undefined {
  if (!interactiveChartsEnabled()) return undefined;

  const supplied = data.interactiveChartUrl?.trim();
  if (supplied) return supplied;

  if (data.type !== "timeseries") return undefined;
  const hasData =
    (data.series?.length ?? 0) > 0 && (data.seriesLabels?.length ?? 0) > 0;
  if (!hasData) return undefined;

  const id = registerChart(data);
  return `${getPublicBaseUrl()}/charts/${id}`;
}

/** Test-only: clear the in-memory store between cases. */
export function _clearChartStore(): void {
  store.clear();
}
