/**
 * Dumps representative Adaptive Card payloads to ./card-previews/*.json for
 * inspection and sharing.
 *
 *   npm run card:preview
 *
 * NOTE: the native chart elements (Chart.Line / Chart.VerticalBar) only render
 * in the Microsoft Teams client. Most generic Adaptive Card previewers will show
 * them as an unknown element — see the README "Viewing changes in Teams" section.
 */
import * as fs from "fs";
import * as path from "path";
import { buildQueryResultCard } from "../src/cards/queryResultCard";
import { getMockDataAgentResponse } from "../src/services/mockDataAgentClient";
import { DataAgentResponseData } from "../src/services/dataAgentClient";

const outDir = path.resolve(process.cwd(), "card-previews");
fs.mkdirSync(outDir, { recursive: true });

const barData: DataAgentResponseData = {
  type: "timeseries",
  title: "Quarterly Revenue (FY25)",
  chartType: "bar",
  seriesLabels: ["Q1", "Q2", "Q3", "Q4"],
  series: [{ label: "Revenue ($B)", values: [30.5, 31.2, 32.8, 34.1] }],
};

const samples: { name: string; data: DataAgentResponseData; nativeCharts: boolean }[] = [
  { name: "table", data: getMockDataAgentResponse("revenue by region").data!, nativeCharts: true },
  { name: "metrics", data: getMockDataAgentResponse("total revenue").data!, nativeCharts: true },
  { name: "line-chart", data: getMockDataAgentResponse("monthly revenue trend").data!, nativeCharts: true },
  { name: "bar-chart", data: barData, nativeCharts: true },
  { name: "image-fallback", data: getMockDataAgentResponse("monthly revenue trend").data!, nativeCharts: false },
];

for (const s of samples) {
  const card = buildQueryResultCard(s.data, s.name, { nativeCharts: s.nativeCharts }) as {
    content: { body: { type: string }[] };
  };
  const file = path.join(outDir, `${s.name}.json`);
  fs.writeFileSync(file, JSON.stringify(card.content, null, 2));
  const types = card.content.body.map((b) => b.type).join(", ");
  // eslint-disable-next-line no-console
  console.log(`${s.name.padEnd(16)} -> ${path.relative(process.cwd(), file)}  [${types}]`);
}

// eslint-disable-next-line no-console
console.log(`\nWrote ${samples.length} card payloads to ${path.relative(process.cwd(), outDir)}/`);
