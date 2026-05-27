jest.mock("@microsoft/agents-hosting", () => ({
  TurnContext: jest.fn(),
  MessageFactory: {
    attachment: jest.fn((card) => ({ attachments: [card] })),
    text: jest.fn((text) => ({ text })),
  },
  CardFactory: {
    adaptiveCard: jest.fn((card) => ({ contentType: "adaptive", content: card })),
  },
}));

jest.mock("../src/logger", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock("../src/cards/personalChatOnlyCard", () => ({
  buildPersonalChatOnlyCard: jest.fn(() => ({
    contentType: "adaptive",
    content: { type: "AdaptiveCard" },
  })),
}));

import { createPersonalChatOnlyMiddleware } from "../src/middleware/personalChatOnlyMiddleware";

function makeContext(options: {
  activityType?: string;
  conversationType?: string;
  isGroup?: boolean;
  channelId?: string;
}) {
  const {
    activityType = "message",
    conversationType,
    isGroup,
    channelId = "msteams",
  } = options;

  return {
    activity: {
      type: activityType,
      channelId,
      conversation: {
        id: "conv-1",
        conversationType,
        isGroup,
      },
      from: { id: "user-1", name: "User 1", aadObjectId: "aad-1" },
      recipient: { id: "bot-id" },
    },
    sendActivity: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe("personalChatOnlyMiddleware", () => {
  const originalEnv = process.env.PERSONAL_CHAT_ONLY_ENABLED;

  afterEach(() => {
    process.env.PERSONAL_CHAT_ONLY_ENABLED = originalEnv;
  });

  it("passes through for personal chat messages", async () => {
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({ conversationType: "personal" });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(context.sendActivity).not.toHaveBeenCalled();
  });

  it("blocks groupChat messages and sends block card", async () => {
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({ conversationType: "groupChat", isGroup: true });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(context.sendActivity).toHaveBeenCalledTimes(1);
  });

  it("blocks channel messages and sends block card", async () => {
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({ conversationType: "channel", isGroup: true });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(context.sendActivity).toHaveBeenCalledTimes(1);
  });

  it("blocks when conversationType is missing but isGroup=true", async () => {
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({ conversationType: undefined, isGroup: true });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(context.sendActivity).toHaveBeenCalledTimes(1);
  });

  it("passes through non-message activity types regardless of conversation type", async () => {
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({
      activityType: "conversationUpdate",
      conversationType: "groupChat",
      isGroup: true,
    });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(context.sendActivity).not.toHaveBeenCalled();
  });

  it("passes through everything when feature flag is disabled", async () => {
    process.env.PERSONAL_CHAT_ONLY_ENABLED = "false";
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({ conversationType: "groupChat", isGroup: true });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(context.sendActivity).not.toHaveBeenCalled();
  });

  it("allows webchat channel even without conversationType=personal", async () => {
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({ channelId: "webchat" });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(context.sendActivity).not.toHaveBeenCalled();
  });

  it("allows directline channel", async () => {
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({ channelId: "directline" });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(context.sendActivity).not.toHaveBeenCalled();
  });

  it("allows emulator channel", async () => {
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({ channelId: "emulator" });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(context.sendActivity).not.toHaveBeenCalled();
  });

  it("still blocks group on non-Teams channel if isGroup=true", async () => {
    const mw = createPersonalChatOnlyMiddleware();
    const context = makeContext({ channelId: "webchat", isGroup: true });
    const next = jest.fn().mockResolvedValue(undefined);

    await mw(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(context.sendActivity).toHaveBeenCalledTimes(1);
  });
});
