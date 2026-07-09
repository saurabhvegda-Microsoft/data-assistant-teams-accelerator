# Personal Chat Only (PCO) — Feature Plan

> **Status:** Shipped. R1 + R2 + R3 complete and verified end-to-end in a real Microsoft Teams tenant.

## Goal

Restrict Data Assistant to Microsoft Teams **personal (1:1) chats**. Block group chat
and channel usage at both runtime (defense in depth) and manifest (install-time
prevention) layers.

## Why both layers

Manifest scope change alone is **not sufficient**:

| Threat | Manifest blocks? | Runtime blocks? |
|---|---|---|
| New install in group/channel | Yes | N/A |
| Existing pre-change group install | No | Yes |
| Reinstall of older app package version | No | Yes |
| Cached/stale manifest in tenant | No | Yes |
| Admin policy override | No | Yes |

Manifest is the **discoverability/install** control. Runtime guard is the **real
enforcement boundary**. Both must ship together.

## Rollout order

1. **R1 — Runtime guard** (P0): ship guard middleware first. Existing group
   installs immediately stop receiving processed messages. ✅ **Shipped**.
2. **R2 — Manifest scope change** (P0): publish updated app package with
   personal-only scopes. Prevents new group/channel installs. ✅ **Shipped**.
3. **R3 — Cleanup**: remove obsolete group access-control code paths.
   ✅ **Done** — deleted `accessControlMiddleware` + `accessDeniedCard` + tests.

## Scope of changes

### New files

- `src/middleware/personalChatOnlyMiddleware.ts` — early guard middleware.
- `src/cards/personalChatOnlyCard.ts` — block-response adaptive card.
- `test/personalChatOnlyMiddleware.test.ts` — unit tests.

### Updated files

- `src/bot.ts` — register PCO middleware **first** in the `onTurn` chain.
- `appPackage/manifest.json` — `bots[0].scopes` and command list scopes set to
  `["personal"]` only. Bump `version` to `1.1.0`.

### Optional cleanup (later release)

- `src/middleware/accessControlMiddleware.ts` — becomes inert because PCO
  middleware short-circuits non-personal earlier. ✅ **Removed in R3.**
  `accessControlService.ts` retained as a utility for any future
  personal-chat allowlist wiring.

## Runtime guard behavior

- Allow when `activity.conversation.conversationType === "personal"`.
- For `groupChat` or `channel`:
  - Send adaptive card with a short "Personal chat only" message and steps to
    start a 1:1 chat.
  - Log structured event `personalChatOnly.blocked` with `conversationType`,
    `conversationId`, `userId`, `aadObjectId`.
  - **Do not** call `next()` — backend query and downstream middleware are
    skipped entirely.
- Non-message activity types (e.g. `conversationUpdate`) pass through so
  welcome cards and membership events still work.

## Feature flag

- Env var `PERSONAL_CHAT_ONLY_ENABLED`, default `true`.
- Set to `false` to emergency-disable runtime guard without redeploy.
- Manifest rollback requires republishing previous app package.

## Manifest changes

```json
"bots": [
  {
    "scopes": ["personal"],
    "commandLists": [{ "scopes": ["personal"], ... }]
  }
]
```

Bump `version` field to `1.1.0`.

## Test plan

### Unit tests

- Personal chat message → `next()` invoked, no card sent.
- Group chat message → block card sent, `next()` not invoked.
- Channel message → block card sent, `next()` not invoked.
- Non-message activity types → pass through regardless of conversation type.
- Feature flag disabled → all messages pass through.

### Manual tests in Teams

- 1:1 chat: full query flow works.
- Existing group chat install: receives block card on any user message.
- New install attempt in group/channel after manifest publish: option not
  available in Teams UI.

## Telemetry

- Counter: `personalChatOnly.blocked` per `conversationType` per day.
- Confirm zero backend `query.start` events for blocked conversations.

## Acceptance criteria

- [x] 1:1 chat fully functional. (Verified in Teams: `hello` → welcome card; `margin over time` → data card; `success: true`, ~800ms.)
- [x] Group chat and channel produce block card; no backend query invoked. (Verified by unit tests + live Web Chat block before the cross-channel fix.)
- [x] Telemetry shows blocked attempts with conversation type breakdown. (`personalChatOnly.blocked` audit log entry; observed earlier on `webchat` send before fix.)
- [x] After manifest publish, no new group/channel installs are possible. (Verified: Teams shows only "Open"; install dialog has no scope dropdown.)
- [x] Unit tests cover all branches; CI green. (10/10 PCO + 64/64 total tests pass.)

## Verification log

| Step | Evidence |
|---|---|
| R1 deployed | Container revision rolled with PCO middleware registered first in `onTurn` chain |
| R1 fix (cross-channel) | Allowed Web Chat / DirectLine / Emulator (non-Teams channels are inherently 1:1) while still blocking group chats on `msteams` |
| R2 sideloaded | Manifest scope `["personal"]` accepted in Teams; install dialog shows no group/team option |
| Live 1:1 verified | Welcome card on `hello`; data card on sample queries (e.g. `revenue by region`); `status: success` in audit log |
| R3 cleanup | Removed inert middleware; tests + build green |

## Estimated effort

- Code + tests: 1–1.5 days.
- Manifest + docs: 0.5 day.
- Rollout + monitoring: 1–2 weeks.
