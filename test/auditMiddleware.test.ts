import { createAuditMiddleware, extractUserContext } from "../src/middleware/auditMiddleware";

function makeMockContext(overrides: any = {}) {
  return {
    activity: {
      type: "message",
      from: { id: "user123", name: "Test User", aadObjectId: "aad-obj-456" },
      conversation: { id: "conv789" },
      channelId: "msteams",
      ...overrides,
    },
    turnState: new Map(),
  } as any;
}

describe("extractUserContext", () => {
  it("extracts user identity from activity", () => {
    const context = makeMockContext();
    const uc = extractUserContext(context);

    expect(uc.userId).toBe("user123");
    expect(uc.aadObjectId).toBe("aad-obj-456");
    expect(uc.displayName).toBe("Test User");
    expect(uc.conversationId).toBe("conv789");
    expect(uc.channelId).toBe("msteams");
  });

  it("handles missing from fields gracefully", () => {
    const context = makeMockContext({ from: undefined });
    const uc = extractUserContext(context);

    expect(uc.userId).toBe("unknown");
    expect(uc.aadObjectId).toBeUndefined();
  });
});

describe("auditMiddleware", () => {
  it("stores userContext on turnState", async () => {
    const middleware = createAuditMiddleware();
    const context = makeMockContext();
    const next = jest.fn();

    await middleware(context, next);

    const stored = context.turnState.get("userContext");
    expect(stored).toBeDefined();
    expect(stored.userId).toBe("user123");
  });

  it("calls next()", async () => {
    const middleware = createAuditMiddleware();
    const context = makeMockContext();
    const next = jest.fn();

    await middleware(context, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rethrows errors from next()", async () => {
    const middleware = createAuditMiddleware();
    const context = makeMockContext();
    const next = jest.fn().mockRejectedValue(new Error("downstream failure"));

    await expect(middleware(context, next)).rejects.toThrow("downstream failure");
  });

  it("does not log financial data fields", async () => {
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);

    const middleware = createAuditMiddleware();
    const context = makeMockContext();
    await middleware(context, jest.fn());

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    for (const call of calls) {
      expect(call).not.toContain('"data"');
      expect(call).not.toContain('"rows"');
      expect(call).not.toContain('"metrics"');
    }

    writeSpy.mockRestore();
  });
});
