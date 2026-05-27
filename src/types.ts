export interface UserContext {
  userId: string;
  aadObjectId?: string;
  displayName?: string;
  conversationId: string;
  channelId: string;
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
