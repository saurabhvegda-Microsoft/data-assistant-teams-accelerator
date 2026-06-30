# Data Assistant — Microsoft Teams Bot for the Financial Data Agent

Microsoft Teams conversational bot in front of the Financial Data Agent (Text-to-SQL over a data warehouse). Ask financial questions in Teams and get interactive data responses as Adaptive Cards.

> **Disclaimer:** This is a personal/community accelerator authored by a
> Microsoft employee, **not an official Microsoft product**. It is provided
> as-is under the [MIT license](LICENSE) with no warranty or support
> commitment from Microsoft. The accelerator is built on top of supported
> Microsoft products and SDKs (Microsoft Teams, Microsoft 365 Agents SDK,
> Azure Container Apps, Azure Bot Service), but Microsoft does not endorse,
> maintain, or guarantee this repository. Use at your own risk and review
> the code before deploying into your environment.

## What is this?

A **reusable accelerator** that connects Microsoft Teams to a Financial Data Agent backend (Text-to-SQL over a data warehouse). Users chat with the bot in Teams **1:1 personal chats** and receive structured financial data as Adaptive Cards.

> **Scope:** The bot is **personal chat only** (1:1). Group chats and team channels are blocked at both the manifest layer and runtime (see [Personal Chat Only Plan](docs/PERSONAL_CHAT_ONLY_PLAN.md)).

This repo is designed to be deployed independently by any customer into their own Azure subscription.

## Architecture

```
Teams Client → Azure Bot Service → Bot App (Express/Node.js, Azure Container Apps) → Data Agent API → Data Warehouse
                                         ↓
                                   Adaptive Cards (tables, metrics, charts)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full component
diagram, the as-built deployment topology, and the framework-comparison
write-up.

### Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Bot SDK | [`@microsoft/agents-hosting`](https://www.npmjs.com/package/@microsoft/agents-hosting) `^1.5.2` | The Microsoft 365 Agents SDK (Approach A in the architecture doc). Replaces the archived Bot Framework SDK v4. |
| Activity / Teams extensions | `@microsoft/agents-activity`, `@microsoft/agents-hosting-extensions-teams` | Pulled in transitively by `agents-hosting` |
| HTTP server | [`express`](https://expressjs.com/) `^4.18.2` | Routes `/api/messages` + `/api/health` |
| Outbound HTTP | [`axios`](https://github.com/axios/axios) `^1.7.0` | Used by the SDK's ConnectorClient and our `services/dataAgentClient` |
| Auth | `@azure/identity` `^4.13.1`, `@azure/core-auth` `^1.10.1` | App Reg client-secret flow; SDK handles MSAL internally |
| Observability | OpenTelemetry SDK (`@opentelemetry/sdk-node` `^0.218.0`) + Azure Monitor exporter (`@azure/monitor-opentelemetry-exporter`) | Traces, metrics, structured JSON logs |
| Adaptive Cards | v1.5 schema + Teams native charts (`Chart.Line` / `Chart.VerticalBar`) | Built in `src/cards/`; time-series render as native charts (toggle `NATIVE_CHARTS_ENABLED`), with a static image fallback |
| Language / runtime | TypeScript 5.4, Node.js **22 LTS** in container, ≥18 supported locally | `tsc` to `dist/`, no bundler |
| Tests | Jest `^29.7.0` + ts-jest | 71 tests across 10 suites |
| Container | `node:22-alpine` base, `Dockerfile` at repo root | ~150 MB image |
| Container registry | Azure Container Registry (Basic SKU) | Builds done in-cloud via `az acr build` (no local Docker required) |
| Hosting | **Azure Container Apps** (Consumption plan, `min-replicas=1`) | Min-replicas pinned to 1 so the demo container stays warm |
| Channel registration | `Microsoft.BotService/botServices` (SingleTenant) | Microsoft Teams + Web Chat + Direct Line channels enabled |
| Identity tenant | M365 Developer Program sandbox (`<your-tenant>.onmicrosoft.com`) | Separate from the constrained Azure subscription where compute lives |
| Local dev (optional, **only if editing bot code**) | Azure Dev Tunnels + `npm run dev:teams` | See "Manual local-test loop" below. For cloud-deployed customer testing, **skip this** \u2014 the Container App provides the public endpoint. |

## Quick Start

### Prerequisites

- Node.js 18+
- VS Code with [Microsoft 365 Agents Toolkit](https://marketplace.visualstudio.com/items?itemName=TeamsDevApp.ms-teams-vscode-extension) extension
- Azure subscription
- M365 tenant with sideloading enabled

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/saurabhvegda-Microsoft/data-assistant-teams-accelerator.git
cd data-assistant-teams-accelerator

# 2. Install dependencies
npm install

# 3. Configure environment
cp env/.env.dev.example env/.env.dev
# Edit env/.env.dev — set DATA_AGENT_API_BASE_URL to your Data Agent endpoint, or leave USE_MOCK_CLIENT=true

# 4. Start locally (F5 in VS Code, or via CLI)
# The Agents Toolkit creates a Dev Tunnel and sideloads the app into Teams
```

### Manual local-test loop (without Agents Toolkit)

If you've already provisioned your own Azure Bot + Dev Tunnel and just want to
re-run the bot, this is the minimum to get a real Teams round-trip:

```pwsh
# Terminal 1 — keep the public ingress alive
devtunnel host <your-tunnel-name>

# Terminal 2 — bot + mock Data Agent client + DISABLE_AUTH=false
npm run dev:teams
```

Then send a message to the bot in Teams (where it's already sideloaded).

**First-time setup (per developer / tenant) — one-time only:**

1. Have a Microsoft 365 tenant where you can sideload custom apps
   (e.g. https://developer.microsoft.com/microsoft-365/dev-program).
2. Create an App Registration + Service Principal + client secret in that
   tenant. The SP must exist in the tenant or the Bot Connector token
   exchange returns `AADSTS7000229`:
   ```pwsh
   az ad app create --display-name "Data Assistant Dev" --sign-in-audience AzureADMyOrg
   az ad sp create --id <appId>
   az ad app credential reset --id <appId> --years 1
   ```
3. Create an Azure Dev Tunnel and remember its name + public URL:
   ```pwsh
   devtunnel create <name> --allow-anonymous
   devtunnel port create <name> -p 3978
   devtunnel show <name>   # copy the https URL
   ```
4. Create an Azure Bot pointing at that URL (Bot Service can live in any Azure
   sub; it just needs `--tenant-id` and `--appid` matching step 2):
   ```pwsh
   az bot create -g <rg> -n <bot-name> --app-type SingleTenant `
     --appid <appId> --tenant-id <tenantId> `
     --endpoint https://<tunnel>/api/messages --sku F0
   az bot msteams create -g <rg> -n <bot-name>
   ```
5. Fill in `env/.env.dev` from the values above (`BOT_ID`, `BOT_PASSWORD`,
   `tenantId`, `TEAMS_APP_ID`).
6. Build the sideload package — manifest has `${{BOT_ID}}` / `${{TEAMS_APP_ID}}`
   placeholders, so substitute first:
   ```pwsh
   $m = Get-Content appPackage\manifest.json -Raw
   $m = $m.Replace('${{BOT_ID}}', $env:BOT_ID).Replace('${{TEAMS_APP_ID}}', $env:TEAMS_APP_ID)
   $m | Set-Content appPackage\manifest.json
   Compress-Archive -Path appPackage\manifest.json,appPackage\color.png,appPackage\outline.png `
     -DestinationPath data-assistant-test.zip -Force
   ```
   (A `tools/buildPackage` helper script is on the backlog so this is one
   command. For now copy-paste works.)
7. In Teams (signed into the tenant from step 1):
   **Apps → Manage your apps → Upload an app → Upload a custom app →
   pick `data-assistant-test.zip`**.

After this, day-to-day iteration is just the two-terminal loop at the top
of this section. The tunnel URL and Bot Service stay valid until you tear
them down.

### Deploy to Azure

Two supported paths. **Container Apps is what this repo's working demo deploys
to today** — App Service is the original Bicep template, kept for reference.

#### Option A — Azure Container Apps (recommended, ~10 min)

Uses the included `Dockerfile`. No Docker Desktop needed on your machine
(ACR builds the image in the cloud). Resilient to local restarts, network
flakes, and dev-tunnel quirks.

```pwsh
$RG = 'rg-data-assistant-dev'
$LOCATION = 'centralus'   # or any region where you have App Service / Container Apps quota
$ACR = "dataassistantacr$(([guid]::NewGuid().ToString('N')).Substring(0,6))"   # globally unique
$ENV_NAME = 'data-assistant-env'
$APP = 'data-assistant-app'
$IMAGE = "${ACR}.azurecr.io/data-assistant:v1"

# 0. One-time provider registration (idempotent)
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.ContainerRegistry --wait

# 1. Container registry
az acr create -g $RG -n $ACR --sku Basic --location $LOCATION --admin-enabled true

# 2. Build TypeScript locally, then build + push the container image in ACR
npm run build
az acr build --registry $ACR --image data-assistant:v1 --file Dockerfile .

# 3. Container Apps environment
az containerapp env create -g $RG -n $ENV_NAME --location $LOCATION --logs-destination none

# 4. Create the Container App (pulls BOT_PASSWORD from your local env\.env.dev)
$creds = az acr credential show -n $ACR --query "{u:username,p:passwords[0].value}" -o json | ConvertFrom-Json
$envHash = @{}
Get-Content env\.env.dev | Where-Object { $_ -match '^[A-Za-z]' } |
    ForEach-Object { $kv = $_ -split '=',2; $envHash[$kv[0]] = $kv[1] }

az containerapp create -g $RG -n $APP `
    --environment $ENV_NAME --image $IMAGE `
    --target-port 3978 --ingress external `
    --registry-server "${ACR}.azurecr.io" --registry-username $creds.u --registry-password $creds.p `
    --min-replicas 1 --max-replicas 1 --cpu 0.5 --memory 1.0Gi `
    --secrets "bot-password=$($envHash['BOT_PASSWORD'])" `
    --env-vars `
        BOT_ID=$($envHash['BOT_ID']) `
        tenantId=$($envHash['tenantId']) `
        TEAMS_APP_ID=$($envHash['TEAMS_APP_ID']) `
        USE_MOCK_CLIENT=true `
        DISABLE_AUTH=false `
        PERSONAL_CHAT_ONLY_ENABLED=true `
        DNS_SERVERS= `
        NODE_ENV=production `
        "BOT_PASSWORD=secretref:bot-password"

# 5. Point the Azure Bot at the new endpoint
$fqdn = az containerapp show -g $RG -n $APP --query "properties.configuration.ingress.fqdn" -o tsv
az bot update -g $RG -n <your-bot-name> --endpoint "https://$fqdn/api/messages"
```

Iterate later by rebuilding the image and forcing a new revision:

```pwsh
npm run build
az acr build --registry $ACR --image data-assistant:v2 --file Dockerfile .
az containerapp update -g $RG -n $APP --image "${ACR}.azurecr.io/data-assistant:v2"
```

Tail logs:

```pwsh
# JSON output avoids a charmap encoding bug in the az CLI on Windows
az containerapp logs show -g $RG -n $APP --tail 50
```

#### Option B — App Service via Bicep / Agents Toolkit

```bash
# Provision Azure resources (Bot, App Service) in your subscription
atk provision --env dev

# Deploy the bot application
atk deploy --env dev
```

This is the original `infra/main.bicep` path. It still works for tenants with
App Service VM quota, but **on constrained constrained dev subscriptions you may hit
`Current Limit (Total VMs): 0`** — in that case use Option A above.

## Project Structure

```
├── src/                    # Bot application code
│   ├── index.ts            # Express server entry point
│   ├── bot.ts              # Message handler
│   ├── services/           # Data Agent API client (real + mock)
│   └── cards/              # Adaptive Card builders
├── appPackage/             # Teams app manifest (parameterized)
├── infra/                  # Bicep templates for Azure provisioning
├── env/                    # Environment config templates
├── docs/                   # PRD, Architecture, Setup guide
└── test/                   # Unit tests
```

## Testing

Type-check, unit tests, and lint:

```bash
npm run build     # tsc type-check + emit to dist/
npm test          # Jest unit tests (71 across 10 suites)
npm run lint      # ESLint
```

### Local MCP + streaming smoke test

Exercise the MCP client and streamed progress updates end-to-end against the
bundled mock MCP server — no Teams tenant or real Data Agent required:

```pwsh
# Terminal 1 — mock MCP server (Streamable HTTP on :4100)
npm run mock-mcp

# Terminal 2 — run the bot against it (MCP backend, auth disabled for local dev)
npm run dev:mcp
```

Or drive the MCP client directly after `npm run build`:

```pwsh
node -e "(async()=>{const {McpDataAgentClient}=require('./dist/services/mcpDataAgentClient.js');const c=new McpDataAgentClient({endpointUrl:'http://localhost:4100/mcp'});const ups=[];const r=await c.query('revenue by region',{userId:'u1',conversationId:'c1',channelId:'msteams'},u=>ups.push(u.message));console.log('progress:',ups);console.log('result:',r.success,r.data&&r.data.type);})()"
```

You should see the staged progress messages followed by the mapped result. The
client to use is selected by `DATA_AGENT_CLIENT` (`mock` | `rest` | `mcp`); set
`STREAMING_ENABLED=false` to fall back to a typing indicator + single card.

### Viewing the cards & charts in Teams

Native charts (`Chart.Line` / `Chart.VerticalBar`) and streamed progress only
render on a Microsoft Teams surface. Two ways to see them:

**A. M365 Agents Playground — quickest (no tenant, no tunnel).**

```pwsh
# Terminal 1 — bot + mock data (auth disabled)
npm run dev:playground
# Terminal 2 — open the Teams-like test UI at http://localhost:56150
npm run playground
```

Then chat with the bot: `monthly revenue trend` (line chart), `graph test`
(chart demo), `revenue by region` (table), `total revenue` (metrics). Toggle
`NATIVE_CHARTS_ENABLED=false` to see the static-image fallback. If the bot
doesn't respond in the Test Tool, add `STREAMING_ENABLED=false` (streaming UX is
best verified in real Teams).

> The Test Tool mirrors Teams rendering, but very new chart elements may not draw
> there — the real Teams path below is authoritative.

**B. Real Teams — authoritative (charts + streaming).**

Sideload the app via the "Manual local-test loop" or "Deploy to Azure" steps
above (needs an M365 tenant, an Azure Bot, and a Dev Tunnel or Container App).
Ensure `NATIVE_CHARTS_ENABLED=true` and `STREAMING_ENABLED=true`, then in a 1:1
chat:
- `monthly revenue trend` → line chart; a single-series query → bar chart
- watch the blue "informative update" progress bar before the final card

Dump the exact card payloads (for inspection / sharing) without running anything:

```pwsh
npm run card:preview   # writes card-previews/*.json (line, bar, table, metrics, image-fallback)
```

## Documentation

- [Feature Status](docs/FEATURE_STATUS.md) — capability matrix (streamed progress, history, MCP tool, per-user auth, charts), flags, and what each needs to enable
- [PRD](docs/PRD.md) — Product requirements, user stories, phased delivery plan
- [Architecture](docs/ARCHITECTURE.md) — Technical architecture, framework comparison, deployment strategy
- [Personal Chat Only Plan](docs/PERSONAL_CHAT_ONLY_PLAN.md) — Manifest scope + runtime guard rationale and rollout (shipped)
- [Testing Real Teams](docs/TESTING_REAL_TEAMS.md) — End-to-end test guide including Stateless Validation & Demo (Production)
- [MCP Tool Contract](docs/MCP_CONTRACT.md) — what the Data Agent must implement to be MCP-compatible (tool name, schemas, progress, history)

## Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `DATA_AGENT_API_BASE_URL` | Your Data Agent REST API endpoint | — |
| `DATA_AGENT_API_KEY` | Optional bearer token for the Data Agent API | — |
| `USE_MOCK_CLIENT` | Use mock responses for prototyping | `true` |
| `PERSONAL_CHAT_ONLY_ENABLED` | Runtime guard that blocks non-personal conversations | `true` |
| `BOT_ID` | Azure Bot resource ID | Auto-generated by `atk provision` |
| `BOT_PASSWORD` | Bot app secret | Auto-generated |

By default each query is single-turn (`X-Conversation-Context=single-turn`, `X-History-Policy=none`). Set `CONVERSATION_HISTORY_ENABLED=true` to maintain **server-side** conversation history — the bot sends a stable session id per chat and offers a **New conversation** reset (slash command `/new` or the card button), while storing only the opaque id, never message content. See [docs/MCP_CONTRACT.md](docs/MCP_CONTRACT.md).

## Scopes

| Scope | Supported |
|-------|-----------|
| Personal (1:1 chat) | Yes |
| Group Chat | **No** (blocked by manifest + runtime guard) |
| Team Channel | **No** (blocked by manifest + runtime guard) |

See [docs/PERSONAL_CHAT_ONLY_PLAN.md](docs/PERSONAL_CHAT_ONLY_PLAN.md) for rationale and verification.

## User authentication (Teams SSO + On-Behalf-Of)

By default the bot calls the Data Agent with a static service credential
(`DATA_AGENT_API_KEY`) and passes the caller's id as a header. To have the Data
Agent receive the **end user's own JWT** — so Row-Level Security is enforced for
the actual user rather than a shared identity — enable per-user auth:

1. **Expose an API scope** on the Data Agent's Entra app registration, e.g.
   `api://<data-agent-app-id>/access_as_user`.
2. **Configure Teams SSO** for the bot: the manifest declares `webApplicationInfo`
   (`id` = bot app id, `resource` = `AAD_APPLICATION_ID_URI`, the bot's
   Application ID URI). Grant the bot app delegated permission to the Data Agent
   scope and admin-consent.
3. **Set env** (see `env/.env.*.example`): `USER_AUTH_ENABLED=true`,
   `DATA_AGENT_SCOPE`, and — if the OBO confidential client differs from the bot —
   `AAD_CLIENT_ID` / `AAD_CLIENT_SECRET` / `AAD_TENANT_ID`.

At runtime the bot takes the user's Teams SSO token and performs an OAuth 2.0
**On-Behalf-Of** exchange (`src/services/userAuth.ts`) for a Data Agent-scoped
token, sent as `Authorization: Bearer` on each request. Tokens are cached per
user and never logged. When disabled (the default), behavior is unchanged.

> The OBO exchange is implemented and unit-tested. Acquiring the SSO assertion
> silently on every turn requires an Azure Bot **OAuth connection** (or the
> `signin/tokenExchange` invoke flow); until that is configured,
> `getDataAgentToken` returns no token and the bot falls back to the static
> credential.

## License

MIT — see [LICENSE](LICENSE).
