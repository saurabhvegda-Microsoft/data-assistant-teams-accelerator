import { CardFactory } from "@microsoft/agents-hosting";
import { DataAgentResponseData } from "../services/dataAgentClient";

export interface CardRenderOptions {
  /**
   * Render Teams native Adaptive Card charts (`Chart.Line` / `Chart.VerticalBar`)
   * for time-series data. Defaults to the `NATIVE_CHARTS_ENABLED` env flag.
   * When disabled, falls back to the static `chartImageUrl` image.
   */
  nativeCharts?: boolean;
}

function nativeChartsEnabled(): boolean {
  return (process.env.NATIVE_CHARTS_ENABLED ?? "true") !== "false";
}

function buildStatelessFooter(): any {
  return {
    type: "ColumnSet",
    spacing: "Medium",
    separator: true,
    columns: [
      {
        type: "Column",
        width: "auto",
        items: [
          {
            type: "TextBlock",
            text: "\uD83D\uDEE1\uFE0F Stateless",
            color: "Good",
            size: "Small",
            weight: "Bolder",
            spacing: "None",
          },
        ],
      },
      {
        type: "Column",
        width: "stretch",
        items: [
          {
            type: "TextBlock",
            text: "No conversation history sent to backend",
            isSubtle: true,
            size: "Small",
            spacing: "None",
          },
        ],
      },
    ],
  };
}

export function buildQueryResultCard(
  data: DataAgentResponseData,
  query: string,
  options: CardRenderOptions = {}
) {
  const useNativeCharts = options.nativeCharts ?? nativeChartsEnabled();
  switch (data.type) {
    case "table":
      return buildTableCard(data, query);
    case "metrics":
      return buildMetricsCard(data, query);
    case "timeseries":
      return buildTimeseriesCard(data, query, useNativeCharts);
    default:
      return buildTableCard(data, query);
  }
}

function buildTableCard(data: DataAgentResponseData, query: string) {
  const columns = data.columns || [];
  const rows = data.rows || [];

  const body: any[] = [
    {
      type: "TextBlock",
      text: data.title,
      weight: "Bolder",
      size: "Medium",
      wrap: true,
    },
  ];

  if (columns.length > 0) {
    body.push(...buildTabularSections(columns, rows));
  } else {
    body.push({
      type: "TextBlock",
      text: "No tabular data available.",
      isSubtle: true,
      wrap: true,
    });
  }

  body.push(buildStatelessFooter());

  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body,
    actions: buildActions(data.sql, query),
  };

  return CardFactory.adaptiveCard(card);
}

function buildMetricsCard(
  data: DataAgentResponseData,
  query: string
) {
  const metricItems = (data.metrics || []).map((m) => {
    const items: any[] = [
      { type: "TextBlock", text: m.label, size: "Small", isSubtle: true, spacing: "None" },
      { type: "TextBlock", text: m.value, weight: "Bolder", size: "Large", spacing: "None" },
    ];
    if (m.change) {
      const color = m.change.startsWith("+") ? "Good" : m.change.startsWith("-") ? "Attention" : "Default";
      items.push({
        type: "TextBlock",
        text: m.change,
        color,
        size: "Small",
        spacing: "None",
      });
    }
    return {
      type: "Column",
      width: "stretch",
      items,
    };
  });

  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      {
        type: "TextBlock",
        text: data.title,
        weight: "Bolder",
        size: "Medium",
        wrap: true,
      },
      {
        type: "ColumnSet",
        columns: metricItems,
      },
      buildStatelessFooter(),
    ],
    actions: buildActions(data.sql, query),
  };

  return CardFactory.adaptiveCard(card);
}

function buildTimeseriesCard(
  data: DataAgentResponseData,
  query: string,
  useNativeCharts: boolean
) {
  const labels = data.seriesLabels || [];
  const seriesColumns = ["Series", ...labels];
  const seriesRows = (data.series || []).map((s) => [s.label, ...s.values.map((v) => String(v))]);

  const body: any[] = [
    {
      type: "TextBlock",
      text: data.title,
      weight: "Bolder",
      size: "Medium",
      wrap: true,
    },
  ];

  const nativeChart = useNativeCharts ? buildNativeChart(data) : undefined;
  if (nativeChart) {
    body.push(nativeChart);
  } else if (data.chartImageUrl) {
    body.push({
      type: "Image",
      url: data.chartImageUrl,
      altText: data.chartAltText || data.title,
      size: "Stretch",
      horizontalAlignment: "Left",
      spacing: "Medium",
    });
  }

  if (labels.length > 0 && seriesRows.length > 0) {
    body.push(...buildTabularSections(seriesColumns, seriesRows));
  } else {
    body.push({
      type: "TextBlock",
      text: "No series data available.",
      isSubtle: true,
      wrap: true,
    });
  }

  body.push(buildStatelessFooter());

  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body,
    actions: buildActions(data.sql, query),
  };

  return CardFactory.adaptiveCard(card);
}

/**
 * Builds a Teams native Adaptive Card chart element from time-series data.
 * Multi-series → `Chart.Line`; single-series with `chartType: "bar"` →
 * `Chart.VerticalBar`. Returns undefined when there is no plottable data.
 *
 * Schema matches Microsoft's Teams chart samples: `Chart.Line` uses
 * `data: [{ legend, values: [{ x, y }] }]`; `Chart.VerticalBar` uses
 * `data: [{ x, y }]`.
 */
function buildNativeChart(data: DataAgentResponseData): any | undefined {
  const series = data.series || [];
  const labels = data.seriesLabels || [];
  if (series.length === 0 || labels.length === 0) return undefined;

  const base = { title: data.title, colorSet: "categorical" };

  if (data.chartType === "bar" && series.length === 1) {
    return {
      type: "Chart.VerticalBar",
      ...base,
      data: series[0].values.map((y, i) => ({ x: labels[i] ?? String(i), y })),
    };
  }

  return {
    type: "Chart.Line",
    ...base,
    data: series.map((s) => ({
      legend: s.label,
      values: s.values.map((y, i) => ({ x: labels[i] ?? String(i), y })),
    })),
  };
}

function buildTabularSections(columns: string[], rows: (string | number)[][]): any[] {
  const maxRows = 10;
  const normalizedRows = rows.slice(0, maxRows).map((row) => columns.map((_, index) => String(row[index] ?? "-")));

  const header = {
    type: "ColumnSet",
    spacing: "Medium",
    columns: columns.map((col) => ({
      type: "Column",
      width: "stretch",
      items: [
        {
          type: "TextBlock",
          text: col,
          weight: "Bolder",
          size: "Small",
          wrap: true,
        },
      ],
    })),
  };

  const dataRows = normalizedRows.map((row) => ({
    type: "ColumnSet",
    spacing: "Small",
    separator: true,
    columns: row.map((cell, index) => ({
      type: "Column",
      width: "stretch",
      items: [
        {
          type: "TextBlock",
          text: cell,
          size: "Small",
          weight: index === 0 ? "Bolder" : "Default",
          wrap: true,
        },
      ],
    })),
  }));

  const sections: any[] = [header, ...dataRows];
  if (rows.length > maxRows) {
    sections.push({
      type: "TextBlock",
      text: `Showing first ${maxRows} rows out of ${rows.length}.`,
      isSubtle: true,
      size: "Small",
      wrap: true,
      spacing: "Medium",
    });
  }

  return sections;
}

function buildActions(sql?: string, query?: string): any[] {
  const actions: any[] = [];

  if (sql) {
    actions.push({
      type: "Action.ShowCard",
      title: "Show SQL",
      card: {
        type: "AdaptiveCard",
        body: [
          {
            type: "TextBlock",
            text: "```sql\n" + sql + "\n```",
            wrap: true,
            fontType: "Monospace",
            size: "Small",
          },
        ],
      },
    });
  }

  return actions;
}
