import { MockDataAgentClient } from "../src/services/mockDataAgentClient";

describe("MockDataAgentClient", () => {
  let client: MockDataAgentClient;

  beforeEach(() => {
    client = new MockDataAgentClient();
  });

  it("returns table data for revenue by region queries", async () => {
    const result = await client.query("Show me revenue by region");
    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("table");
    expect(result.data?.columns).toContain("Region");
    expect(result.data?.rows?.length).toBeGreaterThan(0);
  });

  it("returns table data for revenue by product queries", async () => {
    const result = await client.query("revenue by product line");
    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("table");
    expect(result.data?.columns).toContain("Product Line");
  });

  it("returns metrics for total revenue queries", async () => {
    const result = await client.query("What is total revenue?");
    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("metrics");
    expect(result.data?.metrics?.length).toBeGreaterThan(0);
  });

  it("returns metrics for margin queries", async () => {
    const result = await client.query("Show me profit margins");
    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("metrics");
    expect(result.data?.title).toContain("Margin");
  });

  it("returns timeseries for trend queries", async () => {
    const result = await client.query("monthly revenue trend");
    expect(result.success).toBe(true);
    expect(result.data?.type).toBe("timeseries");
    expect(result.data?.series?.length).toBeGreaterThan(0);
    expect(result.data?.seriesLabels?.length).toBeGreaterThan(0);
  });

  it("returns help info for help queries", async () => {
    const result = await client.query("What can you help with?");
    expect(result.success).toBe(true);
    expect(result.data?.title).toContain("help");
  });

  it("returns error with suggestions for unknown queries", async () => {
    const result = await client.query("random gibberish xyz");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.suggestions?.length).toBeGreaterThan(0);
  });

  it("includes SQL in successful responses", async () => {
    const result = await client.query("revenue by region");
    expect(result.data?.sql).toBeDefined();
    expect(result.data?.sql).toContain("SELECT");
  });
});
