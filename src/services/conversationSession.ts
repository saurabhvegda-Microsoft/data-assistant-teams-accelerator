import { randomUUID } from "node:crypto";
import { createLogger } from "../logger";

const logger = createLogger("conversationSession");

export function conversationHistoryEnabled(): boolean {
  return (process.env.CONVERSATION_HISTORY_ENABLED ?? "false") === "true";
}

const RESET_COMMANDS = new Set([
  "/new",
  "/reset",
  "new conversation",
  "new chat",
  "start over",
  "reset conversation",
]);

/** True when the user's text is a "start a fresh conversation" command. */
export function isResetCommand(text: string): boolean {
  return RESET_COMMANDS.has(text.trim().toLowerCase());
}

/**
 * Maps a Teams conversation to a stable session id that the bot propagates to
 * the Data Agent so the *server* maintains conversation history — the bot itself
 * stays effectively stateless (it stores only an opaque id, never message
 * content). "Start fresh" rotates the id.
 *
 * The map is in-memory and per-replica; for a multi-replica deployment back it
 * with a shared store (e.g. the SDK ConversationState over Azure Blob/Cosmos).
 */
export class ConversationSessionService {
  private readonly sessions = new Map<string, string>();

  constructor(private readonly enabled = conversationHistoryEnabled()) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Returns the stable session id for a conversation, creating one if needed. */
  getSessionId(conversationId: string): string {
    let id = this.sessions.get(conversationId);
    if (!id) {
      id = randomUUID();
      this.sessions.set(conversationId, id);
    }
    return id;
  }

  /** Rotates the session id for a conversation (clears server-side context). */
  resetSession(conversationId: string): string {
    const id = randomUUID();
    this.sessions.set(conversationId, id);
    logger.info("conversation.reset", { conversationId });
    return id;
  }

  clear(): void {
    this.sessions.clear();
  }
}

/** Builds the session service, or undefined when conversation history is disabled. */
export function createConversationSessionService(): ConversationSessionService | undefined {
  if (!conversationHistoryEnabled()) return undefined;
  logger.info("conversationSession.init", { enabled: true });
  return new ConversationSessionService(true);
}
