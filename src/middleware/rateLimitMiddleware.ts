import { TurnContext, MessageFactory } from "@microsoft/agents-hosting";
import { createLogger } from "../logger";

const logger = createLogger("rateLimit");

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const userLimits = new Map<string, RateLimitEntry>();

export const MAX_QUERIES_PER_MINUTE = 30;
export const WINDOW_MS = 60_000;

export function createRateLimitMiddleware() {
  return async (context: TurnContext, next: () => Promise<void>): Promise<void> => {
    if (context.activity.type !== "message") {
      await next();
      return;
    }

    const userId = context.activity.from?.id || "unknown";
    const now = Date.now();

    let entry = userLimits.get(userId);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      userLimits.set(userId, entry);
    }

    entry.count++;

    if (entry.count > MAX_QUERIES_PER_MINUTE) {
      logger.warn("rate.limit.exceeded", {
        userId,
        count: entry.count,
        resetAt: new Date(entry.resetAt).toISOString(),
      });

      await context.sendActivity(
        MessageFactory.text("You've exceeded the rate limit (30 queries/minute). Please wait a moment before trying again.")
      );
      return;
    }

    await next();
  };
}

export function resetRateLimits(): void {
  userLimits.clear();
}
