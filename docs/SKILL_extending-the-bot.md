# Skill: extending this bot (patterns & gotchas)

A focused playbook of the non-obvious, hard-won knowledge for working on this
accelerator — a Microsoft Teams bot (M365 Agents SDK) that fronts a Text-to-SQL
Data Agent over MCP. Read this before touching streaming, MCP, charts, auth, or
the Azure deploy.

---

## 1. Streamed progress UX — one status, not a stream of messages

**Goal:** between the prompt and the result, show a single "working" indicator,
not a separate chat message per backend step.

**Gotchas (verified):**
- `StreamingResponse.queueInformativeUpdate(text)` renders as **one in-place
  progress bar in real Teams**, but as **separate stacked bubbles** on Web Chat /
  the Teams App Test Tool / Emulator (these report `isStreamingChannel === true`
  but don't collapse updates). Don't relay every step and assume it looks fine —
  test where it stacks.
- Ending a stream with only `setAttachments([...])` and no text makes the SDK
  inject the literal placeholder text **`end of stream response`**
  (`createFinalMessage`: `activity.text = this._message || 'end of stream response'`).

**Pattern used here:**
- Emit a **single** `queueInformativeUpdate("Working on your question…")`.
- Deliver the card via `setFinalMessage(MessageFactory.attachment(card))` +
  `setAttachments([card])` → no placeholder text.
- Per-step relay is opt-in behind `STREAMING_THOUGHTS_ENABLED` (default off).
- Policy is isolated in `src/services/streamingPolicy.ts` so it is unit-testable
  without the SDK.

**Verify** with a fake web-chat context (channelId `webchat`) that records
`sendActivity`: expect exactly 2 activities (one `typing`/informative + one
`message` with the attachment) and no `end of stream response`.

## 2. MCP client over Streamable HTTP in a CommonJS project

- `@modelcontextprotocol/sdk` is **ESM-first**. In this CommonJS/ts-jest project
  it only resolves with `tsconfig`: `module`/`moduleResolution` = **`node16`** and
  **`isolatedModules: true`**, plus a **`zod`** dependency (non-optional peer).
- Import from subpaths: `@modelcontextprotocol/sdk/client/index.js`,
  `.../client/streamableHttp.js`, `.../server/mcp.js`, `.../inMemory.js`.
- Create a fresh client + transport per request to stay stateless; always
  `client.close()` + `transport.close()` in `finally`.
- **Testing:** `InMemoryTransport.createLinkedPair()` links a real client to a
  real (mock) server in-process — no HTTP. See `test/mcpDataAgentClient.test.ts`.
- Progress: pass `onprogress` in the `callTool` options and
  `resetTimeoutOnProgress: true`; the server emits
  `notifications/progress` with `extra.sendNotification`.
- Result mapping lives in one place — `mapToolResult()` — ordered
  structuredContent → JSON text → plain text → image. Adapt there when the real
  tool schema is known (`docs/MCP_CONTRACT.md`).

## 3. Testing with the Agents SDK

- Importing the **`@microsoft/agents-hosting` barrel** in Jest throws at
  `jwks-rsa` load (via `jwt-middleware` in the package index). Either
  `jest.mock("@microsoft/agents-hosting", …)` (see
  `test/queryResultCard.test.ts`) **or** keep logic in pure modules and test
  those (see `test/streamingPolicy.test.ts`).
- For SDK-interaction behavior that can't be mocked away (e.g. `StreamingResponse`),
  use a throwaway Node harness with a fake context rather than a Jest import.

## 4. Native Adaptive Card charts in Teams

- The real schema (verified against `OfficeDev/Microsoft-Teams-Samples`):
  - `Chart.Line` → `data: [{ legend, values: [{ x, y }] }]` (multi-series)
  - `Chart.VerticalBar` → `data: [{ x, y }]` (single series)
  - `colorSet: "categorical"`, Adaptive Card **version 1.5** (not 1.6).
- These **only render in the Teams client** — generic AC previewers (e.g. the
  adaptivecards.io Designer) show "unknown element". Use the Teams App Test Tool
  or real Teams; inspect structure with `npm run card:preview`.
- Always keep an accessible data table and a static-image fallback
  (`NATIVE_CHARTS_ENABLED=false`).

## 5. Per-user auth (Teams SSO + On-Behalf-Of)

- `loadAuthConfigFromEnv()` reads `clientId`/`clientSecret`/`tenantId`;
  `src/index.ts` bridges Agents-Toolkit `BOT_ID`/`BOT_PASSWORD` into those.
- The user JWT path: Teams SSO token → MSAL `acquireTokenOnBehalfOf` →
  Data Agent-scoped token (`src/services/userAuth.ts`), cached per user, sent as
  `Authorization: Bearer`. Clients prefer `userContext.userToken` over the static
  key.
- Going live needs an Entra API scope/audience on the Data Agent **and** a
  mechanism to obtain the SSO assertion each turn (Azure Bot OAuth connection /
  `signin/tokenExchange`). Until then the bot falls back to the static credential.

## 6. Conventions

- Every new capability is **feature-flagged and defaults to the original
  behavior** (`DATA_AGENT_CLIENT`, `STREAMING_ENABLED`,
  `STREAMING_THOUGHTS_ENABLED`, `NATIVE_CHARTS_ENABLED`, `USER_AUTH_ENABLED`,
  `CONVERSATION_HISTORY_ENABLED`). See `docs/FEATURE_STATUS.md`.
- The Data Agent backend is swapped via the `IDataAgentClient` factory
  (`createDataAgentClient`) — add new backends there; keep mock + REST for tests
  and offline dev.
- Gates: `npm run build` (tsc), `npm test` (Jest), `npm run lint` (ESLint).

## 7. Deploying to Azure Container Apps (Windows gotchas)

- `az acr build` on Windows can crash on Unicode log output and packs
  `node_modules` if run from the repo root. Build a **clean staging context**
  (copy only `Dockerfile`, `package*.json`, prebuilt `dist/`) and set
  `PYTHONUTF8=1`. The Dockerfile expects `dist/` to be built locally first.
- `az` can silently switch the active subscription to a tenant-level account
  (e.g. after a Resource Graph query) — run
  `az account set --subscription <id>` before build/deploy.
- Azure Bot resource names are **globally unique**; add a random suffix.
- Container Apps single-revision mode routes 100% to latest; the old revision
  shows briefly as active while draining.
