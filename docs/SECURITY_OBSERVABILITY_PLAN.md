# Security, Observability & Alerting Plan

## Context

Data Assistant is a working prototype that queries financial data via the Financial Data Agent API and returns Adaptive Cards in Teams. Before connecting to the real Data Agent API and deploying to production, it needs:
- **Security**: Authentication validation, user identity passthrough for RLS, audit logging, rate limiting
- **Observability**: Application Insights integration, structured logging, custom telemetry spans
- **Alerting**: Automated alerts for downtime, latency, and error spikes
- **Infrastructure**: Azure resources wired for the target hosting model (current demo runs on Azure Container Apps)

Key discovery: `@microsoft/agents-hosting` already includes 84 pre-built OpenTelemetry spans and 21 metrics — they auto-activate once we install `@opentelemetry/api`. Minimal code needed.

---

## Architecture

```
┌─────────────┐      TLS + JWT       ┌──────────────────────────────┐      TLS + API Key     ┌─────────────┐
│   Teams     │ ──────────────────→  │ Bot (Azure Container Apps)   │ ──────────────────→    │ Data Agent  │
│  (User)     │ ←────────────────── │  + Managed Identity          │ ←──────────────────    │ (Text-to-SQL)│
└─────────────┘   Adaptive Cards     │  + Rate Limiting             │    Query Results        └─────────────┘
                                      │  + Audit Logging             │                               │
                                      └──────────────────────────────┘                               ↓
                                               │          │                                   Data Warehouse (with RLS)
                                               ↓          ↓
                                        App Insights   Key Vault
                                        (telemetry)    (secrets)
```

---

## Security

### Authentication
| Layer | Mechanism |
|-------|-----------|
| Teams → Bot | Microsoft Entra ID JWT validation (built into `@microsoft/agents-hosting`) |
| Bot → Data Agent API | API Key or bearer token header (config-driven; secret storage depends on deployment target) |
| User identity | Passed through from Teams activity (`from.aadObjectId`) |

### Authorization
- **Conversation scope**: bot is restricted to **1:1 personal chats only** at both the manifest layer (`scopes: ["personal"]`) and the runtime layer (`personalChatOnlyMiddleware`, default-deny for non-personal Teams conversations). See [PERSONAL_CHAT_ONLY_PLAN.md](./PERSONAL_CHAT_ONLY_PLAN.md).
- **Tenant isolation**: Bot registered per-tenant, only tenant users can interact
- **RLS passthrough**: User's Azure AD Object ID sent as `X-User-AAD-Object-Id` header to the Data Agent API
- **Read-only**: Bot can only query — no writes, no admin operations
- **Rate limiting**: 30 queries/minute per user (in-memory, single-instance)

### Data Protection
- All traffic TLS 1.2+ encrypted
- Bot is **stateless** — no conversation history or query results stored
- Secrets in Azure Key Vault (never in code or env files)
- Financial data (query results) NEVER logged

---

## Observability

### Application Insights Integration
- OpenTelemetry SDK bootstrapped at app start
- Azure Monitor exporter sends traces, metrics, and logs
- 84 built-in spans from `@microsoft/agents-hosting` auto-activate
- Custom spans: `dataAgent.api.query`, `dataAgent.card.build` (span names kept verbatim from the original client code)

### Structured Logging
Every log entry contains: `{ timestamp, level, namespace, correlationId, userId, action, duration, status, message }`

**What IS logged**: query text, user ID, timestamps, latency, success/fail status, error messages
**What is NEVER logged**: query results, financial data, PII beyond user ID/name

### Metrics
| Metric | Purpose |
|--------|---------|
| Query latency (p50, p95, p99) | Performance monitoring |
| Success/error rate | Reliability tracking |
| Active users (daily/weekly) | Adoption |
| Queries per user | Engagement |
| Out-of-scope rate | Training signal |

### Health Endpoint
`GET /api/health` returns:
```json
{
  "status": "ok | degraded",
  "timestamp": "ISO8601",
  "version": "1.0.0",
  "dependencies": {
    "dataAgent": { "status": "healthy | unhealthy", "latency": 123 }   // JSON key kept verbatim from the existing /api/health response
  },
  "statelessPolicyEnabled": true
}
```

---

## Alerting

| Alert | Severity | Trigger |
|-------|----------|---------|
| Bot unavailable | Critical | 0 successful requests in 5 minutes |
| High P95 latency | Warning | P95 > 10s for 5 minutes |
| High error rate | Warning | Error rate > 10% in 5 minute window |
| Data Agent API slow | Info | P95 response > 5s |

See [ALERTING.md](./ALERTING.md) for KQL queries and configuration.

---

## Implementation Files

### New Files
| File | Purpose |
|------|---------|
| `src/telemetry.ts` | OTel SDK + Azure Monitor bootstrap |
| `src/logger.ts` | Structured logging wrapper |
| `src/types.ts` | Shared types (UserContext) |
| `src/middleware/auditMiddleware.ts` | User identity extraction + audit trail |
| `src/middleware/rateLimitMiddleware.ts` | Per-user rate limiting |
| `src/middleware/personalChatOnlyMiddleware.ts` | Runtime guard — blocks non-personal conversations |
| `src/cards/personalChatOnlyCard.ts` | Block card returned when guard fires |

### Modified Files
| File | Changes |
|------|---------|
| `src/index.ts` | Import telemetry first, structured logs, enhanced health endpoint |
| `src/bot.ts` | Register middleware, pass userContext to query, use logger |
| `src/services/dataAgentClient.ts` | UserContext param, RLS headers, healthCheck(), OTel span (file name kept; client targets the Data Agent API) |
| `infra/main.bicep` | App Service reference template with App Insights/Key Vault/alerts (not the active demo runtime) |

---

## Dependencies Added
```
@opentelemetry/api
@opentelemetry/api-logs
@opentelemetry/sdk-node
@opentelemetry/sdk-logs
@opentelemetry/sdk-metrics
@opentelemetry/resources
@opentelemetry/semantic-conventions
@azure/monitor-opentelemetry-exporter
```
