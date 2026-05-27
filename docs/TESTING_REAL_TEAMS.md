# Testing Data Assistant with a Real Teams Client

> Resource and tunnel names used in the examples below (`rg-data-assistant-dev`,
> `data-assistant-teams-bot-dev`, `data-assistant-bot`, `data-assistant-teams-bot.zip`) match what's
> actually running in this repo's demo. Substitute your own names freely if
> you're reproducing the setup from scratch in a different tenant.

## Prerequisites

- Azure subscription with permission to create resources
- Microsoft Teams (desktop or web)
- Teams admin access to sideload apps (or a developer tenant)
- Node.js 18+

---

## Choose your testing path

There are two ways to put your bot in front of real Teams. Pick one before you
start — the only step that differs is how you expose your bot to Bot Framework
Service.

| | **Path A — Cloud-deployed (recommended)** | **Path B — Local dev with Dev Tunnel** |
|---|---|---|
| Use when | Customer demos, shared testing, ongoing usage | Iterating on bot code locally with real Teams round-trip |
| Public endpoint | Azure Container App FQDN | Microsoft Dev Tunnel exposing `localhost:3978` |
| Bot runs on | Azure Container Apps | Your laptop (`npm run dev:teams`) |
| Steps to follow | 1 → 3 → 4 → 5 (skip Step 2) | 1 → 2 → 3 → 4 → 5 → 6 |

**Path A reference:** the Container Apps deploy is documented in the main
[README — Option A](../README.md#option-a--azure-container-apps-recommended-10-min).
After the Container App is up, set the Azure Bot's messaging endpoint to
`https://<your-app-fqdn>/api/messages` and **skip Step 2 below**.

---

## Step 1: Create Azure Bot Registration

```bash
# Login to Azure
az login

# Create a resource group (if you don't have one)
az group create --name rg-data-assistant-dev --location eastus

# Create the bot registration with a new App Registration
az bot create \
  --resource-group rg-data-assistant-dev \
  --name data-assistant-teams-bot-dev \
  --app-type SingleTenant \
  --appid "" \
  --tenant-id "<your-tenant-id>"
```

Or create manually in Azure Portal:
1. Go to **Azure Portal > Create a resource > Azure Bot**
2. Bot handle: `data-assistant-teams-bot-dev`
3. Type: **Single Tenant**
4. Create new Microsoft App ID (auto-creates an App Registration)
5. After creation, go to **Configuration** > note the **Microsoft App ID**
6. Go to **Azure AD > App Registrations > your bot app > Certificates & Secrets** > create a new client secret

Save these values:
- `BOT_ID` = Microsoft App ID
- `BOT_PASSWORD` = Client Secret value

---

## Step 2: Set Up Dev Tunnel — *Path B only*

> **Skip this step entirely if you followed Path A** (Container Apps deploy).
> Your Container App already has a public HTTPS endpoint — use that as the
> Azure Bot messaging endpoint instead:
> ```bash
> az bot update -g rg-data-assistant-dev -n data-assistant-teams-bot-dev \
>   --endpoint https://<your-app-fqdn>/api/messages
> ```
> Then jump to **Step 3**.

Dev Tunnels expose your localhost to the internet so Teams can reach your bot
when you're running the bot on your laptop with `npm run dev:teams`.

```bash
# Install dev tunnels CLI (if not already installed)
winget install Microsoft.devtunnel

# Login
devtunnel user login

# Create a persistent tunnel
devtunnel create data-assistant-bot --allow-anonymous

# Add port forwarding
devtunnel port create data-assistant-bot -p 3978

# Start the tunnel
devtunnel host data-assistant-bot
```

Copy the tunnel URL (e.g., `https://abc123-3978.use2.devtunnels.ms`).

Set as messaging endpoint in Azure Portal:
- Go to **Azure Bot > Configuration > Messaging endpoint**
- Set to: `https://<your-tunnel-url>/api/messages`

---

## Step 3: Configure Environment

Update `env/.env.dev`:

```env
BOT_ID=<your-microsoft-app-id>
BOT_PASSWORD=<your-client-secret>
TEAMS_APP_ID=<your-teams-app-id>

USE_MOCK_CLIENT=true
DISABLE_AUTH=false

PERSONAL_CHAT_ONLY_ENABLED=true
```

> Earlier revisions of this guide configured `ACCESS_CONTROL_MODE` /
> `ACCESS_CONTROL_ALLOWLIST` env vars. These were used by the
> group-chat access control middleware, which was removed in the R3
> cleanup of the Personal Chat Only rollout. See
> [PERSONAL_CHAT_ONLY_PLAN.md](PERSONAL_CHAT_ONLY_PLAN.md).

---

## Step 4: Package the Teams App

```bash
# Replace environment variables in manifest
cd appPackage

# Option A: Manual replacement
# Edit manifest.json - replace ${{TEAMS_APP_ID}} and ${{BOT_ID}} with actual values

# Option B: Use a script
node -e "
const fs = require('fs');
let manifest = fs.readFileSync('manifest.json', 'utf8');
manifest = manifest.replace('\${{TEAMS_APP_ID}}', process.env.TEAMS_APP_ID || '<your-teams-app-id>');
manifest = manifest.replace('\${{BOT_ID}}', process.env.BOT_ID || '<your-bot-id>');
fs.writeFileSync('manifest.json', manifest);
console.log('Manifest updated');
"

# Create the zip package
# On Windows:
tar -cf ../data-assistant-teams-bot.zip manifest.json color.png outline.png
```

---

## Step 5: Sideload into Teams

1. Open Microsoft Teams
2. Go to **Apps** (left sidebar) > **Manage your apps** > **Upload a custom app**
3. Select `data-assistant-teams-bot.zip`
4. Click **Add** to install in personal scope

> **Personal scope only:** the manifest declares `scopes: ["personal"]`, so
> Teams will not offer "Add to a team" or "Add to a chat" buttons in the
> install dialog. This is intentional — see
> [PERSONAL_CHAT_ONLY_PLAN.md](PERSONAL_CHAT_ONLY_PLAN.md).

---

## Step 6: Start the Bot Locally — *Path B only*

> **Skip this step if you followed Path A.** Your Container App is already
> running the bot — there is nothing to start locally.

```bash
# Terminal 1: Start mock API + bot
npm run dev:playground

# (Dev tunnel should already be running in another terminal)
```

---

## Stateless Validation & Demo (Production)

This bot enforces single-turn processing for every query. Teams may still show
"include chat history" options when adding members, but bot processing remains
stateless.

### Runtime proof

1. Open the health endpoint for your deployed app:
  - Example: `https://<your-container-app-fqdn>/api/health`
2. Confirm the JSON includes:
  - `"statelessPolicyEnabled": true`

### Stateless badge on every card

Every response card (table, metrics, timeseries) includes a **🛡️ Stateless** footer line showing:

> No conversation history sent to backend

This is visible in Teams on every bot reply — no special prompt needed. It confirms at a glance that stateless policy is active for that response.

### History isolation trigger

Send any of these to the deployed bot (no local stack needed):

- `history test`
- `stateless test`
- `context test`

Returns a metrics card explicitly showing:

| Label | Value |
|---|---|
| Your Query | `"history test"` |
| Prior Turns Sent | `0` |
| History Policy | `none` |
| Context Window | `single-turn` |

This is the explicit on-demand proof, vs the passive footer badge on every card.

### Request contract proof

Verify at the Data Agent API ingress/logs that each request from the bot sends:

- `X-Conversation-Context: single-turn`
- `X-History-Policy: none`

### Behavioral proof in Teams

1. In a chat with the bot, send:
  - A: `Show revenue by region for Q1`
  - B: `Now break that down by product`
2. Expected behavior:
  - The bot must process B independently unless B contains sufficient context.

### Personal-chat-only enforcement proof

1. Open the Data Assistant install dialog (Apps → search **Data Assistant** → click the tile).
2. Expected: the install dialog shows a single **Add** button with **no**
   scope dropdown and **no** "Add to a team" / "Add to a chat" options.
3. Right-click the installed Data Assistant icon in the left rail.
4. Expected: only **Open** / **Pin** / **Uninstall** actions; no
   "Add to a team" / "Add to a chat".

This confirms the manifest scope restriction (`scopes: ["personal"]`) is
enforced by the Teams client itself.

### Runtime guard proof (defense in depth)

The runtime guard (`personalChatOnlyMiddleware`) catches anything that bypasses
the manifest restriction (e.g. a legacy install from an older app version).
If a message activity ever reaches the bot from a `groupChat` or `channel`
conversation, the bot:

- Returns a **"Personal chat only"** Adaptive Card and instructions to start a 1:1.
- Emits an audit log entry `personalChatOnly.blocked` with the conversation type and ids.
- Does **not** invoke the Data Agent backend.

### Control statement for release/demo

- Teams add-member history UI is Microsoft Teams client behavior and is not
  customizable by bot apps.
- Both the stateless contract and the personal-chat-only restriction are
  enforced server-side and code-locked in this repo.

---

## Chart & Table Rendering Validation (Production)

Use this section to validate that Teams cards display data tables and optional
chart images from backend responses.

### Backend payload contract

For `table` cards, backend should return:

```json
{
  "type": "table",
  "title": "Revenue by Region (FY25 Q1)",
  "columns": ["Region", "Revenue ($M)", "YoY Change"],
  "rows": [
    ["North America", 12450, "+8.2%"],
    ["EMEA", 8930, "+5.1%"]
  ],
  "sql": "SELECT ..."
}
```

For `timeseries` cards with chart image, backend should return:

```json
{
  "type": "timeseries",
  "title": "Monthly Revenue Trend",
  "seriesLabels": ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"],
  "series": [
    { "label": "Revenue ($B)", "values": [9.2, 9.5, 10.8, 9.8, 10.1, 10.6] },
    { "label": "Target ($B)", "values": [9.0, 9.3, 10.5, 9.5, 9.8, 10.2] }
  ],
  "chartImageUrl": "https://<public-host>/charts/revenue-trend.png",
  "chartAltText": "Monthly revenue trend line chart",
  "sql": "SELECT ..."
}
```

Notes:

- `chartImageUrl` must be publicly reachable over HTTPS by Teams clients.
- If `chartImageUrl` is omitted, card still renders timeseries values in a
  tabular layout.

### Manual validation steps in Teams

1. Ask: `show revenue by region`
2. Expected:
   - Card title appears.
   - Header row + data rows are visible in card body.
   - No blank card body.

3. Ask: `monthly revenue trend`
4. Expected (without chart URL):
   - Series and monthly values are visible in card body.

5. Ask same question with backend returning `chartImageUrl`.
6. Expected (with chart URL):
   - Chart image is shown.
   - Tabular series data is still shown under image.

### Quick graph trigger (deployed bot or local mock API)

Send any of these prompts to the deployed bot in Teams (no local stack needed):

- `graph test`
- `chart test`
- `demo graph`

Returns a bar chart of quarterly revenue (FY25) via QuickChart.io with tabular values below it.

The `monthly revenue trend` / `monthly revenue over time` prompt also returns a timeseries card with a chart image.

> **Note:** These triggers work against the deployed Azure Container App (`USE_MOCK_CLIENT=true`). A local stack is not required.

### Screenshot checklist for demo/release notes

Capture and store screenshots for:

- Table card with visible headers and at least 2 rows.
- Timeseries card without image (tabular fallback visible).
- Timeseries card with image + tabular values.
- Error-state example (optional) for unsupported query.

Recommended annotation per screenshot:

- Prompt used
- UTC timestamp
- Build/commit id
- Environment (dev/prod)

---

## Testing Personal Chat Only Enforcement

The bot is scoped to 1:1 personal chats only. Tests below validate both layers
(manifest + runtime). See [PERSONAL_CHAT_ONLY_PLAN.md](PERSONAL_CHAT_ONLY_PLAN.md)
for design rationale.

### Test Case 1: 1:1 happy path
1. Open a 1:1 chat with Data Assistant.
2. Send: `total revenue by region`.
3. **Expected**: Adaptive Card with revenue table.
4. **Log**: `turn.start` with `channelId: "msteams"` and `a:...` conversation id,
   `query.complete success: true`. No `personalChatOnly.blocked` entry.

### Test Case 2: Manifest scope blocks group install (UI proof)
1. From the Apps catalog, click the **Data Assistant** tile.
2. **Expected**: install dialog shows only a plain **Add** button — no
   dropdown arrow, no "Add to a team" or "Add to a chat" options.

### Test Case 3: Runtime guard blocks group messages (defense in depth)
The manifest scope already prevents group/channel install, so this case is
normally unreachable. To verify the guard still fires, you can:

- Send a synthetic activity via the Bot Framework Emulator with
  `channelId: msteams` and `conversation.conversationType: groupChat`, OR
- Temporarily install an older app package (with broader scopes) into a
  group chat and send a message.

**Expected**: bot replies with the "Personal chat only" block card and the
audit log shows `personalChatOnly.blocked` with `conversationType` and
`conversationId`. The Data Agent backend is **not** called.

### Test Case 4: Emergency disable
Set `PERSONAL_CHAT_ONLY_ENABLED=false` on the Container App revision and
verify all activities pass through unguarded. Re-enable immediately after
verification.

---

> The legacy group-chat allowlist / Entra group access-control flow has
> been removed in R3 cleanup. The `accessControlService` source file is
> retained as a utility for any future personal-chat allowlist wiring but
> is currently not registered as middleware.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Bot doesn't respond at all (Path A) | Check Container App is running (`az containerapp show ...`); verify Azure Bot messaging endpoint points to `https://<your-app-fqdn>/api/messages`; tail container logs |
| Bot doesn't respond at all (Path B) | Check Dev Tunnel is running; verify Azure Bot messaging endpoint points to the tunnel URL; check local terminal for errors |
| Install dialog only shows "Open" (no "Add") | App is already installed in personal scope — expected. Uninstall first to see the install dialog again. |
| No "Add to a team" / "Add to a chat" option | Expected — manifest declares `scopes: ["personal"]` |
| "Personal chat only" block card in 1:1 chat | Should not happen. Check that `channelId == msteams` and `conversation.conversationType == personal` in the audit log |
| 401 Unauthorized from Teams | Set `DISABLE_AUTH=false` and ensure BOT_ID/PASSWORD are correct |

---

## Architecture Note (Playground vs Real Teams)

| Feature | Playground | Real Teams |
|---------|-----------|------------|
| Channel ID | `msteams` (with flag) | `msteams` |
| Authentication | Disabled | Token validation required |
| Personal-chat scope | Always personal-equivalent (single user surface) | Enforced by manifest + runtime guard |
| Bot rendering | Log panel only | Full Adaptive Card UI |
