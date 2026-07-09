import { AccessCheckResult } from "../types";
import { DefaultAzureCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { createLogger } from "../logger";

const logger = createLogger("accessControl");

export interface IAccessControlService {
  checkAccess(aadObjectIds: string[]): Promise<AccessCheckResult>;
}

export class NoOpAccessControlService implements IAccessControlService {
  async checkAccess(aadObjectIds: string[]): Promise<AccessCheckResult> {
    return {
      allowed: true,
      checkedMembers: [],
      unauthorizedCount: 0,
    };
  }
}

export class AllowlistAccessControlService implements IAccessControlService {
  private readonly allowlist: Set<string>;

  constructor(allowedIds: string[]) {
    this.allowlist = new Set(allowedIds.map((id) => id.toLowerCase()));
  }

  async checkAccess(aadObjectIds: string[]): Promise<AccessCheckResult> {
    if (aadObjectIds.length === 0) {
      return { allowed: true, checkedMembers: [], unauthorizedCount: 0 };
    }

    if (this.allowlist.size === 0) {
      return {
        allowed: false,
        checkedMembers: [],
        unauthorizedCount: aadObjectIds.length,
        reason: "No authorized users configured",
      };
    }

    const unauthorizedCount = aadObjectIds.filter(
      (id) => !this.allowlist.has(id.toLowerCase())
    ).length;

    return {
      allowed: unauthorizedCount === 0,
      checkedMembers: [],
      unauthorizedCount,
      reason:
        unauthorizedCount > 0
          ? "One or more members lack data access permissions"
          : undefined,
    };
  }
}

export class EntraGroupAccessControlService implements IAccessControlService {
  private readonly groupId: string;
  private readonly graphClient: Client;
  private readonly memberCache = new Map<
    string,
    { isMember: boolean; cachedAt: number }
  >();
  private readonly cacheTtlMs: number;

  constructor(groupId: string, cacheTtlMs = 300_000) {
    this.groupId = groupId;
    this.cacheTtlMs = cacheTtlMs;

    const credential = new DefaultAzureCredential();
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ["https://graph.microsoft.com/.default"],
    });
    this.graphClient = Client.initWithMiddleware({ authProvider });
  }

  async checkAccess(aadObjectIds: string[]): Promise<AccessCheckResult> {
    if (aadObjectIds.length === 0) {
      return { allowed: true, checkedMembers: [], unauthorizedCount: 0 };
    }

    const now = Date.now();
    const uncachedIds: string[] = [];
    const results = new Map<string, boolean>();

    for (const id of aadObjectIds) {
      const cached = this.memberCache.get(id.toLowerCase());
      if (cached && now - cached.cachedAt < this.cacheTtlMs) {
        results.set(id, cached.isMember);
      } else {
        uncachedIds.push(id);
      }
    }

    if (uncachedIds.length > 0) {
      try {
        const memberIds = await this.checkGroupMembership(uncachedIds);
        for (const id of uncachedIds) {
          const isMember = memberIds.has(id.toLowerCase());
          results.set(id, isMember);
          this.memberCache.set(id.toLowerCase(), { isMember, cachedAt: now });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("entraGroupCheck.failed", { error: message });
        return {
          allowed: false,
          checkedMembers: [],
          unauthorizedCount: uncachedIds.length,
          reason: "Unable to verify group membership via Entra ID",
        };
      }
    }

    const unauthorizedCount = Array.from(results.values()).filter(
      (isMember) => !isMember
    ).length;

    return {
      allowed: unauthorizedCount === 0,
      checkedMembers: [],
      unauthorizedCount,
      reason:
        unauthorizedCount > 0
          ? "One or more members are not in the authorized security group"
          : undefined,
    };
  }

  private async checkGroupMembership(
    aadObjectIds: string[]
  ): Promise<Set<string>> {
    const response = await this.graphClient
      .api(`/groups/${this.groupId}/checkMemberObjects`)
      .post({ ids: aadObjectIds });

    const memberIds = new Set<string>(
      (response.value as string[]).map((id: string) => id.toLowerCase())
    );
    return memberIds;
  }

  resetCache(): void {
    this.memberCache.clear();
  }
}

export function createAccessControlService(): IAccessControlService {
  const mode = process.env.ACCESS_CONTROL_MODE || "allowlist";

  if (mode === "disabled") {
    logger.info("accessControl.init", { mode: "disabled" });
    return new NoOpAccessControlService();
  }

  if (mode === "entra") {
    const groupId = process.env.ACCESS_CONTROL_ENTRA_GROUP_ID;
    if (!groupId) {
      throw new Error(
        "ACCESS_CONTROL_ENTRA_GROUP_ID is required when ACCESS_CONTROL_MODE=entra"
      );
    }
    const cacheTtl = parseInt(
      process.env.ACCESS_CONTROL_CACHE_TTL_MS || "300000",
      10
    );
    logger.info("accessControl.init", { mode: "entra", groupId });
    return new EntraGroupAccessControlService(groupId, cacheTtl);
  }

  const allowlist = (process.env.ACCESS_CONTROL_ALLOWLIST || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  logger.info("accessControl.init", {
    mode: "allowlist",
    count: allowlist.length,
  });
  return new AllowlistAccessControlService(allowlist);
}
