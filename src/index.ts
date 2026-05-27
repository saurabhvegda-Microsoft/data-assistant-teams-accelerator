import { config } from "dotenv";
config({ path: "./env/.env.dev" });

// --------------------------------------------------------------------------
// Optional DNS override for this Node process only.
//
// Why: some Windows dev machines have flaky default resolvers (or restrictive
// corp DNS) that intermittently return ENOTFOUND for Bot Connector hosts
// (smba.trafficmanager.net, webchat.botframework.com, *.devtunnels.ms, etc.).
//
// How: dns.setServers() alone is insufficient because it only affects
// dns.resolve*() — Node's net/http stack (and thus axios) uses dns.lookup,
// which calls getaddrinfo via the OS resolver. We monkey-patch dns.lookup to
// route through dns.resolve4/6 (which DO honor setServers). All other DNS on
// the machine (OS, browsers, corp NRPT) is untouched — this only affects
// this Node process.
//
// We use require() rather than import: the ESM namespace object exposes
// dns.lookup as a non-configurable getter, so it cannot be monkey-patched.
// The CJS module exports object is mutable.
//
// Disable by setting DNS_SERVERS="" in env/.env.dev.
// --------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dns = require("node:dns") as typeof import("node:dns");
const dnsServers = (process.env.DNS_SERVERS ?? "1.1.1.1,1.0.0.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (dnsServers.length > 0) {
  dns.setServers(dnsServers);
  const resolver = new dns.promises.Resolver();
  resolver.setServers(dnsServers);
  const originalLookup = dns.lookup;

  // Names we must NOT send to public DNS — they'd hang or be misresolved.
  // Anything that the OS resolver should handle directly:
  //   - IP literals (IPv4 / IPv6)
  //   - localhost (and *.localhost)
  //   - single-label hostnames (no dot) — typically intranet names
  //   - .local / .lan / .internal mDNS / private suffixes
  //   - common reserved TLDs from RFC 6761
  const PRIVATE_SUFFIXES = [
    ".local", ".localhost", ".lan", ".internal", ".intranet",
    ".invalid", ".test", ".example",
  ];
  const isIpLiteral = (h: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(":");
  const isPrivateHost = (h: string) => {
    if (!h) return true;
    if (h === "localhost") return true;
    if (isIpLiteral(h)) return true;
    if (!h.includes(".")) return true; // single-label
    const lower = h.toLowerCase();
    return PRIVATE_SUFFIXES.some((s) => lower === s.slice(1) || lower.endsWith(s));
  };

  const patchedLookup = function patchedLookup(
    hostname: string,
    optionsOrCb: any,
    maybeCb?: any
  ): any {
    const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
    const opts =
      typeof optionsOrCb === "object" && optionsOrCb !== null
        ? optionsOrCb
        : typeof optionsOrCb === "number"
        ? { family: optionsOrCb }
        : {};

    // Short-circuit: anything that shouldn't go to public DNS goes
    // straight to the original OS resolver (handles hosts file, NRPT,
    // mDNS, IP literals, etc.).
    if (isPrivateHost(hostname)) {
      return (originalLookup as any)(hostname, opts, cb);
    }

    const family: 0 | 4 | 6 = opts.family ?? 0;
    const all: boolean = !!opts.all;

    const tryFamily = async (): Promise<{ address: string; family: 4 | 6 }[]> => {
      if (family === 4) {
        const a = await resolver.resolve4(hostname);
        return a.map((address) => ({ address, family: 4 as const }));
      }
      if (family === 6) {
        const a = await resolver.resolve6(hostname);
        return a.map((address) => ({ address, family: 6 as const }));
      }
      // family === 0 → prefer IPv4, fall back to IPv6
      try {
        const v4 = await resolver.resolve4(hostname);
        if (v4.length > 0) return v4.map((address) => ({ address, family: 4 as const }));
      } catch { /* fall through */ }
      const v6 = await resolver.resolve6(hostname);
      return v6.map((address) => ({ address, family: 6 as const }));
    };

    tryFamily()
      .then((results) => {
        if (results.length === 0) {
          const err: any = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
          err.code = "ENOTFOUND";
          err.hostname = hostname;
          return cb(err);
        }
        if (all) return cb(null, results);
        const first = results[0];
        cb(null, first.address, first.family);
      })
      .catch((err: any) => {
        // Last-resort fallback to the OS resolver so we don't make things worse
        (originalLookup as any)(hostname, opts, cb);
        void err;
      });
  };
  (dns as any).lookup = patchedLookup;
}

import "./telemetry";
import express from "express";
import { CloudAdapter, authorizeJWT, loadAuthConfigFromEnv } from "@microsoft/agents-hosting";
import { DataAssistantBot } from "./bot";
import { createLogger } from "./logger";

const logger = createLogger("server");
if (dnsServers.length > 0) {
  logger.info("dns.serversOverride", { servers: dnsServers });
}
const statelessPolicyEnabled = true;
logger.info("stateless.policy", { enabled: statelessPolicyEnabled });

const app = express();
app.use(express.json());

// Bridge Agents Toolkit env names (BOT_ID/BOT_PASSWORD) into the
// SDK-native names (clientId/clientSecret) BEFORE loadAuthConfigFromEnv().
// The SDK reads credentials via process.env into the internal connections
// Map; mutating the returned object's top-level fields does not propagate
// to MsalConnectionManager.
// tenantId is intentionally left unset: the bot is MultiTenant, so the SDK
// defaults the authority/issuers to botframework.com.
if (process.env.BOT_ID && !process.env.clientId) {
  process.env.clientId = process.env.BOT_ID;
}
if (process.env.BOT_PASSWORD && !process.env.clientSecret) {
  process.env.clientSecret = process.env.BOT_PASSWORD;
}

const authConfig = loadAuthConfigFromEnv();

const adapter = new CloudAdapter(authConfig);

adapter.onTurnError = async (context, error) => {
  // Surface full error details (the SDK sometimes throws plain Error or wrapped objects)
  const errAny = error as any;
  logger.error("adapter.turnError", {
    message: error?.message,
    name: error?.name,
    code: errAny?.code,
    cause: errAny?.cause?.message ?? errAny?.cause,
    stack: error?.stack,
    serviceUrl: context.activity?.serviceUrl,
    conversationType: (context.activity?.conversation as any)?.conversationType,
  });
  // Never let the error-reply itself crash the bot
  try {
    await context.sendActivity(
      "The bot encountered an error. Please try again."
    );
  } catch (replyErr) {
    logger.error("adapter.turnError.replyFailed", {
      message: (replyErr as Error)?.message,
    });
  }
};

const bot = new DataAssistantBot();

const jwtMiddleware = process.env.DISABLE_AUTH === "true"
  ? (_req: any, _res: any, next: any) => next()
  : authorizeJWT(authConfig);

app.post("/api/messages", jwtMiddleware, async (req, res) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

app.get("/api/health", async (_req, res) => {
  try {
    const dataAgentHealth = await bot.checkDependencyHealth();
    const status = dataAgentHealth.status === "healthy" ? "ok" : "degraded";
    res.status(status === "ok" ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      dependencies: { dataAgent: dataAgentHealth },
      statelessPolicyEnabled,
    });
  } catch {
    res.status(503).json({
      status: "degraded",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      dependencies: { dataAgent: { status: "unhealthy", latency: -1 } },
      statelessPolicyEnabled,
    });
  }
});

const port = process.env.PORT || 3978;
app.listen(port, () => {
  logger.info("server.started", { port, endpoint: `/api/messages` });
});
