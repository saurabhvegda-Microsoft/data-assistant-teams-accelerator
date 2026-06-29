export interface UserContext {
  userId: string;
  aadObjectId?: string;
  displayName?: string;
  conversationId: string;
  channelId: string;
  /** Per-user Data Agent access token (Teams SSO + OBO), resolved per turn. */
  userToken?: string;
  /**
   * Stable conversation session id propagated to the Data Agent for server-side
   * history (only set when CONVERSATION_HISTORY_ENABLED). Absent → single-turn.
   */
  sessionId?: string;
}

export interface ConversationMemberInfo {
  id: string;
  aadObjectId?: string;
  displayName?: string;
  role?: string;
}

export interface AccessCheckResult {
  allowed: boolean;
  checkedMembers: ConversationMemberInfo[];
  unauthorizedCount: number;
  reason?: string;
}
