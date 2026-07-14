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
import { createUserAuthService, UserAuthService } from "./services/userAuth";
import {
  createConversationSessionService,
  ConversationSessionService,
  isResetCommand,
} from "./services/conversationSession";
import { streamingEnabled, verboseThoughtsEnabled } from "./services/streamingPolicy";
import { resolveInteractiveChartUrl } from "./services/interactiveChart";
import { resolveResultExportUrls, isLongRunning } from "./services/resultExport";
import { createLogger } from "./logger";

const logger = createLogger("bot");

/**
 * Best-effort extraction of the Teams SSO token (the OBO assertion) for the
 * current turn. With Teams SSO configured, the token arrives on the
 * `signin/tokenExchange` invoke activity's value. Completing the silent
 * sign-in/consent flow (OAuthPrompt / Authorization.exchangeToken) requires an
 * Azure Bot OAuth connection — see the README "User authentication" section.
 */
function extractSsoAssertion(context: TurnContext): string | undefined {
  const value = (context.activity as { value?: { token?: unknown } }).value;
  if (value && typeof value.token === "string") return value.token;
  return undefined;
}

export class DataAssistantBot extends ActivityHandler {
  private dataAgentClient: IDataAgentClient;
  private userAuthService?: UserAuthService;
  private conversationSession?: ConversationSessionService;

  constructor() {
    super();
    this.dataAgentClient = createDataAgentClient();
    this.userAuthService = createUserAuthService();
    this.conversationSession = createConversationSessionService();

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
      const conversationId = context.activity.conversation?.id || "unknown";

      // "New conversation" reset — slash command or the result card's Submit
      // action. Handled before the empty-text guard (the button has no text).
      if (this.conversationSession?.isEnabled()) {
        const submitAction = (context.activity.value as { action?: string } | undefined)?.action;
        const text = context.activity.text?.trim() ?? "";
        if (submitAction === "newConversation" || isResetCommand(text)) {
          this.conversationSession.resetSession(conversationId);
          await context.sendActivity(
            MessageFactory.text(
              "🆕 Started a new conversation — earlier context has been cleared."
            )
          );
          await next();
          return;
        }
      }

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

      await this.resolveUserToken(context, userContext);
      if (this.conversationSession?.isEnabled()) {
        userContext.sessionId = this.conversationSession.getSessionId(
          userContext.conversationId
        );
      }

      // Show a SINGLE "working" indicator between the prompt and the result.
      // In Teams this is the in-place progress bar; we deliberately do NOT relay
      // every MCP step as its own chat message (that spams the conversation).
      // Granular per-step "thoughts" can be opted back in via STREAMING_THOUGHTS_ENABLED.
      const stream = new StreamingResponse(context);
      const useStreaming = streamingEnabled() && stream.isStreamingChannel;

      const onProgress =
        useStreaming && verboseThoughtsEnabled()
          ? (update: ProgressUpdate) =>
              stream.queueInformativeUpdate(update.message.slice(0, 1000))
          : undefined;

      if (useStreaming) {
        stream.queueInformativeUpdate("Working on your question — converting it to a query and fetching results…");
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

        const interactiveChartUrl =
          result.success && result.data
            ? resolveInteractiveChartUrl(result.data)
            : undefined;
        // Large results → hosted CSV/HTML links (C3). Long-running queries →
        // offer the hosted link regardless of size (C4), so the user gets a
        // fast link instead of waiting on / scrolling a big card.
        const exportUrls =
          result.success && result.data
            ? resolveResultExportUrls(result.data, process.env, {
                force: isLongRunning(Date.now() - startTime),
              })
            : undefined;
        const card =
          result.success && result.data
            ? buildQueryResultCard(result.data, query, {
                interactiveChartUrl,
                resultCsvUrl: exportUrls?.csvUrl,
                resultHtmlUrl: exportUrls?.htmlUrl,
              })
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

  /**
   * Resolves the per-user Data Agent token for this turn (Teams SSO + OBO) and
   * stashes it on the userContext. No-op unless user auth is enabled; never
   * throws (falls back to the client's static credential on failure).
   */
  private async resolveUserToken(
    context: TurnContext,
    userContext: UserContext
  ): Promise<void> {
    if (!this.userAuthService?.isEnabled()) return;
    try {
      const assertion = extractSsoAssertion(context);
      const token = await this.userAuthService.getDataAgentToken(
        assertion,
        userContext.userId
      );
      if (token) userContext.userToken = token;
    } catch (err) {
      logger.warn("userAuth.resolveFailed", {
        userId: userContext.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async deliver(
    context: TurnContext,
    stream: StreamingResponse,
    useStreaming: boolean,
    card: ReturnType<typeof buildQueryResultCard>
  ): Promise<void> {
    if (useStreaming) {
      try {
        // Deliver the card as the stream's final message. Setting an explicit
        // final message (rather than only attachments) prevents the SDK from
        // emitting its placeholder "end of stream response" text.
        stream.setAttachments([card]);
        stream.setFinalMessage(MessageFactory.attachment(card));
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
