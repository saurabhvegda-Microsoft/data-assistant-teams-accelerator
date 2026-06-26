export interface UserContext {
  userId: string;
  aadObjectId?: string;
  displayName?: string;
  conversationId: string;
  channelId: string;
  /** Per-user Data Agent access token (Teams SSO + OBO), resolved per turn. */
  userToken?: string;
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
