import {
  AllowlistAccessControlService,
  NoOpAccessControlService,
  EntraGroupAccessControlService,
  createAccessControlService,
} from "../src/services/accessControlService";

describe("NoOpAccessControlService", () => {
  const service = new NoOpAccessControlService();

  it("always returns allowed", async () => {
    const result = await service.checkAccess(["id-1", "id-2"]);
    expect(result.allowed).toBe(true);
    expect(result.unauthorizedCount).toBe(0);
  });

  it("returns allowed for empty input", async () => {
    const result = await service.checkAccess([]);
    expect(result.allowed).toBe(true);
  });
});

describe("AllowlistAccessControlService", () => {
  it("allows when all IDs are in allowlist", async () => {
    const service = new AllowlistAccessControlService(["aaa", "bbb", "ccc"]);
    const result = await service.checkAccess(["aaa", "bbb"]);
    expect(result.allowed).toBe(true);
    expect(result.unauthorizedCount).toBe(0);
  });

  it("denies when one ID is not in allowlist", async () => {
    const service = new AllowlistAccessControlService(["aaa", "bbb"]);
    const result = await service.checkAccess(["aaa", "bbb", "ddd"]);
    expect(result.allowed).toBe(false);
    expect(result.unauthorizedCount).toBe(1);
    expect(result.reason).toContain("lack data access");
  });

  it("denies all when allowlist is empty", async () => {
    const service = new AllowlistAccessControlService([]);
    const result = await service.checkAccess(["aaa"]);
    expect(result.allowed).toBe(false);
    expect(result.unauthorizedCount).toBe(1);
    expect(result.reason).toContain("No authorized users");
  });

  it("allows empty input (no members to check)", async () => {
    const service = new AllowlistAccessControlService(["aaa"]);
    const result = await service.checkAccess([]);
    expect(result.allowed).toBe(true);
  });

  it("performs case-insensitive comparison", async () => {
    const service = new AllowlistAccessControlService([
      "AAA-BBB-CCC",
      "DDD-EEE-FFF",
    ]);
    const result = await service.checkAccess(["aaa-bbb-ccc", "ddd-eee-fff"]);
    expect(result.allowed).toBe(true);
  });

  it("reports correct unauthorized count for multiple missing IDs", async () => {
    const service = new AllowlistAccessControlService(["aaa"]);
    const result = await service.checkAccess(["aaa", "bbb", "ccc"]);
    expect(result.allowed).toBe(false);
    expect(result.unauthorizedCount).toBe(2);
  });
});

describe("EntraGroupAccessControlService", () => {
  it("throws when group ID is missing via factory", () => {
    const originalMode = process.env.ACCESS_CONTROL_MODE;
    const originalGroupId = process.env.ACCESS_CONTROL_ENTRA_GROUP_ID;

    process.env.ACCESS_CONTROL_MODE = "entra";
    delete process.env.ACCESS_CONTROL_ENTRA_GROUP_ID;

    expect(() => createAccessControlService()).toThrow(
      "ACCESS_CONTROL_ENTRA_GROUP_ID is required"
    );

    process.env.ACCESS_CONTROL_MODE = originalMode;
    if (originalGroupId) {
      process.env.ACCESS_CONTROL_ENTRA_GROUP_ID = originalGroupId;
    }
  });
});

describe("createAccessControlService factory", () => {
  const originalMode = process.env.ACCESS_CONTROL_MODE;
  const originalAllowlist = process.env.ACCESS_CONTROL_ALLOWLIST;

  afterEach(() => {
    if (originalMode) {
      process.env.ACCESS_CONTROL_MODE = originalMode;
    } else {
      delete process.env.ACCESS_CONTROL_MODE;
    }
    if (originalAllowlist) {
      process.env.ACCESS_CONTROL_ALLOWLIST = originalAllowlist;
    } else {
      delete process.env.ACCESS_CONTROL_ALLOWLIST;
    }
  });

  it("returns NoOpAccessControlService when mode is disabled", () => {
    process.env.ACCESS_CONTROL_MODE = "disabled";
    const service = createAccessControlService();
    expect(service).toBeInstanceOf(NoOpAccessControlService);
  });

  it("returns AllowlistAccessControlService when mode is allowlist", () => {
    process.env.ACCESS_CONTROL_MODE = "allowlist";
    process.env.ACCESS_CONTROL_ALLOWLIST = "id1,id2";
    const service = createAccessControlService();
    expect(service).toBeInstanceOf(AllowlistAccessControlService);
  });

  it("defaults to allowlist when mode is not set", () => {
    delete process.env.ACCESS_CONTROL_MODE;
    process.env.ACCESS_CONTROL_ALLOWLIST = "id1";
    const service = createAccessControlService();
    expect(service).toBeInstanceOf(AllowlistAccessControlService);
  });
});
