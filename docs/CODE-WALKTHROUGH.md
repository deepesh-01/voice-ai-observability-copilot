# Code Walkthrough — what we wrote and why

A complete, file-by-file tour of the Voice AI Observability Copilot: every module, what it
does, and the reasoning behind it (traced to the [ADRs](./decisions) and requirement IDs). It's
organized by subsystem; read it top-to-bottom for the full picture, or jump via the contents.

> **Companion docs:** [root README](../README.md) (architecture + Team-of-One), the per-package
> deep-dives [`server/README.md`](../server/README.md) / [`web/README.md`](../web/README.md), the
> Postgres [`SCHEMA.md`](../server/src/db/SCHEMA.md), and the [ADR log](./decisions). This doc is the
> narrative that ties the code together.

## Contents

1. [The loop in one read — follow a single call](#1-the-loop-in-one-read--follow-a-single-call)
2. [Backend · Integration + real-time ingestion](#2-backend--integration--real-time-ingestion)
3. [Backend · The analytical brain](#3-backend--the-analytical-brain)
4. [Backend · Persistence, read API, and auth](#4-backend--persistence-read-api-and-auth)
5. [Frontend · The unified dashboard](#5-frontend--the-unified-dashboard)
6. [Testing strategy](#6-testing-strategy)
7. [Decision index (where each ADR lives in the code)](#7-decision-index)

---

## 1. The loop in one read — follow a single call

The whole system closes one loop — **raw call → KPI scores → recommendations** — on real data.
Here's a single call's journey through the modules, which doubles as a map of the rest of this doc:

1. **A call ends in HighLevel.** GHL POSTs a `VoiceAiCallEnd` webhook to `POST /webhooks/ghl/voice-ai`
   (`routes/webhook.routes.ts`). The raw bytes were stashed by `index.ts` so `webhooks/verifyGhl.ts`
   can check the **Ed25519 signature**. The handler **acks 202 in ~30ms** and ingests asynchronously
   (GHL retries slow handlers).
2. **Capture first, then score.** `ingest/ingestCall.ts` writes the verbatim call to `raw_call`
   **before any analysis** (`store/rawCallRepository.ts`) — so a flaky LLM step can never lose the
   call. It parses the transcript (`analysis/transcript.ts`).
3. **Two independent LLM passes** (both via `llm/agent.ts` → Claude Agent SDK, structured output):
   `analysis/score.ts` (Opus) grades six KPIs + deviations + Use-Actions against the agent's own goal
   (`ghl/api.ts → getAgentPrompt`); `analysis/extractLead.ts` (Haiku) pulls lead facts + the two
   observability signals, merging native GHL `extractedData` (`analysis/nativeFacts.ts`) and the
   contact record (`ghl/api.ts → getContact`) over the LLM output.
4. **Persist.** Scores go to `call_analysis` + flat `call_kpi` (`store/analysisRepository.ts`,
   transactionally); the lead to `call_lead` (`store/leadRepository.ts`).
5. **Read.** The dashboard calls the token-guarded `/api/*` (`routes/api.routes.ts` + `middleware/apiAuth.ts`),
   which reads those tables and, on demand, synthesizes **cross-call recommendations**
   (`analysis/recommend.ts`, Opus, cached by call count).
6. **Render.** The Vue SPA (`web/src/`) — a hand-rolled view-state machine — drills agent → call →
   flagged segment, linking each KPI/recommendation back to the exact transcript moment.

The **pull/backfill** half (`ingest/pollIngest.ts`) funnels into the same `ingestCall`, so polling is
a safety net for any webhook that fails after the ack.

---

## 2. Backend · Integration + real-time ingestion

> The seam where a HighLevel account meets the Copilot's brain. A marketplace OAuth install
> (`oauth.routes.ts` → `oauth.ts` → `tokenStore.ts`) deposits durable, per-install tokens in
> Postgres; `config.ts` centralizes every endpoint/scope/secret; `ghl/api.ts` is the authenticated
> client that auto-refreshes tokens. New calls arrive via the **push** path (webhook →
> `verifyGhl` → `ingestCall`) and the **pull** path (`pollIngest`), both funneling into
> `ingestCall.ts`, which captures raw first, then scores and extracts. `index.ts` wires it into one
> single-origin Express app (ADR-0004) that also serves the embedded Vue dashboard. Throughlines:
> raw-body capture for signatures, ack-before-work, idempotent upserts, graceful degradation.

### `server/src/index.ts`
**What.** The Express bootstrap: raw-body capture, the iframe CSP, mounts `/oauth` · `/api` · `/webhooks`,
serves the built SPA (injecting the API token), and starts listening.
**Why.** Single-origin app per **ADR-0004** (R1.2/D1.1): one process → one redirect URI + one Custom
Page URL. The CSP block exists so the dashboard can embed as a HighLevel **Custom Page iframe** —
*"We must NOT send `X-Frame-Options`"*, so it sets only `frame-ancestors 'self' https://*.gohighlevel.com …`.
**Key bits.** `express.json({ verify: (req,_res,buf) => req.rawBody = buf })` stashes raw bytes for
signature checks (the only place they survive). The SPA's `index.html` is read once at boot and gets
`<script>window.__API_TOKEN__=…</script>` injected when `API_AUTH_TOKEN` is set. `/api` is wrapped in
`apiAuth`; `/webhooks` is **not** (it authenticates by signature). Boot is graceful: persistence
init is best-effort, missing `DATABASE_URL` just warns.

### `server/src/config.ts`
**What.** Central typed config + the frozen `GHL` endpoint table; loads the repo-root `.env`, validates
required secrets, derives `redirectUri`.
**Why.** *"Centralised so there are no magic strings."* Carries explicit rationale: `databaseUrl`
(ADR-0008 Postgres), `scopes` must subset the portal-enabled scopes (assumption **A-007**),
`requireWebhookSignature` defaults false during bring-up until a real delivery confirms the key.
**Key bits.** `required(name)` throws a copy-`.env.example` error. `GHL.apiVersion = '2021-07-28'`;
`config.port` 8095; Claude access uses the **Agent SDK OAuth token** (`CLAUDE_CODE_OAUTH_TOKEN`), not a
bare API key. `redirectUri` must match the Marketplace registration exactly.

### `server/src/ghl/api.ts`
**What.** Thin authenticated `axios` client over HighLevel's Voice AI + Contacts APIs: list/get call
logs, agent prompts/names, contact identity, live connection probe.
**Why.** Wraps verified endpoints (assumption **A-003**). Comments record hard-won facts: call-log GET
*requires* `locationId` (omitting → 400, S-012); the Voice AI **agents** endpoints use `Version: 'v3'`
while call-logs/contacts use `2021-07-28`.
**Key functions.** `listCallLogs`, `getAgentPrompt(agentId, locationId)` (the goal scoring runs
against), `listAgents` (id→name for the UI), `checkConnection` (diagnostic: connected+scoped vs
missing-scope vs revoked, by pattern-matching `401 + /scope/i`), `getCallLog`, `getContact`
(authoritative identity; **swallows errors → `undefined`** so lead extraction can fall back to the
transcript, ADR-0013). Every method calls `getValidAccessToken` first, so refresh is transparent.

### `server/src/ghl/oauth.ts`
**What.** OAuth machinery: build authorize URL, exchange code, refresh, and hand callers a
guaranteed-valid token.
**Why.** The marketplace install (R1.2) whose tokens back every API call.
**Key functions.** `buildAuthorizeUrl()`, `exchangeCodeForTokens(code)` (persists via `saveTokens`),
`getValidAccessToken(key?)` — returns the token if `expiresAt - Date.now() > 60_000`, else refreshes
first (**60s skew** = proactive, not reactive-on-401). `expiresAt` is absolute epoch-ms computed at
receipt (clock-drift safe); token bodies are `x-www-form-urlencoded` (GHL requirement).

### `server/src/routes/oauth.routes.ts`
**What.** `GET /oauth/install` (redirect to authorize) and `GET /oauth/callback` (exchange code, land
in the embedded dashboard at `/?installed=…`).
**Why.** The callback is the registered redirect URI; success returns into the SPA (ADR-0004).
**Gotcha.** On failure it digs the upstream axios `response.data` into the 502 body + log — so
scope/redirect misconfigs are immediately visible.

### `server/src/routes/webhook.routes.ts`
**What.** `POST /webhooks/ghl/voice-ai`: snapshot the delivery, verify signature, **202-ack**, then
ingest async.
**Why.** Primary ingestion (R2.1) — the webhook carries the full transcript inline, scored in
near-real-time; polling is the fallback (ADR-0008). The ack-before-work pattern exists because
*scoring takes ~20s but GHL times out slow handlers and retries.*
**Key bits.** `verifyGhlSignature(rawBody, req.get('x-ghl-signature'))`, rejected `401` *only* if
`config.requireWebhookSignature`. `res.status(202).json(...)` fires **before** the fire-and-forget
`void (async () => {…})()`. A module-level `inFlight = new Set<string>()` dedupes GHL's rapid retries.
Fast-path: a non-empty `body.transcript` → `ingestRawCall` (score inline); else → `ingestCall(callId)`
(fetch by id). `snapshot()` writes `webhook-<id>.json` (the canonical shape for the synthetic generator).

### `server/src/webhooks/verifyGhl.ts`
**What.** Verifies `X-GHL-Signature` is a valid **Ed25519** signature over the raw body.
**Why.** HighLevel signs marketplace webhooks Ed25519-over-raw-bytes (legacy RSA deprecated
2026-07-01) — hence the raw-body capture upstream. Public key bundled, **overridable via env** (rotation-safe).
**Key bits.** `verifyGhlSignature(rawBody, signature, publicKeyPem?)` is **total** (try/catch → `false`,
rejects missing/`'N/A'`); `crypto.verify(null, payload, key, sig)` (Ed25519 takes a `null` algorithm).

### `server/src/ingest/ingestCall.ts`
**What.** The ingestion core: raw GHL call → persisted, scored call + extracted lead, idempotently.
**Why.** **ADR-0011's** central decision: *capture the raw call FIRST (source-of-record) before any
scoring* — *"if scoring/extraction fails below, the call is still persisted and reprocessable."*
**Key bits.** `ingestRawCall(raw, locationId, {force?})`: `rawCallRepo.saveRaw` → idempotency
(`!force && analysisRepo.has(callId)`) → `parseTranscript` → `scoreCall` → `analysisRepo.save` →
`ingestLead` (**non-blocking** `.catch` so a lead failure can't lose the scored call). Goal =
`getAgentPrompt(...) ?? NO_GOAL`. `extractedData: raw.extractedData` is passed as native ground-truth
(ADR-0013). `ingestCall(callId)` fetches by id then delegates with `{force:true}`.

### `server/src/ingest/pollIngest.ts`
**What.** The pull/backfill: list a location's call logs, `ingestCall` any not yet stored, tally
scanned/ingested/skipped/errors.
**Why.** The pull half of R2.1 + the safety net for webhooks that fail post-ack.
**Gotcha.** Per-call `try/catch` so one failure doesn't abort the scan; idempotency inherited from
`analysisRepo.has` makes re-polling cheap.

### `server/src/store/tokenStore.ts`
**What.** Postgres persistence for OAuth install tokens, keyed by `install_key` (locationId ?? companyId):
`saveTokens` / `getTokens` / `listInstalls`.
**Why.** **ADR-0008** (S-015 update) moved auth off the gitignored `tokens.json` to the durable,
multi-tenant `oauth_tokens` table — *same three-function surface, so callers were untouched.*
**Key bits.** Idempotent `INSERT … ON CONFLICT (install_key) DO UPDATE`; schema memoized
(`schemaReady ??= initSchema()`) so scripts that never boot the server still work; `expires_at` BIGINT
comes back as a string → `Number(...)`; keyless `getTokens` returns the *sole* install (a setup convenience).

---

## 3. Backend · The analytical brain

> Turns a transcript into six KPI scores, deviations, turn-level Use-Actions, per-call lead facts +
> two observability signals, and cross-call recommendations. Every LLM call goes through one entry
> point (`runStructured`) constrained to a JSON schema, and every output is run through a **pure,
> total `assemble*` validator** before it's trusted — the SDK gives the shape, the assemblers enforce
> what the schema can't (0–100 bounds, valid turn indices, known enums, no hallucinated call ids). The
> design splits *facts vs judgment* (ADR-0013) and *observability vs workflow* (ADR-0012), routes work
> to the cheapest adequate model (Haiku extract / Opus score+synthesize, ADR-0002), and caches the
> expensive synthesis by call count.

### `server/src/analysis/types.ts`
**What.** The dependency-free contract layer — every domain shape (turns, KPIs, deviations, leads,
recommendations, the full analysis).
**Why.** Kept dep-free so the parser and scorer share identical types. KPIs are *transcript-derivable
only* — timing KPIs are deliberately absent (no timestamps, A-003). Leads are *observability signals,
not a booking workflow* (ADR-0012): *"we flag, we don't run the bookings."*
**Core types.** `Turn`, `KpiKey` (the six keys), `KpiScore { score, rationale, evidence: number[] }`,
`Deviation { severity, kpi, description, turnIndex? }`, `UseAction { label, reason, startTurn, endTurn }`
(R2.6), `Recommendation { kind, priority, kpi, problem, fix, rationale, evidenceCallIds }` (R2.5),
`BookingStatus`, `LeadSource = 'ghl' | 'llm'`, `LeadExtraction` (raw LLM output, testable), `CallLead`
(persisted: extraction + identity-resolved facts + `source` + verbatim `native` blob), `CallAnalysis`.
**Gotcha.** `LeadExtraction` (raw) is kept separate from `CallLead` (identity-resolved) so the LLM
output is unit-testable and identity can be overridden from the authoritative contact record. Fact
fields carry provenance; the two **signals are always LLM** regardless.

### `server/src/analysis/transcript.ts`
**What.** Parses HighLevel's `bot:`/`human:` newline string into ordered `Turn[]`; renders turns back
to text for the LLM.
**Why.** The transcript is one newline-delimited string with no timestamps and possible consecutive
same-speaker lines — so the parser groups by speaker, not strict alternation. The `bot→agent /
human→caller` map must mirror the frontend so labels are consistent.
**Key bits.** Splits on the **first** colon only (colons inside utterances survive); case-insensitive
prefix; consecutive same-speaker lines merge; unknown-prefix lines are *continuations*; total function
(`[]` for junk). Note: `score.ts` formats turns inline with `[index]` prefixes (for evidence citation)
rather than calling `transcriptToText` (which the extractor uses).

### `server/src/analysis/kpis.ts`
**What.** The data-driven catalog of the six KPIs (label/description/rubric/weight) + the weighted
rollup to one overall score.
**Why.** R2.2/A-004 — KPIs are *data, not hard-coded prompts*, so the set/weights change without
touching the pipeline. Transcript-derivable only (A-003).
**The six KPIs + weights** (goal completion dominates): `goal_completion` (3), `script_adherence` (2),
`info_capture` (2), `accuracy` (2), `objection_handling` (1.5, *"If no objection arose, score 100"* —
avoids penalizing clean calls), `sentiment` (1). `weightedOverall` ignores unknown keys and guards
divide-by-zero.

### `server/src/analysis/score.ts`
**What.** The KPI scorer: transcript + agent goal → a validated `CallAnalysis`, via one structured
Claude call (Opus).
**Why.** Scores are *relative to the agent's own configured goal* (R2.2). The schema can't express
every constraint, so they're enforced in `assembleAnalysis`. Opus = the nuanced-judgment step (ADR-0002).
**Key bits.** `SCORING_SCHEMA` (`additionalProperties:false`, enums from `KPI_KEYS`). `assembleAnalysis`
is **pure + total**: `clamp` bounds 0–100; `validTurn` filters evidence/turn indices (`-1` = "whole
call" sentinel, correctly dropped); KPI scores deduped (first wins), unknown keys dropped; bad
`severity`→`'low'`, bad `kpi`→`'general'`; use-actions defaulted then filtered if `endTurn<startTurn`.
`overallScore` is **recomputed** by `weightedOverall` from the validated scores — never trusted from the LLM.

### `server/src/analysis/extractLead.ts`
**What.** Pulls lead facts + the two signals from a transcript (Haiku), and assembles a persistable
`CallLead` by merging native data, the contact record, and the LLM output in precedence order.
**Why.** A cheaper, narrower job than scoring → Haiku (ADR-0010 §2 / A-002). The three-layer precedence
and facts-vs-signals split are ADR-0013.
**Key bits.** The **precedence** in `assembleLead` is the heart of ADR-0013:
`callerName: native.callerName ?? clean(contact?.name) ?? extraction.callerName` — i.e. **native
`extractedData` → contact record → LLM**. But signals come straight from the extraction unconditionally
(*"GHL doesn't emit 'what the agent failed to do'"*). `source: native.hasAny ? 'ghl' : 'llm'`;
`confirmed` comes from the extraction (agent confirmed *on the call*). Schema fields are all-required
with `""`/`"unknown"` sentinels for absence, normalized by the assemblers.

### `server/src/analysis/nativeFacts.ts`
**What.** Maps GHL's native `extractedData` blob (the agent's DATA_EXTRACTION actions) into a normalized
`NativeFacts` — the ground-truth layer that wins over LLM inference for facts.
**Why.** ADR-0013 — native data is cleaner/authoritative for facts, but its keys are
*operator-chosen action names*, so matching is **by normalized keyword, not exact key** (robust across
agents). Native data records only successes — *never gaps* — which is why signals stay with the LLM.
**Gotcha.** `bookingInterest` requires **both** "booking" and "interest" in the key *"so it doesn't
swallow 'Treatment Interest' or 'DateTimeOfBooking'"*; `mapBookingInterest`/`parseBookedAt`/`truthy`
are tolerant; `hasAny` drives the lead's `source` provenance.

### `server/src/analysis/recommend.ts`
**What.** The cross-call synthesis (R2.5): gather an agent's analyses + KPI averages, digest into
evidence, ask Opus for a short list of concrete fixes — cached by scored-call count.
**Why.** R2.5; Opus (ADR-0002). The cache (`agent_recommendations.based_on_calls`) means the
slow/paid synthesis only runs on a cache miss.
**Key bits.** `buildEvidenceDigest` sorts KPIs weakest-first and **groups deviations across calls by
KPI** (caps 4 examples each) to surface recurring patterns. `assembleRecommendations` filters
`evidenceCallIds` through `validCallIds` — *never surface a hallucinated call reference.* Caching:
returns cache only if `cached.basedOnCalls === callCount` (unless `force`); zero calls short-circuits
with no LLM call; `agentKey = agentId ?? ''` (`''` = location-wide), `UNASSIGNED_AGENT` reported as `null`.

### `server/src/llm/agent.ts`
**What.** The single Claude entry point: `runStructured` runs one schema-constrained, tool-less
generation via the Agent SDK and returns the parsed object.
**Why.** Access via the **Agent SDK OAuth token** (not a bare key); centralizes ADR-0002's structured-
output mandate so every caller gets the same contract.
**Key bits.** `CLAUDE_MODEL = 'claude-opus-4-8'` (default); `query(...)` with
`outputFormat: { type:'json_schema', schema }`, `allowedTools: []`, **`maxTurns: 6`** (the gotcha:
structured-output validation/retries consume turns, so `maxTurns:1` fails with `error_max_turns`).
Prefers `message.structured_output`, **falls back** to `JSON.parse(message.result)`. Model is per-call
overridable — exactly how `extractLead` selects Haiku while scorer/recommender stay on Opus.

---

## 4. Backend · Persistence, read API, and auth

> The data spine: Postgres with **no ORM** (raw `pg` parameterized SQL behind swappable repository
> interfaces, ADR-0008), the read-only `/api/*` surface, and a bearer-token guard. The shape is a
> **source-of-record + derivation** layering (ADR-0011): `raw_call` is captured verbatim on ingest,
> and everything derived (`call_analysis` → `call_kpi`, `call_lead`) FK-CASCADEs off it. Common query
> dimensions are denormalized and KPI scores exploded into a flat row set, so the analytics workload
> (`GROUP BY agent_id, kpi_key`) is plain SQL — the reason this is Postgres, not a document store.

### `server/src/db/pool.ts`
**What.** Owns the lazy `pg.Pool` and `initSchema()` — idempotent `CREATE TABLE IF NOT EXISTS` DDL for
all six tables + indexes.
**Why.** No ORM (ADR-0008): the workload *is* aggregations, so legible SQL wins. Lazy pool so non-DB
commands work without `DATABASE_URL`. Layout per ADR-0011 (raw source-of-record; derivations FK CASCADE).
**Key bits.** `call_lead` FKs to `raw_call` (**not** `call_analysis`) — a lead is extracted
independently of scoring. Denormalized `location_id`/`agent_id` on every derived table. Flat `call_kpi`
`PRIMARY KEY (call_id, kpi_key)` + `idx (agent_id, kpi_key)`. **Partial indexes**
`WHERE missed_opportunity` / `WHERE human_action_needed`. `oauth_tokens.expires_at` BIGINT (epoch-ms,
returned as string). Schema changes ship as one-shot scripts (`CREATE IF NOT EXISTS` never `ALTER`s).
Full reference: [`SCHEMA.md`](../server/src/db/SCHEMA.md).

### `server/src/store/rawCallRepository.ts`
**What.** The source-of-record repo: stores/reads the verbatim GHL payload + lifted metadata in
`raw_call`, before analysis.
**Why.** ADR-0011 — capturing raw before the LLM is the standard ingest/transform split; *"the
expensive, flaky transform can't take the source down with it."*
**Key bits.** `RawCallRepository` interface (`init/hasRaw/saveRaw/getRaw`); `saveRaw` is an idempotent
`ON CONFLICT (call_id) DO UPDATE` upsert; the only table with no FK parent (it *is* the root aggregate).

### `server/src/store/analysisRepository.ts`
**What.** Persists a `CallAnalysis` into `call_analysis` + flat `call_kpi` (transactionally), reads
scored calls back (JOINing `raw_call`), and owns the KPI-average query + the recommendations cache.
**Why.** The swap point from ADR-0008; the flat `call_kpi` set is *the analytics query Postgres is here
for* (R2.4). Per ADR-0011 the read shape `StoredCall` is unchanged (API contract didn't move).
**Key bits.** `UNASSIGNED_AGENT = '__unassigned__'` sentinel (a real string can't carry `IS NULL`).
**Transactional `save()`**: `BEGIN` → upsert `call_analysis` → `DELETE` + re-insert `call_kpi` rows →
`COMMIT`. `kpiAverages` runs `ROUND(AVG(score))::int … GROUP BY agent_id, kpi_key` directly on the flat
table (denormalization paying off). `countCalls` is the cache-invalidation signal; recommendations
cache keyed `(location_id, agentKey)` with `''` = location-wide. Rows are hand-mapped (ADR-0008) —
drift caught by integration tests, not the compiler.

### `server/src/store/leadRepository.ts`
**What.** The queryable business layer: per-call lead facts + the two signals (R2.3/R2.6) in `call_lead`.
**Why.** Same swappable pattern (ADR-0008); **no approval/workflow methods** — signals are read-only
observability (ADR-0012). FKs to `raw_call` (ADR-0011).
**Key bits.** `listLeads` builds the WHERE dynamically, reusing the `UNASSIGNED_AGENT → IS NULL`
convention; boolean signal filters append bare predicates (`AND missed_opportunity`) that hit the
partial indexes; `source`/`native`/`extraction` capture provenance + verbatim fidelity. No mutation API.

### `server/src/routes/api.routes.ts`
**What.** `apiRouter` — the read-only `/api/*` surface: some routes proxy live GHL, others read the repos.
**Why.** The dashboard read path (R2.4). Recommendations computed on demand (R2.5) with caching in the
repo. Lead routes expose the two signals as filters.
**Routes.** `/installs`, `/installs/:key/status` (live probe), `/agents`, `/calls(/:id)` (live),
`/analyses(/:callId)`, `/kpis/averages`, `/recommendations?refresh=` (the cache-bust), `/leads?…&missedOpportunity=1`,
`/leads/:callId`.
**Convention (gotcha).** 400 = bad params, 404 = "not ingested yet", **502 = upstream GHL failure**,
**500 = storage failure** — so the dashboard can tell "GHL is down" from "our DB errored." Every route
is `GET` (no booking mutation; the CRM owns that). `agentId` passes through verbatim so
`'__unassigned__'` works end-to-end.

### `server/src/middleware/apiAuth.ts`
**What.** A bearer-token middleware guarding `/api/*` (401 without the token).
**Why.** Honest, documented threat model: blocks **public/automated** access to call data; token is
provisioned per deploy and injected into the served SPA (never in git). It is **not per-user identity**
— anyone who loads the page can read the token; per-user auth (HighLevel SSO) is a tracked follow-up.
**Key bits.** Constant-time `timingSafeEqual` with a length-mismatch guard. **Open when unconfigured**
(`!expected → next()`) so dev/tests have no token; prod sets the env. Pairs with the `window.__API_TOKEN__`
injection. `/health` · `/oauth` · `/webhooks` stay open (machine-to-machine; they can't carry the SPA token).

---

## 5. Frontend · The unified dashboard

> A Vue 3 + Vite + TS SPA embedded as an iframe inside HighLevel. Deliberately minimal — **Vue is the
> only runtime dependency**: no router, no state library, no charting library (KPI visuals are
> hand-rolled CSS bars, ADR-0009). Navigation is a hand-built **view-state stack machine** (overview →
> agent → call) with derived breadcrumbs (UX-002, R2.4). One typed, schema-validated API client mirrors
> the backend's types and reproduces its transcript parser byte-for-byte so evidence indices align. The
> craft layer (entrances, GPU `scaleX` bars, press feedback, unified loader, reduced-motion) is held to
> Emil Kowalski's bar (ADR-0005, E1).

### `web/src/main.ts`
**What/Why.** The 5-line bootstrap: `createApp(App).mount('#app')` + the single `import './style.css'`
that makes the shared tokens/primitives available app-wide (ADR-0009/0005). All composition lives in `App.vue`.

### `web/src/App.vue`
**What.** The root shell and **view-state machine**: navigation, install/location picker, breadcrumbs,
the non-destructive header Refresh, and the Connections modal.
**Why.** The core drill-down (UX-002, R2.4/R2.6, E1) without a router — a stack of view objects is
simpler and sufficient for a 3-level hierarchy. Unified loader + non-destructive Refresh (UX-013);
Connections-as-icon (UX-012).
**Key bits.** `type View = {kind:'overview'} | {kind:'agent';agentId} | {kind:'call';callId;fromAgentId?}`;
`viewStack = ref<View[]>([…])` *is* the navigation model; breadcrumbs/back-labels are pure derivations.
`refresh()` calls the active child's exposed `reload()` (`viewRef`), shows a real `.btn-spinner` with a
**min-450ms floor** so it never flickers, then `showToast('Refreshed')` — and **does not** re-synthesize
recommendations (*"no surprise Opus spend"*). `:key` per view forces a fresh load on drill/switch.
`view-enter` is **omitted on overview** (its transform would trap the fixed `.page-loader`).

### `web/src/api.ts`
**What.** The single typed API client: domain types mirrored from the backend, **fail-loud schema
validators**, fetchers, a byte-identical transcript parser, and presentation utilities.
**Why.** *"Mirrors `server/src/analysis/types.ts`."* Validation fails loud in dev so backend drift
surfaces immediately, not as a silent `undefined`. The client-side parser exists so evidence/turn
indices align with the backend.
**Key bits.** `assertString/Array/Object` + `validate*` build typed objects field-by-field;
`apiHeaders()` echoes `window.__API_TOKEN__` as a bearer token; `parseTranscript` *mirrors the backend
exactly*; `UNASSIGNED_AGENT` must match the SQL sentinel; `fetchRecommendations({refresh})` sets
`refresh=1` only to force (UI normally omits → cache-aware); `fetchLead` returns `null` on 404 (leads
are supplementary); the server's verbatim `extraction` is **intentionally not surfaced** (provenance is
shown via `source` + `native`).

### `web/src/agents.ts`
**What.** A reactive, per-location **agent-name cache** so the UI shows names, not opaque ids (UX-008).
**Why.** Resolution must be synchronous for templates yet reactive so views re-render once names arrive.
**Key bits.** `namesByLocation` (`reactive`); `ensureAgents` is idempotent (`inflight[loc] ??= …`) and
**caches the miss** (`{}`) so a failure doesn't loop; `displayName` returns `'Unassigned'` for the
sentinel, else cached name `?? agentLabel` (short-id fallback for deleted-but-stored agents).

### `web/src/style.css`
**What.** Global design tokens + shared primitives: colors/easings, `.card`/`.btn`/`.badge`, the CSS KPI
bar, entrance/stagger/spinner animations, the unified `.page-loader`, reduced-motion overrides.
**Why.** Native HighLevel look (UX-005, E1); CSS bars (ADR-0009); Emil motion + reduced-motion (ADR-0005,
UX-007/011); the `.page-loader` is the UX-013 fix.
**Key bits.** Strong custom easings `--ease-out: cubic-bezier(0.23,1,0.32,1)` (built-ins *"too weak"*);
`.btn:active { transform: scale(0.97) }` press feedback; the KPI fill is **GPU `transform: scaleX(var(--fill-scale))`**
(*"never animate `width`"*); `.page-loader` is a `position:fixed; inset:0` viewport-centered loader used
by every load phase (zero layout shift); `@media (prefers-reduced-motion: reduce)` disables every
transform/entrance but keeps the spinner (it *"communicates ongoing work"*).

### `web/src/components/OverviewView.vue`
**What.** The landing screen: a summary strip + a grid of agent cards (avg score, KPI mini-strip,
per-agent signal counts) that drill into an agent.
**Why.** Top of the drill-down (UX-002, R2.4); per-agent + location-wide signal tallies surface R2.3/R2.6
at a glance (UX-010).
**Key bits.** `load(silent)` `Promise.all`s analyses/KPIs/leads(+`.catch(()=>[])`)/ensureAgents;
`defineExpose({ reload: () => load(true) })`; **silent Refresh** keeps content visible + stale data on
failure; `signalsByAgent`/`totalSignals` tallies bucketed by `agentId ?? UNASSIGNED_AGENT`; uses the
shared `.page-loader`; shows `✓ No signals flagged` when clean.

### `web/src/components/AgentView.vue`
**What.** The agent profile: header (name, avg, weakest-KPI alert, signal tallies), KPI profile bars, the
lazy **Recommendations** panel with its own cache-aware Refresh, and a filterable call list.
**Why.** Middle tier (UX-002); recommendations surfacing (R2.5, UX-009) with the **cache-aware Refresh
that avoids wasted Opus spend** (E3); signal filters/badges (R2.3/R2.6, UX-010).
**Key bits.** `loadRecommendations({reload?, force?})` — `reload` re-fetches (server returns cache when
the call count is unchanged, re-synthesizing **only** on new calls); `force` bypasses the server cache
and is **reserved for scripts, not the UI** (the panel button calls `{reload:true}`, tooltip: *"uses
Opus only when there are new calls"*). Two-tier loading (main vs recs, with the recs panel's own
"Synthesizing across N calls…" state). `defineExpose({ reload: () => loadMain(true) })` — Refresh
reloads main data only. Evidence call-id chips emit `selectCall` (jump into the call, UX-003).

### `web/src/components/CallView.vue`
**What.** The call drill-down: header + summary, a **Lead & Outcome** panel (booking status, facts, both
signals with reasons, provenance badge, native `extractedData` drawer), per-KPI scorecards with evidence
chips, ranked deviations, and the transcript with Use-Action overlays.
**Why.** Bottom tier (UX-002); *"issue + fix + evidence together"* (UX-003) — chips/links scroll-highlight
the exact turn, amber UseAction banners sit over their turns (R2.6); Lead & Outcome surfaces R2.3/R2.6 +
provenance (UX-010).
**Key bits.** `load` `Promise.all([fetchCall, fetchLead.catch(()=>null)])` (a missing lead *"must not
blank the call view"*); `turns = parseTranscript(rawCall.transcript)` — same parser as the backend, so
`startTurn`/`endTurn`/`evidence` indices line up exactly; `scrollToTurn` assigns `id="turn-{i}"` +
highlight; the `source-badge` (GHL-confirmed vs Inferred) + collapsible native drawer make ground-truth
vs inferred visible (the `extraction` blob stays hidden, per `api.ts`).

### `web/src/components/KpiBar.vue`
**What/Why.** The reusable CSS KPI bar (ADR-0009) — used in the overview mini-strip and agent profile.
**Key bits.** `fillScale = clamp(score,0,100)/100`; `:style="{ '--fill-scale': fillScale, background: fillColor }"`;
**GPU `scaleX` reveal** (`kpi-grow`), reduced-motion disables it. (CallView intentionally inlines its own
bar rather than reusing this.)

### `web/src/components/ConnectionsPanel.vue`
**What.** Connections & Settings: a header corner icon (with a backend status dot) that opens a modal —
installs list, per-account live "Check HighLevel status" probes, connect/re-authorize links.
**Why.** UX-012 demoted a full-width bar (load-shift + header dominance) to an icon + modal. The live
probe (UX-001/006, R1.2) reflects HighLevel's *real* state, not just the local token. Modal motion held
to the Emil bar (ADR-0005).
**Key bits.** `badgeClass` is the green/amber/red triad (connected+scoped / missing-scope / revoked);
full modal a11y (`role="dialog" aria-modal`, Esc, body-scroll lock, focus to close-button on open and
**returned to trigger on close**, backdrop dismiss); **Emil-correct motion** — backdrop fades, modal
scales from center (the documented modal exception), enter 200ms / exit 150ms, reduced-motion fades
without transform; teleported to `<body>`.

---

## 6. Testing strategy

- **Server — 59 tests (Vitest), incl. real Postgres integration.** Pure logic is unit-tested
  (`transcript`, `kpis`, `score`'s `assembleAnalysis`, `extractLead`'s assemblers, `nativeFacts`,
  `recommend`'s digest, `verifyGhl`); the repositories run against a **local Postgres** so SQL/row-mapping
  drift is caught at test time (the trade-off accepted with the no-ORM/hand-mapped-rows choice, ADR-0008).
- **Web — 15 unit (Vitest) + 19 E2E (Playwright).** Unit tests pin the pure logic in `api.ts` — most
  importantly that **`parseTranscript` stays byte-identical to the backend** (so evidence indices align)
  and `deriveAgents`/signal helpers. E2E drives the full flow (overview → agent → recs → call → evidence),
  every UX-004 state, the craft layer (validated via *computed styles*, not a recording), reduced-motion,
  the Connections modal, the non-destructive Refresh (spinner + toast), and the signals/leads surfacing —
  with the **API mocked at the browser layer** (`e2e/mock.ts`), so the suite is hermetic (no backend/DB/LLM).
- **Quality gates** (the `quality-gates` skill): typecheck → lint(n/a) → test → review, run before any
  change is "done" (E4).

---

## 7. Decision index

*Where each ADR lives in the code.* Full context in [`decisions/`](./decisions):

| ADR | Decision | Shows up in |
|-----|----------|-------------|
| **0002** | Tech stack; Claude via Agent SDK; model routing (Haiku extract / Opus judge) | `llm/agent.ts`, `score.ts` (Opus), `extractLead.ts` (Haiku), `recommend.ts` (Opus) |
| **0004** | Single-origin host + cloudflared tunnel; iframe-safe | `index.ts` (CSP, SPA serving), `config.ts` |
| **0005** | Emil Kowalski craft benchmark | `style.css` (easings, reduced-motion), `App.vue`, `ConnectionsPanel.vue`, `KpiBar.vue` |
| **0008** | Postgres + JSONB, **no ORM**, swappable repositories | `db/pool.ts`, all `store/*`, `tokenStore.ts` |
| **0009** | CSS bars, no charting library | `style.css` (`.kpi-bar-*`), `KpiBar.vue` |
| **0010** | Lead data model + LLM extraction (Haiku) | `extractLead.ts`, `types.ts` |
| **0011** | Normalize `raw_call` as source-of-record (FK CASCADE) | `ingestCall.ts` (capture first), `rawCallRepository.ts`, `db/pool.ts` |
| **0012** | Leads as **observability signals**, not a booking workflow | `types.ts` (`CallLead` has no workflow state), `leadRepository.ts` (no mutations), the dashboard signals |
| **0013** | Hybrid facts: native `extractedData` > contact > LLM; signals always LLM | `nativeFacts.ts`, `extractLead.ts` (`assembleLead` precedence), the `source`/`native` provenance UI |

Requirement IDs (`R*`, `D*`, `E*`) trace to [`requirements.md`](./requirements.md); assumptions
(`A-*`) to [`assumptions-and-product-calls.md`](./assumptions-and-product-calls.md); UX changes
(`UX-*`) to [`ux-changelog.md`](./ux-changelog.md).
