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

    const attachment: any = buildQueryResultCard(data, "revenue trend");
    const body = attachment.content.body as any[];

    const imageBlock = body.find((item) => item.type === "Image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock.url).toBe("https://example.com/chart.png");
    expect(imageBlock.altText).toBe("Revenue trend chart");
  });
});
