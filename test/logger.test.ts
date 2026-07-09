import { createLogger } from "../src/logger";

describe("logger", () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("outputs JSON to stdout", () => {
    const logger = createLogger("test");
    logger.info("hello");

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("info");
    expect(output.namespace).toBe("test");
    expect(output.message).toBe("hello");
    expect(output.timestamp).toBeDefined();
  });

  it("includes meta fields", () => {
    const logger = createLogger("test");
    logger.warn("slow", { duration: 5000, userId: "u1" });

    const output = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(output.duration).toBe(5000);
    expect(output.userId).toBe("u1");
  });

  it("filters out financial data fields", () => {
    const logger = createLogger("test");
    logger.info("query", {
      data: { revenue: 1000000 },
      result: { rows: [] },
      rows: [[1, 2, 3]],
      metrics: [{ label: "rev", value: "1M" }],
      userId: "u1",
    });

    const output = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(output.data).toBeUndefined();
    expect(output.result).toBeUndefined();
    expect(output.rows).toBeUndefined();
    expect(output.metrics).toBeUndefined();
    expect(output.userId).toBe("u1");
  });

  it("supports all log levels", () => {
    const logger = createLogger("ns");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.debug("d");

    expect(writeSpy).toHaveBeenCalledTimes(4);
    const levels = writeSpy.mock.calls.map((c: any) => JSON.parse(c[0]).level);
    expect(levels).toEqual(["info", "warn", "error", "debug"]);
  });
});
