import { TurnContext, MessageFactory } from "@microsoft/agents-hosting";
import { buildPersonalChatOnlyCard } from "../cards/personalChatOnlyCard";
import { createLogger } from "../logger";

const logger = createLogger("personalChatOnlyMiddleware");

function isPersonalConversation(context: TurnContext): boolean {
  // Non-Teams channels (webchat, directline, emulator, msteams test) are inherently 1:1 — allow.
  // Default-deny only applies to Teams: must be explicit `personal` and not flagged isGroup.
  const channelId = context.activity.channelId;
  const conversation = context.activity.conversation as any;
  if (!conversation) return channelId !== "msteams";
  if (conversation.isGroup === true) return false;
  if (channelId !== "msteams") return true;
  return conversation.conversationType === "personal";
}

export function createPersonalChatOnlyMiddleware() {
  return async (context: TurnContext, next: () => Promise<void>): Promise<void> => {
    const enabled = (process.env.PERSONAL_CHAT_ONLY_ENABLED ?? "true") !== "false";
    if (!enabled) {
      await next();
      return;
    }

    const activity = context.activity;

    // Only guard user messages. Membership and other system activities pass through.
    if (activity.type !== "message") {
      await next();
      return;
    }

    if (isPersonalConversation(context)) {
      await next();
      return;
    }

    const conversation = activity.conversation as any;
    logger.warn("personalChatOnly.blocked", {
      conversationId: conversation?.id,
      conversationType: conversation?.conversationType,
      isGroup: conversation?.isGroup,
      userId: activity.from?.id,
      aadObjectId: (activity.from as any)?.aadObjectId,
    });

    await context.sendActivity(
      MessageFactory.attachment(buildPersonalChatOnlyCard())
    );
    // Intentionally do NOT call next(): backend query and downstream middleware are skipped.
  };
}
