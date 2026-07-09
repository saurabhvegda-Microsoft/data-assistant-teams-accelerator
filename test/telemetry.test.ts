describe("telemetry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does not throw when APPLICATIONINSIGHTS_CONNECTION_STRING is missing", () => {
    delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    expect(() => {
      require("../src/telemetry");
    }).not.toThrow();
  });

  it("exports sdk as undefined when connection string is missing", () => {
    delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    const { sdk } = require("../src/telemetry");
    expect(sdk).toBeUndefined();
  });
});
