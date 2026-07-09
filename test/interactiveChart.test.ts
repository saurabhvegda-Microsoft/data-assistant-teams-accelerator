import {
  interactiveChartsEnabled,
  getPublicBaseUrl,
  registerChart,
  getChart,
  resolveInteractiveChartUrl,
  _clearChartStore,
} from "../src/services/interactiveChart";
import { DataAgentResponseData } from "../src/services/dataAgentClient";
import { getMockDataAgentResponse } from "../src/services/mockDataAgentClient";

const timeseries: DataAgentResponseData = {
  type: "timeseries",
  title: "Trend",
  seriesLabels: ["Jan", "Feb"],
  series: [{ label: "Revenue", values: [10, 12] }],
};

describe("interactiveChart service", () => {
  const savedEnabled = process.env.INTERACTIVE_CHARTS_ENABLED;
  const savedBase = process.env.PUBLIC_BASE_URL;

  afterEach(() => {
    _clearChartStore();
    if (savedEnabled === undefined) delete process.env.INTERACTIVE_CHARTS_ENABLED;
    else process.env.INTERACTIVE_CHARTS_ENABLED = savedEnabled;
    if (savedBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = savedBase;
  });

  it("interactiveChartsEnabled reflects the env flag", () => {
    process.env.INTERACTIVE_CHARTS_ENABLED = "true";
    expect(interactiveChartsEnabled()).toBe(true);
    process.env.INTERACTIVE_CHARTS_ENABLED = "false";
    expect(interactiveChartsEnabled()).toBe(false);
    delete process.env.INTERACTIVE_CHARTS_ENABLED;
    expect(interactiveChartsEnabled()).toBe(false);
  });

  it("getPublicBaseUrl trims trailing slashes and falls back to localhost", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(getPublicBaseUrl()).toMatch(/^http:\/\/localhost:\d+$/);
    process.env.PUBLIC_BASE_URL = "https://bot.example.com/";
    expect(getPublicBaseUrl()).toBe("https://bot.example.com");
  });

  it("registerChart + getChart round-trips the series", () => {
    const id = registerChart(timeseries);
    const stored = getChart(id);
    expect(stored).toBeDefined();
    expect(stored!.title).toBe("Trend");
    expect(stored!.series[0].values).toEqual([10, 12]);
    expect(stored!.chartType).toBe("line");
  });

  it("getChart returns undefined for unknown ids", () => {
    expect(getChart("does-not-exist")).toBeUndefined();
  });

  it("resolveInteractiveChartUrl returns undefined when the flag is off", () => {
    process.env.INTERACTIVE_CHARTS_ENABLED = "false";
    expect(resolveInteractiveChartUrl(timeseries)).toBeUndefined();
  });

  it("builds a bot-hosted /charts/:id URL for timeseries when enabled", () => {
    process.env.INTERACTIVE_CHARTS_ENABLED = "true";
    process.env.PUBLIC_BASE_URL = "https://bot.example.com";
    const url = resolveInteractiveChartUrl(timeseries);
    expect(url).toMatch(/^https:\/\/bot\.example\.com\/charts\/[a-z0-9]+$/);
    const id = url!.split("/").pop()!;
    expect(getChart(id)).toBeDefined();
  });

  it("prefers a Data Agent-supplied interactiveChartUrl", () => {
    process.env.INTERACTIVE_CHARTS_ENABLED = "true";
    const url = resolveInteractiveChartUrl({
      ...timeseries,
      interactiveChartUrl: "https://agent.example.com/viz/42",
    });
    expect(url).toBe("https://agent.example.com/viz/42");
  });

  it("returns undefined for non-timeseries data without a supplied url", () => {
    process.env.INTERACTIVE_CHARTS_ENABLED = "true";
    const table: DataAgentResponseData = {
      type: "table",
      title: "t",
      columns: ["A"],
      rows: [["1"]],
    };
    expect(resolveInteractiveChartUrl(table)).toBeUndefined();
  });

  it("resolves the mock 'interactive' trigger's hosted interactiveChartUrl", () => {
    process.env.INTERACTIVE_CHARTS_ENABLED = "true";
    const res = getMockDataAgentResponse("show me an interactive chart");
    expect(res.data?.interactiveChartUrl).toBeTruthy();
    expect(resolveInteractiveChartUrl(res.data!)).toBe(res.data!.interactiveChartUrl);
  });
});
