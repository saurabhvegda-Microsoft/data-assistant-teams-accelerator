const mockAcquireTokenOnBehalfOf = jest.fn();
jest.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: jest.fn().mockImplementation(() => ({
    acquireTokenOnBehalfOf: mockAcquireTokenOnBehalfOf,
  })),
}));

import {
  UserAuthService,
  MsalOboTokenProvider,
  loadUserAuthConfig,
  UserAuthConfig,
  OboTokenProvider,
} from "../src/services/userAuth";

class FakeObo implements OboTokenProvider {
  calls = 0;
  constructor(private readonly token = "obo-token", private readonly fail = false) {}
  async exchange(): Promise<string> {
    this.calls++;
    if (this.fail) throw new Error("obo failed");
    return this.token;
  }
}

const cfg = (over: Partial<UserAuthConfig> = {}): UserAuthConfig => ({
  enabled: true,
  clientId: "client-id",
  clientSecret: "client-secret",
  tenantId: "tenant-id",
  dataAgentScope: "api://x/access_as_user",
  ...over,
});

describe("UserAuthService", () => {
  it("returns undefined when user auth is disabled", async () => {
    const svc = new UserAuthService(cfg({ enabled: false }), new FakeObo());
    expect(svc.isEnabled()).toBe(false);
    expect(await svc.getDataAgentToken("assertion", "u1")).toBeUndefined();
  });

  it("returns undefined when no assertion is available", async () => {
    const obo = new FakeObo();
    const svc = new UserAuthService(cfg(), obo);
    expect(await svc.getDataAgentToken(undefined, "u1")).toBeUndefined();
    expect(obo.calls).toBe(0);
  });

  it("exchanges an assertion for a Data Agent token", async () => {
    const obo = new FakeObo("tok-1");
    const svc = new UserAuthService(cfg(), obo);
    expect(await svc.getDataAgentToken("assertion", "u1")).toBe("tok-1");
    expect(obo.calls).toBe(1);
  });

  it("caches the token per user", async () => {
    const obo = new FakeObo("tok-1");
    const svc = new UserAuthService(cfg(), obo);
    await svc.getDataAgentToken("assertion", "u1");
    await svc.getDataAgentToken("assertion", "u1");
    expect(obo.calls).toBe(1);
  });

  it("re-exchanges after the cache is cleared", async () => {
    const obo = new FakeObo();
    const svc = new UserAuthService(cfg(), obo);
    await svc.getDataAgentToken("a", "u1");
    svc.clearCache();
    await svc.getDataAgentToken("a", "u1");
    expect(obo.calls).toBe(2);
  });

  it("re-exchanges once the cached token has expired", async () => {
    const obo = new FakeObo();
    const svc = new UserAuthService(cfg(), obo, 0); // ttl 0 -> always expired
    await svc.getDataAgentToken("a", "u1");
    await svc.getDataAgentToken("a", "u1");
    expect(obo.calls).toBe(2);
  });

  it("returns undefined (and does not throw) when the exchange fails", async () => {
    const svc = new UserAuthService(cfg(), new FakeObo("x", true));
    expect(await svc.getDataAgentToken("assertion", "u1")).toBeUndefined();
  });
});

describe("MsalOboTokenProvider", () => {
  beforeEach(() => mockAcquireTokenOnBehalfOf.mockReset());

  it("exchanges an assertion via OBO and returns the access token", async () => {
    mockAcquireTokenOnBehalfOf.mockResolvedValue({ accessToken: "obo-access-token" });
    const provider = new MsalOboTokenProvider(cfg());
    expect(await provider.exchange("user-assertion")).toBe("obo-access-token");
    expect(mockAcquireTokenOnBehalfOf).toHaveBeenCalledWith({
      oboAssertion: "user-assertion",
      scopes: ["api://x/access_as_user"],
    });
  });

  it("throws when the exchange returns no access token", async () => {
    mockAcquireTokenOnBehalfOf.mockResolvedValue(null);
    const provider = new MsalOboTokenProvider(cfg());
    await expect(provider.exchange("a")).rejects.toThrow(/no access token/i);
  });

  it("throws when required config is missing", () => {
    expect(() => new MsalOboTokenProvider(cfg({ dataAgentScope: "" }))).toThrow(/DATA_AGENT_SCOPE/);
  });
});

describe("loadUserAuthConfig", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it("defaults to disabled and reuses the bot identity", () => {
    delete process.env.USER_AUTH_ENABLED;
    delete process.env.AAD_CLIENT_ID;
    delete process.env.AAD_CLIENT_SECRET;
    delete process.env.AAD_TENANT_ID;
    process.env.BOT_ID = "bot-id";
    process.env.BOT_PASSWORD = "bot-pw";
    process.env.tenantId = "tenant";

    const c = loadUserAuthConfig();
    expect(c.enabled).toBe(false);
    expect(c.clientId).toBe("bot-id");
    expect(c.clientSecret).toBe("bot-pw");
    expect(c.tenantId).toBe("tenant");
  });

  it("enables and honors AAD_* overrides", () => {
    process.env.USER_AUTH_ENABLED = "true";
    process.env.AAD_CLIENT_ID = "aad-client";
    process.env.AAD_TENANT_ID = "aad-tenant";
    process.env.DATA_AGENT_SCOPE = "api://agent/access_as_user";

    const c = loadUserAuthConfig();
    expect(c.enabled).toBe(true);
    expect(c.clientId).toBe("aad-client");
    expect(c.tenantId).toBe("aad-tenant");
    expect(c.dataAgentScope).toBe("api://agent/access_as_user");
  });
});
