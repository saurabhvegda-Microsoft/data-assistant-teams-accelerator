# PRD: Data Assistant — Microsoft Teams Integration for the Financial Data Agent

| Field | Value |
|---|---|
| Status | As-built baseline + roadmap |
| Version | 1.0 |
| Repo | https://github.com/saurabhvegda-Microsoft/data-assistant-teams-accelerator |

---

## 1. Overview

### Problem Statement

The Financial Data Agent is an existing service that supports natural language financial queries over a data warehouse via a REST API (Text-to-SQL). Today, users must interact with it through a dedicated web interface or direct API calls. There is no integration with the workplace tools that finance teams already use daily. This creates a context-switching burden and limits organic adoption by non-technical stakeholders.

Finance teams live in Microsoft Teams. Requiring them to leave Teams to query financial data reduces the likelihood of the Data Agent becoming part of their regular workflow.

### Solution

Build a Microsoft Teams bot (**Data Assistant**) that exposes the Data Agent's financial query capabilities as a conversational interface inside Teams. Users ask financial questions in plain English directly in Teams chat, and receive structured results — tables, metrics, and charts — rendered as Adaptive Cards without leaving the Teams environment.

### Delivery Model

This project is built as a reusable accelerator and template. The platform team prototypes and validates the integration in their own Azure subscription, then shares the open-source repository with customers who deploy it independently into their own Azure environment, pointing to their own Data Agent API instance.

```
OUR REPO (prototype)                 CUSTOMER (their deployment)
├── Bot application code             ├── Clone/fork the repo
├── Parameterized Bicep IaC          ├── Fill in .env with their values
├── Manifest with ${{}} placeholders ├── Run `atk provision` in THEIR Azure sub
├── Setup documentation              ├── Register bot in THEIR Entra ID
└── Example env files (.env.example) ├── Connect to THEIR Data Agent API
                                     └── Publish to THEIR Teams app catalog
```

---

## 2. Goals and Non-Goals

### Goals

- Allow Teams users to ask financial questions in natural language and receive Data Agent query results directly in Teams **personal 1:1 chats**.
- Render Data Agent query results as rich Adaptive Cards (tables, summary metrics, trend charts).
- Enforce stateless single-turn processing for every query (no history carryover).
- Restrict installation and runtime scope to personal chats only (defense in depth via manifest + runtime guard).
- Handle Data Agent latency with immediate typing indicator and deterministic timeout/error behavior.
- Deliver the project as a portable, customer-deployable accelerator with zero hardcoded environment-specific values.
- Provide complete setup documentation sufficient for customers to independently deploy and publish the bot.
- Establish a foundation that cleanly supports future Text-to-DAX integration.

### Non-Goals

- Building a new financial data backend.
- Supporting Microsoft channels other than Teams.
- Supporting Teams group chats or team channels (explicitly out of scope; see Personal Chat Only Plan).
- Replacing the Data Agent web interface.
- Building a custom NLU layer.
- Direct data-warehouse access from the bot.
- Building admin tooling for Data Agent configuration.

---

## 3. User Stories

### P0: MVP (Weeks 1–3)

**US-01: Basic Financial Query in Personal Chat**
As a finance team member, I want to send a financial question to Data Assistant in a Teams personal chat and receive a structured result, so that I can query financial data without leaving Teams.

Acceptance Criteria:
- User sends a plain English message to the bot in 1:1 chat.
- Bot sends a typing indicator within 2 seconds.
- Bot calls the Data Agent REST API with the user's question.
- Bot replies with the result as an Adaptive Card.
- Flow works end-to-end in local development using Dev Tunnels.

**US-02: Tabular Data Display**
As a finance user, I want data tables returned by the Data Agent to be displayed as formatted Adaptive Card tables so that results are readable and structured.

Acceptance Criteria:
- Query results with multiple rows and columns are rendered using a Teams-safe ColumnSet tabular layout.
- Column headers are displayed in bold.
- Card shows up to 10 rows with overflow note when needed.

**US-03: Summary Metrics Display**
As a finance user, I want single-value or small summary results shown as highlighted metric cards so that key numbers are visually prominent.

Acceptance Criteria:
- Aggregate metric results use a ColumnSet layout with bold values.
- Positive/negative delta values are color-coded (green/red).
- Metric label and value are clearly separated.

**US-04: SQL Transparency**
As a data-literate finance user, I want to see the SQL query the Data Agent generated for my question so that I can verify the logic and trust the results.

Acceptance Criteria:
- Each result card includes a collapsible "View SQL" section as an Action.ShowCard.
- SQL is displayed in a fixed-width code block.
- Section is collapsed by default.

**US-05: Error State Display**
As a bot user, I want to receive clear, actionable error messages when a query fails so that I know what went wrong and what to do next.

Acceptance Criteria:
- Data Agent API unreachable: "Trouble connecting to data service. Try again in a moment."
- Ambiguous query: "Need more details. Did you mean: [A] [B]?"
- No results: "No data matched. Try broadening the date range or checking the entity name."
- All error cards use an attention-colored header strip.

### P1: Production Readiness (Weeks 4–6)

Status: Planned (not fully implemented in current runtime)

**US-06: Follow-Up Questions (Multi-Turn)**
As a finance user, I want to ask follow-up questions without repeating context so that I can drill into data naturally.

**US-07: Long-Running Query Handling (Proactive Messaging)**
As a finance user, when my query takes more than 45 seconds, I want to be notified in Teams when the result is ready.

**US-08: Personal Chat Only Enforcement** *(Shipped — see [Personal Chat Only Plan](PERSONAL_CHAT_ONLY_PLAN.md))*
As a security-conscious owner, I want Data Assistant restricted to 1:1 personal chats so that financial query data and user identity aren't exposed across mixed-audience group chats or channels.

Acceptance Criteria (all met):
- Teams manifest declares `scopes: ["personal"]` — install dialog offers no group/team option.
- Runtime middleware (`personalChatOnlyMiddleware`) blocks any non-personal `message` activity with a friendly block card.
- Feature flag `PERSONAL_CHAT_ONLY_ENABLED` (default `true`) for emergency disable without redeploy.
- Unit tests cover personal/group/channel/feature-flag/cross-channel cases.

**US-09: Welcome and Onboarding Card**
As a new user, I want to see a helpful onboarding message when I first open the bot.

**US-10: Seamless SSO Authentication**
As a finance user, I want to be authenticated automatically using my Microsoft 365 login.

### P2: Hardening and Enhancements (Weeks 7+)

Status: Planned

**US-11: Audit Logging**
As a compliance officer, I want every Data Agent query logged with user identity, query text, timestamp, result row count, and latency.

**US-12: Azure AD Group-Based Access Control** *(Deprecated — superseded by Personal Chat Only)*
Originally planned for restricting group-chat use to members of a specific Entra ID security group. With US-08 shipped (personal-only), there is no group surface to authorize; the `accessControlMiddleware` was removed in R3 cleanup. The `accessControlService` utility is retained in source for any future personal-chat allowlist wiring but is currently not registered.

**US-13: Time Series and Chart Display**
As a finance analyst, I want trend data displayed as a chart rather than a table.

**US-14: CSV Export**
As a finance user, I want to download query results as a CSV file for further analysis in Excel.

---

## 4. Technical Architecture

### Technology Decision

Chosen approach (current runtime): Microsoft 365 Agents SDK (`@microsoft/agents-hosting`) on Azure Container Apps.

Rationale:
- Bot Framework SDK v4 is archived; Agents SDK is the supported successor.
- Current codebase is already implemented and tested on Agents SDK APIs.
- Container Apps is the active deployment target that works in current subscription constraints.
- Stateless policy and middleware controls are already implemented in code.

### Component Architecture

```
Teams Client (Desktop / Mobile / Web)
    |  HTTPS (TLS 1.2+)
    v
Azure Bot Service (channel registration, message routing)
    |  Activity Protocol
    v
Bot Application — Express / Node.js on Azure Container Apps
    |-- @microsoft/agents-hosting (message handling, middleware, cards)
    |-- Stateless single-turn policy (code-locked)
    |-- Personal-chat-only guard + audit + rate limiting middleware
    |  HTTPS
    v
Data Agent REST API → data warehouse → Query Results → Adaptive Card → Teams Client
```

### Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| SDK | `@microsoft/agents-hosting` | Supported Bot Framework successor used in current code |
| Language | TypeScript (Node.js 18+) | Type safety, Teams SDK native support |
| Hosting | Azure Container Apps | Active deployed runtime, warm replica configured |
| State store | None (stateless) | Current design intentionally avoids conversation history persistence |
| Auth | Bot JWT validation + bot credentials | Implemented in current runtime (`authorizeJWT`) |
| Long queries | Synchronous request with timeout/error card | Implemented today; async queue path is planned |
| IaC | Bicep (parameterized) | Customer-deployable in any Azure subscription |
| Card format | Adaptive Cards (schema v1.5+) | Native Teams rendering |

---

## 5. Phased Delivery

### Phase 1: Core Runtime (Completed)
Agents SDK bot runtime, middleware chain, card rendering (tables/metrics/timeseries), mock + real client support, Azure Container Apps deployment.

### Phase 2: Validation and Hardening (Completed)
Stateless policy lock, health reporting, personal-chat-only enforcement (manifest scope + runtime guard), telemetry/logging, test/documentation updates.

### Phase 3: Advanced Auth and Async UX (Planned)
SSO/OBO backend auth integration, async long-running query flow, proactive completion delivery.

### Phase 4: Enhancements (Planned)
CSV export, richer analytics UX, Text-to-DAX integration.

---

## 6. Success Metrics

| Category | Metric | Target |
|---|---|---|
| Adoption | Monthly Active Users | 50+ |
| Adoption | Queries per user per week | 5+ |
| Quality | Query success rate | 85%+ |
| Quality | P50 end-to-end latency | < 10s |
| Reliability | Bot uptime | 99.5%+ |
| Portability | Customer deployment time | < 4 hours |

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Data Agent latency (10–30s) exceeds user patience | Immediate typing indicator + clear timeout error card; async queue path tracked as next enhancement |
| Drift between docs and runtime behavior | Keep as-built sections explicit and update docs with each deployment change |
| Future SSO/OBO rollout complexity | Implement behind feature-gated path with staged tenant validation |
| Financial data exposure in logs | Stateless design + no result payload logging |

---

## 8. Open Questions

| # | Question | Owner |
|---|---|---|
| 1 | OBO token auth from Phase 1, or API-key initially? | Data Assistant Contributors |
| 2 | What is the Data Agent API rate limit? | Data Agent team |
| 3 | Is there a Data Agent staging endpoint for testing? | Data Agent team |
| 4 | Bot catalog name: "Data Assistant" / "Financial Data Agent" / something else for white-labeling? | Product |
| 5 | For Text-to-DAX: same Data Agent API or separate service? | Platform team |
