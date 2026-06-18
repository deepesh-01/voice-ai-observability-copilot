# Assumptions & Product Calls Register

> We are explicitly allowed to make assumptions, take product calls, and guess — but every
> one is recorded here with a status. When an assumption is validated or invalidated, update
> its row (don't delete) and link the ADR/session that resolved it.

**Status legend:** 🟡 Assumed (unverified) · 🟢 Validated · 🔴 Invalidated · ⚪ Mitigated/superseded

| ID | Type | Statement | Status | Basis / how we'll verify | Linked |
|----|------|-----------|--------|--------------------------|--------|
| **A-001** | Integration | The HighLevel sandbox lets us provision a Marketplace App with an embedded custom page + OAuth. If provisioning is blocked, we fall back to a Custom JS snippet. | 🟡 | **Research-validated (S-003):** dev portal supports a sandbox via Testing → + Create App Test Account (Pro features, 6mo); apps support a **Custom Page (iframe)** embed — host must not send `X-Frame-Options: DENY/SAMEORIGIN`. Still needs hands-on confirmation on first login. Fallback (Custom JS) designed. | ADR-0002, R1.2 |
| **A-002** | Performance | End-to-end latency is dominated by LLM calls, not HTTP framework throughput — so framework choice (Express) won't be the bottleneck. | 🟡 | Confirm once we measure a real analysis run. | ADR-0002 |
| **A-003** | Data | "Existing call transcripts" are available via the HighLevel Voice AI / Conversations API in a parseable form (speaker turns + timestamps). Until confirmed, we work against a mocked transcript fixture. | 🟡 | **Research-validated (S-003):** a **Voice AI Public API** exists — `List Call Logs` (filter by agent/contact/type/date) + `Get Call Log` (by callId) return transcripts; requires Conversation AI / Voice AI read scopes. Exact payload shape (speaker turns + timestamps) to confirm hands-on against a real sandbox call. | R2.1 |
| **A-004** | Product | "Observability parameters" (R2.2) are best modeled as a small set of **KPIs derived from the agent's goal/script** (e.g. booking-rate, objection-handling, script adherence, sentiment, dead-air, escalation-needed) rather than free-form metrics. | 🟡 | Product call. Refine after seeing real transcripts. | R2.2, R2.3 |
| **A-005** | Product | "Use Actions" (R2.6) = timestamped call segments flagged for **human review** or **script training**, surfaced as deep-links into the transcript at that moment. | 🟡 | Product call; validate it reads as "actionable" in the demo (E1, E2). | R2.6 |
| **A-006** | Scope | "Real-time" (D1.1) is satisfied by **near-real-time ingestion on call-completion** (webhook/poll → analyze within seconds), not live mid-call streaming. | 🟡 | Product call to fit C1; note clearly in functional-vs-mocked. | D1.1 |
| **A-011** | Integration | A **Live version is immutable** — to change scopes you must publish a **new version**, then **re-authorize** (uninstall + reinstall) so the new token carries the added scopes (scopes are bound at consent). | 🟢 | Observed S-006: live token 401s on voice-ai endpoint until new-version reinstall. | R1.2 |
| **A-010** | Integration | After publishing (Live), `chooselocation` resolves and shows "Select an account", but the **account list is empty ("No Data")** when logged in as the developer/agency with **no sub-account**. A Sub-Account-distribution app needs a **location** to install into. **Fix:** log into the sandbox test account + ensure ≥1 Sub-Account exists, then install. | 🟡 | Observed S-006 (screenshot: "Select an account → No Data"). Verify by creating/selecting a sub-account. | R1.1, R1.2 |
| **A-009** | Integration | `noAppVersionIdFound` / "No integration found" is caused by the app **version being in DRAFT** + a hand-built `chooselocation?client_id=…` URL can't resolve a draft. **Fix:** add Scopes (required) + Save, then install via the **portal's per-version "Install link"** (or publish the version). Our `/oauth/install` is for published versions; the app lives on `marketplace.gohighlevel.com`. | 🟡 | Root cause seen in portal screenshot (S-006): version badge `vdraft • DRAFT`; redirect URL was correctly saved. Verify by installing via portal link. | R1.2, A-007 |
| **A-008** | Integration | HighLevel **rejects redirect URIs / app URLs containing brand references** (e.g. `ghl`). Public hostname must avoid the brand → renamed `ghl.` → **`voai.deepesh-engg.in`**. | 🟢 | Observed: portal would not save a redirect URI under `ghl.…`; `voai.…` accepted. | ADR-0004, R1.2 |
| **A-007** | Integration | Exact OAuth scope strings (resolved): **`voice-ai-dashboard.readonly`** = `GET /voice-ai/dashboard/call-logs` + `/:callId` (transcripts) + `VoiceAiCallEnd` webhook; **`voice-ai-agents.readonly`** = list agents (R2.4); **`voice-ai-agent-goals.readonly`** = agent goals (R2.2). Plus conversations/message.readonly for transcriptions. | 🟢 | Confirmed via official Scopes doc + live 401 ("not authorized for this scope") without them. `.env` SCOPES updated. | ADR-0004, R1.2, R2.1, R2.4 |

## How to add a row

Append a new `A-NNN`. Set type (Integration / Performance / Data / Product / Scope), the
statement, status 🟡, the basis, and link the ADR/requirement it serves. Update status as
reality lands.
