import {
  ActivityHandler,
  TurnContext,
  MessageFactory,
  StreamingResponse,
} from "@microsoft/agents-hosting";
import { createDataAgentClient, IDataAgentClient, ProgressUpdate } from "./services/dataAgentClient";
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

      // Stream interim progress (the MCP's "thoughts") as Teams informative
      // updates when the channel supports streaming (personal chat). Otherwise
      // fall back to a typing indicator + a single final card.
      const streamingEnabled =
        (process.env.STREAMING_ENABLED ?? "true") !== "false";
      const stream = new StreamingResponse(context);
      const useStreaming = streamingEnabled && stream.isStreamingChannel;

      const onProgress = useStreaming
        ? (update: ProgressUpdate) =>
            stream.queueInformativeUpdate(update.message.slice(0, 1000))
        : undefined;

      if (useStreaming) {
        stream.queueInformativeUpdate("Working on your question…");
      } else {
        await context.sendActivity({ type: "typing" } as any);
      }

      const startTime = Date.now();
      logger.info("query.start", {
        userId: userContext.userId,
        aadObjectId: userContext.aadObjectId,
        streaming: useStreaming,
        query,
      });

      try {
        const result = await this.dataAgentClient.query(
          query,
          userContext,
          onProgress
        );

        logger.info("query.complete", {
          userId: userContext.userId,
          success: result.success,
          duration: Date.now() - startTime,
        });

        const card =
          result.success && result.data
            ? buildQueryResultCard(result.data, query)
            : buildErrorCard(result.error || "Unknown error", result.suggestions);

        await this.deliver(context, stream, useStreaming, card);
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
        await this.deliver(context, stream, useStreaming, card);
      }

      await next();
    });
  }

  async checkDependencyHealth(): Promise<{ status: string; latency: number }> {
    return this.dataAgentClient.healthCheck();
  }

  private async deliver(
    context: TurnContext,
    stream: StreamingResponse,
    useStreaming: boolean,
    card: ReturnType<typeof buildQueryResultCard>
  ): Promise<void> {
    if (useStreaming) {
      try {
        stream.setGeneratedByAILabel(true);
        stream.setAttachments([card]);
        await stream.endStream();
        return;
      } catch {
        // Streaming failed mid-flight — fall back to a normal message.
      }
    }
    await context.sendActivity(MessageFactory.attachment(card));
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
