import { createDataAgentClient } from "../src/services/dataAgentClient";
import { MockDataAgentClient } from "../src/services/mockDataAgentClient";

describe("createDataAgentClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns MockDataAgentClient when USE_MOCK_CLIENT is not set", () => {
    delete process.env.USE_MOCK_CLIENT;
    const client = createDataAgentClient();
    expect(client).toBeInstanceOf(MockDataAgentClient);
  });

  it("returns MockDataAgentClient when USE_MOCK_CLIENT is 'true'", () => {
    process.env.USE_MOCK_CLIENT = "true";
    const client = createDataAgentClient();
    expect(client).toBeInstanceOf(MockDataAgentClient);
  });

  it("throws when USE_MOCK_CLIENT is false and no DATA_AGENT_API_BASE_URL", () => {
    process.env.USE_MOCK_CLIENT = "false";
    delete process.env.DATA_AGENT_API_BASE_URL;
    expect(() => createDataAgentClient()).toThrow("DATA_AGENT_API_BASE_URL is required");
  });

  it("returns DataAgentClient when USE_MOCK_CLIENT is false and URL is set", () => {
    process.env.USE_MOCK_CLIENT = "false";
    process.env.DATA_AGENT_API_BASE_URL = "https://data-agent.example.com";
    const client = createDataAgentClient();
    expect(client).not.toBeInstanceOf(MockDataAgentClient);
  });
});
