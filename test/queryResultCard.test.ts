jest.mock("@microsoft/agents-hosting", () => ({
  CardFactory: {
    adaptiveCard: (card: any) => ({
      contentType: "application/vnd.microsoft.card.adaptive",
      content: card,
    }),
  },
}));

import { buildQueryResultCard } from "../src/cards/queryResultCard";
import { DataAgentResponseData } from "../src/services/dataAgentClient";

describe("buildQueryResultCard", () => {
  it("renders table responses using Teams-compatible ColumnSet rows", () => {
    const data: DataAgentResponseData = {
      type: "table",
      title: "Revenue by Region",
      columns: ["Region", "Revenue"],
      rows: [["NA", 100], ["EMEA", 90]],
      sql: "SELECT * FROM revenue",
    };

    const attachment: any = buildQueryResultCard(data, "revenue by region");
    expect(attachment.contentType).toContain("adaptive");

    const body = attachment.content.body as any[];
    expect(body.some((item) => item.type === "ColumnSet")).toBe(true);
    expect(body.some((item) => item.type === "Table")).toBe(false);
  });

  it("renders timeseries chart image when backend provides chartImageUrl", () => {
    const data: DataAgentResponseData = {
      type: "timeseries",
      title: "Revenue Trend",
      seriesLabels: ["Jan", "Feb"],
      series: [{ label: "Revenue", values: [10, 12] }],
      chartImageUrl: "https://example.com/chart.png",
      chartAltText: "Revenue trend chart",
    };

    const attachment: any = buildQueryResultCard(data, "revenue trend", { nativeCharts: false });
    const body = attachment.content.body as any[];

    const imageBlock = body.find((item) => item.type === "Image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock.url).toBe("https://example.com/chart.png");
    expect(imageBlock.altText).toBe("Revenue trend chart");
  });

  it("renders a native Chart.Line for multi-series timeseries by default", () => {
    const data: DataAgentResponseData = {
      type: "timeseries",
      title: "Monthly Revenue",
      seriesLabels: ["Jan", "Feb", "Mar"],
      series: [
        { label: "Revenue", values: [10, 12, 14] },
        { label: "Target", values: [9, 11, 13] },
      ],
      chartImageUrl: "https://example.com/chart.png",
    };

    const attachment: any = buildQueryResultCard(data, "revenue", { nativeCharts: true });
    const body = attachment.content.body as any[];

    const chart = body.find((item) => item.type === "Chart.Line");
    expect(chart).toBeDefined();
    expect(chart.colorSet).toBe("categorical");
    expect(chart.data).toHaveLength(2);
    expect(chart.data[0].legend).toBe("Revenue");
    expect(chart.data[0].values[0]).toEqual({ x: "Jan", y: 10 });
    // Native chart is preferred over the static image…
    expect(body.find((item) => item.type === "Image")).toBeUndefined();
    // …but the accessible data table is still rendered.
    expect(body.some((item) => item.type === "ColumnSet")).toBe(true);
  });

  it("renders a native Chart.VerticalBar for single-series bar charts", () => {
    const data: DataAgentResponseData = {
      type: "timeseries",
      title: "Quarterly Revenue",
      chartType: "bar",
      seriesLabels: ["Q1", "Q2", "Q3", "Q4"],
      series: [{ label: "Revenue", values: [30, 31, 32, 34] }],
    };

    const attachment: any = buildQueryResultCard(data, "quarterly", { nativeCharts: true });
    const body = attachment.content.body as any[];

    const chart = body.find((item) => item.type === "Chart.VerticalBar");
    expect(chart).toBeDefined();
    expect(chart.data).toHaveLength(4);
    expect(chart.data[0]).toEqual({ x: "Q1", y: 30 });
  });

  it("uses Chart.Line for multi-series data even when bar is requested", () => {
    const data: DataAgentResponseData = {
      type: "timeseries",
      title: "Multi",
      chartType: "bar",
      seriesLabels: ["A", "B"],
      series: [
        { label: "S1", values: [1, 2] },
        { label: "S2", values: [3, 4] },
      ],
    };

    const attachment: any = buildQueryResultCard(data, "q", { nativeCharts: true });
    const body = attachment.content.body as any[];

    expect(body.find((item) => item.type === "Chart.Line")).toBeDefined();
    expect(body.find((item) => item.type === "Chart.VerticalBar")).toBeUndefined();
  });

  it("adds a New conversation action and a contextual footer when history is enabled", () => {
    process.env.CONVERSATION_HISTORY_ENABLED = "true";
    try {
      const data: DataAgentResponseData = {
        type: "table",
        title: "t",
        columns: ["A"],
        rows: [["1"]],
        sql: "SELECT 1",
      };
      const attachment: any = buildQueryResultCard(data, "q");
      const actions = attachment.content.actions as any[];
      expect(
        actions.some(
          (a) => a.type === "Action.Submit" && a.data?.action === "newConversation"
        )
      ).toBe(true);
      expect(JSON.stringify(attachment.content.body)).toContain("Contextual");
    } finally {
      delete process.env.CONVERSATION_HISTORY_ENABLED;
    }
  });
});
