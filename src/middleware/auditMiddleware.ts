import { TurnContext } from "@microsoft/agents-hosting";
import { UserContext } from "../types";
import { createLogger } from "../logger";

const logger = createLogger("audit");

export function extractUserContext(context: TurnContext): UserContext {
  const activity = context.activity;
  return {
    userId: activity.from?.id || "unknown",
    aadObjectId: (activity.from as any)?.aadObjectId,
    displayName: activity.from?.name,
    conversationId: activity.conversation?.id || "unknown",
    channelId: activity.channelId || "unknown",
  };
}

export function createAuditMiddleware() {
  return async (context: TurnContext, next: () => Promise<void>): Promise<void> => {
    const userContext = extractUserContext(context);
    const startTime = Date.now();

    context.turnState.set("userContext", userContext);

    logger.info("turn.start", {
      userId: userContext.userId,
      aadObjectId: userContext.aadObjectId,
      displayName: userContext.displayName,
      activityType: context.activity.type,
      conversationId: userContext.conversationId,
      channelId: userContext.channelId,
    });

    try {
      await next();
      logger.info("turn.complete", {
        userId: userContext.userId,
        duration: Date.now() - startTime,
        status: "success",
      });
    } catch (err) {
      logger.error("turn.error", {
        userId: userContext.userId,
        duration: Date.now() - startTime,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
