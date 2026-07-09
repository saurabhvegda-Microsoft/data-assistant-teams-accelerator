import {
  ConversationSessionService,
  createConversationSessionService,
  conversationHistoryEnabled,
  isResetCommand,
} from "../src/services/conversationSession";

describe("ConversationSessionService", () => {
  it("returns a stable session id per conversation", () => {
    const svc = new ConversationSessionService(true);
    expect(svc.getSessionId("conv-1")).toBe(svc.getSessionId("conv-1"));
  });

  it("uses different ids for different conversations", () => {
    const svc = new ConversationSessionService(true);
    expect(svc.getSessionId("conv-1")).not.toBe(svc.getSessionId("conv-2"));
  });

  it("rotates the id on reset", () => {
    const svc = new ConversationSessionService(true);
    const before = svc.getSessionId("conv-1");
    const after = svc.resetSession("conv-1");
    expect(after).not.toBe(before);
    expect(svc.getSessionId("conv-1")).toBe(after);
  });

  it("reports its enabled state", () => {
    expect(new ConversationSessionService(true).isEnabled()).toBe(true);
    expect(new ConversationSessionService(false).isEnabled()).toBe(false);
  });
});

describe("isResetCommand", () => {
  it.each(["/new", "/reset", "New conversation", "  start over ", "RESET CONVERSATION"])(
    "matches %p",
    (cmd) => expect(isResetCommand(cmd)).toBe(true)
  );

  it.each(["revenue by region", "new revenue", "", "reset the filter"])(
    "does not match %p",
    (cmd) => expect(isResetCommand(cmd)).toBe(false)
  );
});

describe("createConversationSessionService", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns undefined when history is disabled (default)", () => {
    delete process.env.CONVERSATION_HISTORY_ENABLED;
    expect(createConversationSessionService()).toBeUndefined();
    expect(conversationHistoryEnabled()).toBe(false);
  });

  it("returns a service when history is enabled", () => {
    process.env.CONVERSATION_HISTORY_ENABLED = "true";
    expect(createConversationSessionService()).toBeInstanceOf(ConversationSessionService);
    expect(conversationHistoryEnabled()).toBe(true);
  });
});
