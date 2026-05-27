import {
  ActivityHandler,
  TurnContext,
  MessageFactory,
} from "@microsoft/agents-hosting";
import { createDataAgentClient, IDataAgentClient } from "./services/dataAgentClient";
import { buildQueryResultCard } from "./cards/queryResultCard";
import { buildErrorCard } from "./cards/errorCard";
import { buildWelcomeCard } from "./cards/welcomeCard";
import { createAuditMiddleware } from "./middleware/auditMiddleware";
import { createRateLimitMiddleware } from "./middleware/rateLimitMiddleware";
import { createPersonalChatOnlyMiddleware } from "./middleware/personalChatOnlyMiddleware";
import { UserContext } from "./types";
import { createLogger } from "./logger";

const logger = createLogger("bot");

export class DataAssistantBot extends ActivityHandler {
  private dataAgentClient: IDataAgentClient;

  constructor() {
    super();
    this.dataAgentClient = createDataAgentClient();

    // PCO guard runs FIRST so blocked contexts short-circuit before audit and rate-limit run.
    this.onTurn(createPersonalChatOnlyMiddleware());
    this.onTurn(createAuditMiddleware());
    this.onTurn(createRateLimitMiddleware());

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded || []) {
        if (member.id !== context.activity.recipient?.id) {
          const card = buildWelcomeCard();
          await context.sendActivity(MessageFactory.attachment(card));
        }
      }
      await next();
    });

    this.onMessage(async (context, next) => {
      const userMessage = context.activity.text?.trim();
      if (!userMessage) {
        await next();
        return;
      }

      const query = this.removeMentions(context);
      const userContext: UserContext = context.turnState.get("userContext") || {
        userId: context.activity.from?.id || "unknown",
        aadObjectId: (context.activity.from as any)?.aadObjectId,
        displayName: context.activity.from?.name,
        conversationId: context.activity.conversation?.id || "unknown",
        channelId: context.activity.channelId || "unknown",
      };

      await context.sendActivity({ type: "typing" } as any);

      const startTime = Date.now();
      logger.info("query.start", {
        userId: userContext.userId,
        aadObjectId: userContext.aadObjectId,
        query,
      });

      try {
        const result = await this.dataAgentClient.query(query, userContext);

        logger.info("query.complete", {
          userId: userContext.userId,
          success: result.success,
          duration: Date.now() - startTime,
        });

        if (result.success && result.data) {
          const card = buildQueryResultCard(result.data, query);
          await context.sendActivity(MessageFactory.attachment(card));
        } else {
          const card = buildErrorCard(
            result.error || "Unknown error",
            result.suggestions
          );
          await context.sendActivity(MessageFactory.attachment(card));
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unexpected error";
        logger.error("query.error", {
          userId: userContext.userId,
          error: message,
          duration: Date.now() - startTime,
        });
        const card = buildErrorCard(
          `Trouble connecting to data service: ${message}`
        );
        await context.sendActivity(MessageFactory.attachment(card));
      }

      await next();
    });
  }

  async checkDependencyHealth(): Promise<{ status: string; latency: number }> {
    return this.dataAgentClient.healthCheck();
  }

  private removeMentions(context: TurnContext): string {
    const activity = context.activity;
    let text = activity.text || "";
    const botId = activity.recipient?.id;
    for (const entity of activity.entities || []) {
      if (entity.type === "mention" && (entity as any).mentioned?.id === botId) {
        text = text.replace((entity as any).text || "", "");
      }
    }
    return text.trim();
  }
}
