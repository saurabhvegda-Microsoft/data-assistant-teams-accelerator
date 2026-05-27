jest.mock("@microsoft/agents-hosting", () => ({
  TurnContext: class {},
  MessageFactory: { text: (t: string) => ({ type: "message", text: t }) },
}));

import { createRateLimitMiddleware, resetRateLimits, MAX_QUERIES_PER_MINUTE } from "../src/middleware/rateLimitMiddleware";

function makeMockContext(userId: string, type: string = "message") {
  const sent: any[] = [];
  return {
    activity: {
      type,
      from: { id: userId, name: "Test User" },
      conversation: { id: "conv1" },
      channelId: "msteams",
    },
    sendActivity: jest.fn(async (activity: any) => { sent.push(activity); }),
    _sent: sent,
  } as any;
}

describe("rateLimitMiddleware", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("allows messages under the limit", async () => {
    const middleware = createRateLimitMiddleware();
    const next = jest.fn();
    const context = makeMockContext("user1");

    await middleware(context, next);

    expect(next).toHaveBeenCalled();
    expect(context.sendActivity).not.toHaveBeenCalled();
  });

  it("blocks messages over the limit", async () => {
    const middleware = createRateLimitMiddleware();
    const context = makeMockContext("user1");

    for (let i = 0; i < MAX_QUERIES_PER_MINUTE; i++) {
      await middleware(context, jest.fn());
    }

    const next = jest.fn();
    await middleware(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(context.sendActivity).toHaveBeenCalled();
  });

  it("does not rate-limit non-message activities", async () => {
    const middleware = createRateLimitMiddleware();
    const context = makeMockContext("user1", "conversationUpdate");
    const next = jest.fn();

    await middleware(context, next);

    expect(next).toHaveBeenCalled();
  });

  it("tracks users independently", async () => {
    const middleware = createRateLimitMiddleware();

    const ctx1 = makeMockContext("user1");
    const ctx2 = makeMockContext("user2");

    for (let i = 0; i < MAX_QUERIES_PER_MINUTE; i++) {
      await middleware(ctx1, jest.fn());
    }

    const next = jest.fn();
    await middleware(ctx2, next);
    expect(next).toHaveBeenCalled();
  });

  it("resets after the time window", async () => {
    const middleware = createRateLimitMiddleware();
    const context = makeMockContext("user1");

    const realNow = Date.now;
    let time = 1000000;
    Date.now = () => time;

    for (let i = 0; i < MAX_QUERIES_PER_MINUTE; i++) {
      await middleware(context, jest.fn());
    }

    // Advance past the window
    time += 61_000;

    const next = jest.fn();
    await middleware(context, next);
    expect(next).toHaveBeenCalled();

    Date.now = realNow;
  });
});
