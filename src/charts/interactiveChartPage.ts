import { StoredChart } from "../services/interactiveChart";

// Plotly gives us zoom/pan/hover/download out of the box from a single script.
const PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Embed JSON inside a <script> safely by neutralizing any "</script>" breakout.
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Pure renderer: turns a stored time-series into a self-contained, interactive
 * HTML chart page. No bot/SDK dependencies, so it is trivially unit-testable.
 */
export function renderInteractiveChartHtml(chart: StoredChart): string {
  const title = escapeHtml(chart.title || "Interactive chart");
  const labels = chart.seriesLabels ?? [];
  const isBar = chart.chartType === "bar";

  const traces = (chart.series ?? []).map((s) => ({
    type: isBar ? "bar" : "scatter",
    mode: isBar ? undefined : "lines+markers",
    name: s.label,
    x: labels,
    y: s.values,
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<script src="${PLOTLY_CDN}" charset="utf-8"></script>
<style>
  html,body{margin:0;padding:0;height:100%;font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#242424}
  header{padding:14px 18px;border-bottom:1px solid #edebe9}
  h1{margin:0;font-size:16px;font-weight:600}
  #chart{width:100%;height:calc(100% - 52px)}
  .empty{padding:24px;color:#605e5c}
</style>
</head>
<body>
<header><h1>${title}</h1></header>
<div id="chart"></div>
<script>
  var traces = ${safeJson(traces)};
  var layout = {
    margin:{t:24,r:24,b:48,l:56},
    legend:{orientation:"h"},
    hovermode:"x unified"
  };
  var config = {responsive:true,displaylogo:false};
  if (!traces.length) {
    document.getElementById("chart").innerHTML =
      '<div class="empty">No chart data available.</div>';
  } else if (window.Plotly) {
    Plotly.newPlot("chart", traces, layout, config);
  }
</script>
</body>
</html>`;
}
