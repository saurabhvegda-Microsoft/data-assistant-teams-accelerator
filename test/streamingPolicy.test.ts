import { streamingEnabled, verboseThoughtsEnabled } from "../src/services/streamingPolicy";

describe("streamingPolicy", () => {
  describe("streamingEnabled", () => {
    it("defaults to true", () => {
      expect(streamingEnabled({})).toBe(true);
    });
    it("is false only when explicitly disabled", () => {
      expect(streamingEnabled({ STREAMING_ENABLED: "false" })).toBe(false);
      expect(streamingEnabled({ STREAMING_ENABLED: "true" })).toBe(true);
    });
  });

  describe("verboseThoughtsEnabled", () => {
    it("defaults to false (single status, not per-step)", () => {
      expect(verboseThoughtsEnabled({})).toBe(false);
    });
    it("is true only when explicitly enabled", () => {
      expect(verboseThoughtsEnabled({ STREAMING_THOUGHTS_ENABLED: "true" })).toBe(true);
      expect(verboseThoughtsEnabled({ STREAMING_THOUGHTS_ENABLED: "false" })).toBe(false);
    });
  });
});
