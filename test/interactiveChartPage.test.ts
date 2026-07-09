import { renderInteractiveChartHtml } from "../src/charts/interactiveChartPage";
import { StoredChart } from "../src/services/interactiveChart";

const chart: StoredChart = {
  title: "Monthly Revenue",
  seriesLabels: ["Jan", "Feb", "Mar"],
  series: [
    { label: "Revenue", values: [10, 12, 14] },
    { label: "Target", values: [9, 11, 13] },
  ],
  chartType: "line",
  createdAt: Date.now(),
};

describe("renderInteractiveChartHtml", () => {
  it("produces a self-contained HTML document with Plotly", () => {
    const html = renderInteractiveChartHtml(chart);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("cdn.plot.ly/plotly");
    expect(html).toContain("Plotly.newPlot");
  });

  it("embeds the series data and title", () => {
    const html = renderInteractiveChartHtml(chart);
    expect(html).toContain("Monthly Revenue");
    expect(html).toContain('"Revenue"');
    expect(html).toContain("lines+markers");
    expect(html).toContain("[10,12,14]");
  });

  it("uses bar traces for bar charts", () => {
    const html = renderInteractiveChartHtml({
      ...chart,
      chartType: "bar",
      series: [chart.series[0]],
    });
    expect(html).toContain('"type":"bar"');
  });

  it("escapes HTML in the title to prevent injection", () => {
    const html = renderInteractiveChartHtml({ ...chart, title: "<script>x</script>" });
    expect(html).not.toContain("<title><script>x</script></title>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("neutralizes a </script> breakout in embedded JSON", () => {
    const html = renderInteractiveChartHtml({
      ...chart,
      series: [{ label: "</script>", values: [1] }],
    });
    expect(html).toContain("\\u003c/script>");
  });

  it("renders an empty-state when there is no series", () => {
    const html = renderInteractiveChartHtml({ ...chart, series: [] });
    expect(html).toContain("No chart data available.");
  });
});
