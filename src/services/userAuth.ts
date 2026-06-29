import { ConfidentialClientApplication } from "@azure/msal-node";
import { createLogger } from "../logger";

const logger = createLogger("userAuth");

export interface UserAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  dataAgentScope: string;
}

export function loadUserAuthConfig(): UserAuthConfig {
  return {
    enabled: (process.env.USER_AUTH_ENABLED ?? "false") === "true",
    // Reuse the bot's app registration by default; override via AAD_* if the
    // OBO confidential client differs from the bot identity.
    clientId: process.env.AAD_CLIENT_ID || process.env.BOT_ID || "",
    clientSecret: process.env.AAD_CLIENT_SECRET || process.env.BOT_PASSWORD || "",
    tenantId: process.env.AAD_TENANT_ID || process.env.tenantId || "",
    dataAgentScope: process.env.DATA_AGENT_SCOPE || "",
  };
}

/**
 * Exchanges a user's Teams SSO assertion for a Data Agent-scoped access token
 * using the OAuth 2.0 On-Behalf-Of flow.
 */
export interface OboTokenProvider {
  exchange(userAssertion: string): Promise<string>;
}

export class MsalOboTokenProvider implements OboTokenProvider {
  private readonly cca: ConfidentialClientApplication;
  private readonly scope: string;

  constructor(config: UserAuthConfig) {
    const missing = (["clientId", "clientSecret", "tenantId", "dataAgentScope"] as const).filter(
      (k) => !config[k]
    );
    if (missing.length > 0) {
      throw new Error(
        `User auth requires AAD_CLIENT_ID, AAD_CLIENT_SECRET, AAD_TENANT_ID and DATA_AGENT_SCOPE (missing: ${missing.join(
          ", "
        )})`
      );
    }
    this.scope = config.dataAgentScope;
    this.cca = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
      },
    });
  }

  async exchange(userAssertion: string): Promise<string> {
    const result = await this.cca.acquireTokenOnBehalfOf({
      oboAssertion: userAssertion,
      scopes: [this.scope],
    });
    if (!result?.accessToken) {
      throw new Error("OBO token exchange returned no access token");
    }
    return result.accessToken;
  }
}

/**
 * Resolves a per-user Data Agent token (Teams SSO assertion → OBO), with a short
 * in-memory cache keyed by user. Disabled by default (`USER_AUTH_ENABLED`).
 */
export class UserAuthService {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();
  private readonly cacheTtlMs: number;

  constructor(
    private readonly config: UserAuthConfig,
    private readonly obo: OboTokenProvider,
    cacheTtlMs = 50 * 60_000
  ) {
    this.cacheTtlMs = cacheTtlMs;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Returns a Data Agent access token for the user, or undefined when user auth
   * is disabled, no assertion is available, or the exchange fails. Callers fall
   * back to their configured static credential when undefined.
   */
  async getDataAgentToken(
    userAssertion: string | undefined,
    userKey: string
  ): Promise<string | undefined> {
    if (!this.config.enabled) return undefined;
    if (!userAssertion) {
      logger.warn("userAuth.noAssertion", { userKey });
      return undefined;
    }

    const cached = this.cache.get(userKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    try {
      const token = await this.obo.exchange(userAssertion);
      this.cache.set(userKey, { token, expiresAt: Date.now() + this.cacheTtlMs });
      return token;
    } catch (err) {
      logger.error("userAuth.oboFailed", {
        userKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/** Builds the user auth service, or undefined when user auth is disabled. */
export function createUserAuthService(
  config: UserAuthConfig = loadUserAuthConfig()
): UserAuthService | undefined {
  if (!config.enabled) return undefined;
  logger.info("userAuth.init", { tenantId: config.tenantId, scope: config.dataAgentScope });
  return new UserAuthService(config, new MsalOboTokenProvider(config));
}
