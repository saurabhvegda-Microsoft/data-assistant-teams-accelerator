import {
  resultExportEnabled,
  largeResultThreshold,
  longRunningThresholdMs,
  isLargeResult,
  isLongRunning,
  toCsv,
  registerResult,
  getResult,
  renderResultHtml,
  resolveResultExportUrls,
  _clearResultStore,
} from "../src/services/resultExport";
import { DataAgentResponseData } from "../src/services/dataAgentClient";

function tableWith(rowCount: number): DataAgentResponseData {
  return {
    type: "table",
    title: "Big Result",
    columns: ["A", "B"],
    rows: Array.from({ length: rowCount }, (_, i) => [i, `v${i}`]),
  };
}

describe("resultExport service", () => {
  const savedEnabled = process.env.RESULT_EXPORT_ENABLED;
  const savedRows = process.env.LARGE_RESULT_ROWS;
  const savedMs = process.env.LONG_RUNNING_MS;
  const savedBase = process.env.PUBLIC_BASE_URL;

  afterEach(() => {
    _clearResultStore();
    for (const [k, v] of Object.entries({
      RESULT_EXPORT_ENABLED: savedEnabled,
      LARGE_RESULT_ROWS: savedRows,
      LONG_RUNNING_MS: savedMs,
      PUBLIC_BASE_URL: savedBase,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("resultExportEnabled reflects the env flag (default off)", () => {
    delete process.env.RESULT_EXPORT_ENABLED;
    expect(resultExportEnabled()).toBe(false);
    process.env.RESULT_EXPORT_ENABLED = "true";
    expect(resultExportEnabled()).toBe(true);
  });

  it("thresholds honor env overrides and fall back to defaults", () => {
    delete process.env.LARGE_RESULT_ROWS;
    delete process.env.LONG_RUNNING_MS;
    expect(largeResultThreshold()).toBe(25);
    expect(longRunningThresholdMs()).toBe(90000);
    process.env.LARGE_RESULT_ROWS = "5";
    process.env.LONG_RUNNING_MS = "1000";
    expect(largeResultThreshold()).toBe(5);
    expect(longRunningThresholdMs()).toBe(1000);
  });

  it("isLargeResult / isLongRunning compare against the thresholds", () => {
    process.env.LARGE_RESULT_ROWS = "10";
    process.env.LONG_RUNNING_MS = "1000";
    expect(isLargeResult(tableWith(11))).toBe(true);
    expect(isLargeResult(tableWith(10))).toBe(false);
    expect(isLongRunning(1001)).toBe(true);
    expect(isLongRunning(999)).toBe(false);
  });

  it("toCsv quotes values containing commas, quotes, or newlines", () => {
    const csv = toCsv(["Name", "Note"], [["a,b", 'she said "hi"'], ["plain", "line\nbreak"]]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Name,Note");
    expect(lines[1]).toBe('"a,b","she said ""hi"""');
    expect(lines[2]).toBe('plain,"line\nbreak"');
  });

  it("registerResult + getResult round-trips columns and rows", () => {
    const id = registerResult(tableWith(3));
    const stored = getResult(id);
    expect(stored).toBeDefined();
    expect(stored!.columns).toEqual(["A", "B"]);
    expect(stored!.rows.length).toBe(3);
  });

  it("getResult returns undefined for unknown ids", () => {
    expect(getResult("nope")).toBeUndefined();
  });

  it("renderResultHtml renders and HTML-escapes cell values", () => {
    const id = registerResult({
      type: "table",
      title: "X",
      columns: ["C"],
      rows: [["<script>"]],
    });
    const html = renderResultHtml(getResult(id)!);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("1 rows");
  });

  it("resolveResultExportUrls returns undefined when the flag is off", () => {
    process.env.RESULT_EXPORT_ENABLED = "false";
    expect(resolveResultExportUrls(tableWith(100))).toBeUndefined();
  });

  it("returns hosted CSV + HTML links for a large result when enabled", () => {
    process.env.RESULT_EXPORT_ENABLED = "true";
    process.env.LARGE_RESULT_ROWS = "10";
    process.env.PUBLIC_BASE_URL = "https://bot.example.com";
    const urls = resolveResultExportUrls(tableWith(50));
    expect(urls).toBeDefined();
    expect(urls!.csvUrl).toMatch(/^https:\/\/bot\.example\.com\/results\/[a-z0-9]+\.csv$/);
    expect(urls!.htmlUrl).toMatch(/^https:\/\/bot\.example\.com\/results\/[a-z0-9]+$/);
    const id = urls!.htmlUrl.split("/").pop()!;
    expect(getResult(id)).toBeDefined();
  });

  it("does not offer export for a small result unless forced (long-running)", () => {
    process.env.RESULT_EXPORT_ENABLED = "true";
    process.env.LARGE_RESULT_ROWS = "25";
    expect(resolveResultExportUrls(tableWith(3))).toBeUndefined();
    expect(resolveResultExportUrls(tableWith(3), process.env, { force: true })).toBeDefined();
  });
});
