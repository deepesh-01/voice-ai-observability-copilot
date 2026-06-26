# ⚖️ Trade-offs — Defend Every Choice

Format for each: **Chose · Alternative · Why for THIS app · When I'd flip.**
The framing to say out loud: *"I chose X over Y; for this app's constraints X wins because Z — but I'd
switch to Y when W."* The **"when I'd flip"** is the senior signal — it proves the choice was deliberate,
not default.

> 🎤 **Universal opener:** *"That was a deliberate trade-off, not a default. Here's what I weighed…"*

---

## A. Data & Persistence

**1. Postgres vs a document store (Mongo)**
- **Chose:** Postgres. **Alt:** MongoDB / Firestore.
- **Why:** the product's core query is **analytical** — "avg KPI per agent, weakest-first" → a flat
  `call_kpi` table makes it one indexed `GROUP BY`. Relational integrity (FKs, cascade) keeps derived data
  consistent with the raw call. I know Postgres deeply → fastest correct build in a 5-day window.
- **Flip when:** schema is highly variable, I need massive horizontal write scale (250k writes/sec), or
  org standard is Mongo (HighLevel) → then shard by `locationId`, embed analysis in the call doc.

**2. Flat `call_kpi` table vs KPI scores only in JSONB**
- **Chose:** flat per-KPI rows **+** full JSONB. **Alt:** JSONB-only (parse in app).
- **Why:** averages = plain SQL aggregation on indexed columns; JSONB-only would mean reading N docs and
  averaging in app code. I keep JSONB too for full-fidelity detail views — hybrid: columns for query,
  JSONB for fidelity.
- **Flip when:** I never aggregate (then JSONB-only is simpler), or I move to Mongo (embed + `$unwind`, or
  push rollups to ClickHouse).

**3. `raw_call` as source-of-record (store before scoring) vs score-on-arrival**
- **Chose:** persist raw first, derive after. **Alt:** parse+score in one step, store only the result.
- **Why:** **durability** — a scoring/LLM failure never loses the call; re-ingest replays from raw. System
  becomes independent of GHL after the webhook lands.
- **Flip when:** storage cost of raw payloads is prohibitive and re-fetch from source is cheap/reliable →
  then store a reference, not the blob.

**4. No ORM (raw SQL behind repositories) vs an ORM (Prisma/TypeORM)**
- **Chose:** explicit SQL behind swappable repository interfaces. **Alt:** ORM.
- **Why:** full control over the exact queries (the aggregations are the whole point); no ORM magic/
  N+1 surprises; the repository interface is the real swap-point (Postgres→Firestore) without ORM lock-in.
- **Flip when:** large team + lots of CRUD where ORM velocity > query control, or I want migrations
  tooling out of the box.

**5. Denormalize `location_id`/`agent_id` onto every table vs normalize + join**
- **Chose:** denormalize. **Alt:** join back to `raw_call` for tenant/agent.
- **Why:** they're in nearly every `WHERE`; immutable per call → no update anomaly. Join-free tenant reads
  on the hot path. Cost is a few bytes.
- **Flip when:** the denormalized field were mutable (update anomalies) — then normalize.

---

## B. Ingestion & Concurrency

**6. Webhook ack-fast + process-async vs synchronous processing in the handler**
- **Chose:** verify → store → **202 in ~30ms** → score async. **Alt:** score inside the request, then respond.
- **Why:** scoring is ~20s; GHL times out slow handlers and retries → a synchronous handler causes retry
  storms + duplicate work. Ack means "received & durable," not "processed."
- **Flip when:** processing is fast (<1–2s) and the caller needs the result inline → then synchronous is simpler.

**7. In-process async (fire-and-forget IIFE) vs a durable queue**  *(honest gap)*
- **Chose:** in-process IIFE (for the assignment). **Alt:** Kafka/Pub/Sub/BullMQ queue + workers.
- **Why (for now):** simplest thing that closes the loop in a 5-day single-node build; the poll script is a
  manual backfill.
- **Flip when:** ANY real scale or multi-pod → **flip immediately.** "This is the first thing I'd change:
  enqueue `{callId}`, worker pool with bounded concurrency, retries+backoff→DLQ, reconciliation cron." 
  *(Volunteer this — it's a known gap.)*

**8. In-memory `inFlight` Set dedup vs DB atomic claim**  *(honest gap)*
- **Chose:** in-memory Set (single-pod). **Alt:** `INSERT … ON CONFLICT DO NOTHING` (callId PK) /
  `findOneAndUpdate({status:'pending'})`.
- **Why (for now):** works for a single instance; the PK + `ON CONFLICT` upsert already make writes idempotent.
- **Flip when:** multi-pod → flip immediately. The Set doesn't share across pods; the **atomic claim** does.
  *The lock is a cost optimization; the idempotent write is correctness.*

**9. Poll + webhook (both) vs webhook-only**
- **Chose:** webhook primary + poll backfill. **Alt:** webhook only.
- **Why:** webhooks are at-least-once and can be missed (downtime, failed async); poll is the safety net /
  backfill for history. Belt-and-suspenders.
- **Flip when:** I have a durable queue + reconciliation (then poll becomes redundant) — or replace poll
  with **change streams** on Mongo.

**10. Signature verification opt-in vs enforced**  *(honest gap)*
- **Chose:** opt-in (`WEBHOOK_REQUIRE_SIGNATURE`, default off). **Alt:** enforce always.
- **Why (for now):** the Ed25519 public key wasn't confirmed against a live delivery during bring-up;
  enforcing would block testing.
- **Flip when:** key confirmed against a real `VoiceAiCallEnd` → enforce in prod, reject unsigned, dedup by `webhookId`.

---

## C. LLM & Analysis

**11. Two-tier model routing (Opus + Haiku) vs all-Opus or all-Haiku**
- **Chose:** Opus for judgement (scoring/synthesis), Haiku for fact extraction. **Alt:** one model everywhere.
- **Why:** match model cost to task difficulty — extraction is "copy what's stated" (Haiku); scoring is
  nuanced judgement (Opus). All-Opus = wasteful; all-Haiku = worse judgement.
- **Flip when (scale):** push further into a **tiered funnel** — Tier-0 heuristics + Haiku on every call,
  Opus only on flagged/sampled (~1–5%).

**12. Schema-validated structured output vs free-text LLM + parsing**
- **Chose:** JSON-schema constrained output (`runStructured`). **Alt:** prompt for text, parse/regex it.
- **Why:** the UI can trust the data shape; no brittle parsing; retries happen at the validation layer.
- **Flip when:** never, really — but if the model didn't support structured output, I'd parse + validate
  hard with a pure function (which I do anyway as a second guard).

**13. Pure/total `assemble*()` guards vs trusting the model output**
- **Chose:** pure functions that clamp scores, drop unknown KPIs, validate turn indices, strip hallucinated
  call-ids. **Alt:** trust the structured output as-is.
- **Why:** LLM output is probabilistic; the schema can't express numeric bounds or valid indices. Pure+total
  = unit-testable without the LLM, can't throw on garbage. Makes a probabilistic component safe behind a typed API.
- **Flip when:** never — this is non-negotiable for LLM-in-the-loop.

**14. Recommendation cache keyed by scored-call count vs always-compute vs TTL**
- **Chose:** cache per `(location, agent)`, invalidate when call count changes. **Alt:** recompute every
  request / time-based TTL.
- **Why:** synthesis is the most expensive Opus call; it only needs to change when the evidence (calls)
  changes. 67s → 0.005s on hit.
- **Flip when:** calls get re-scored without count change (count-key goes stale) → key on a hash/version of
  inputs, or add a TTL.

**15. KPIs as config-driven data vs hardcoded in prompts**
- **Chose:** `KPI_CATALOG` (data: key, rubric, weight). **Alt:** bake KPIs into the prompt string.
- **Why:** add/remove/reweight a KPI without touching the scoring pipeline; schema enum derives from it;
  testable. Adding a 7th KPI is a catalog entry.
- **Flip when:** never for this; if KPIs were per-tenant customizable I'd move the catalog to the DB.

**16. Native facts > contact > LLM precedence; signals always LLM**
- **Chose:** prefer GHL `extractedData` for facts, LLM for signals. **Alt:** LLM for everything.
- **Why:** the agent's own structured extraction is ground-truth for facts (clean phone, booking enum);
  signals ("what the agent *failed* to do") are exactly what GHL doesn't emit → must be LLM. `source` flag
  keeps provenance honest.
- **Flip when:** native extraction is unavailable/unreliable → fall back to LLM (already the fallback).

**17. Claude Agent SDK vs bare Messages API**
- **Chose:** Agent SDK (OAuth token). **Alt:** raw Anthropic Messages API (API key).
- **Why:** structured-output handling + auth via `claude setup-token` (no bare key in env for this build).
- **Flip when:** I need fine-grained control over requests/streaming/cost telemetry, or a different provider
  → go to the raw API behind the same `runStructured` seam.

---

## D. API, Auth & Scope

**18. Shared injected bearer token vs per-user SSO auth**  *(honest gap — your #1 fix)*
- **Chose:** one `API_AUTH_TOKEN` injected into the SPA at runtime. **Alt:** HighLevel SSO (decrypt embedded
  user context with the Shared Secret).
- **Why (for now):** blocks public/automated access to call data; keeps the token out of git; works embedded
  + standalone in the time available.
- **Flip when:** real multi-tenant prod → **flip immediately.** "It's not per-user identity — anyone who
  loads the page can read the token, and the API trusts a client-supplied `locationId`. The fix is SSO:
  derive `locationId` from the verified session, never the request." *(Volunteer this.)*

**19. No booking/approval workflow (Monitor+Analyze only) vs building the Act phase**
- **Chose:** read-only signals (`missed_opportunity`, `human_action_needed`); HighLevel's CRM owns bookings.
  **Alt:** build approve/reject booking workflow (I briefly did, then deleted — ADR-0012).
- **Why:** an Act phase re-implements HighLevel's CRM — scope drift, not observability. Flag for the
  operator instead.
- **Flip when:** the product explicitly wants closed-loop automation → build Act as durable workflows
  (Wait-steps = persisted resumable timers).

---

## E. Frontend (decisions are yours; AI implemented)

**20. `ref`-stack view-state machine vs vue-router**
- **Chose:** a `ref<View[]>` stack (push/pop = drill-down + breadcrumbs). **Alt:** vue-router.
- **Why:** a 3-level drill-down doesn't need URL routing, route guards, or a router dependency; the stack is
  ~20 lines and gives breadcrumbs for free. Embedded in an iframe, the **host owns the URL bar**, so a
  router's deep-link/back-button benefits don't even apply.
- **Flip when:** I need deep-linkable URLs, browser back/forward, or many independent routes → vue-router.

**21. No Pinia (module-level `reactive`) vs a state library**
- **Chose:** a composable (`agents.ts` reactive cache). **Alt:** Pinia.
- **Why:** small app, little shared state — a reactive module is right-sized; Pinia would be ceremony.
- **Flip when:** shared state grows, needs devtools/time-travel/SSR hydration → Pinia.

**22. CSS-transform bars vs a charting library**
- **Chose:** GPU `transform: scaleX()` bars. **Alt:** Chart.js / D3.
- **Why:** zero bundle cost, full control, no iframe/canvas quirks, animates on the GPU.
- **Flip when:** I need real charts (time-series, scatter, axes) → a charting lib.

**23. `avgScore` on the frontend vs backend**
- **Chose:** frontend `computed`. **Alt:** compute server-side, send as a field.
- **Why:** the client already has the `calls` data; trivial; should react to client-side filters → no
  round-trip. (Contrast: KPI averages ARE backend — they aggregate over data the client doesn't hold.)
- **Flip when:** the value must be authoritative/consistent across clients, or aggregates data not on the
  client → backend.

---

## F. Stack

**24. Express vs NestJS** *(HighLevel prefers NestJS — have the answer ready)*
- **Chose:** Express. **Alt:** NestJS.
- **Why:** minimal, fast to stand up a focused service in 5 days; no need for Nest's DI/module ceremony at
  this size; fewer moving parts to explain.
- **Flip when:** larger team/codebase wanting structure, DI, decorators, built-in testing/validation —
  NestJS (which is HighLevel's standard, so in their codebase I'd use Nest). *Honest: "I'd happily use
  NestJS — Express was the right size for a solo 5-day build."*

---

## G. Extension / Scale trade-offs (likely live questions)

**25. DB atomic claim vs Redis lock** (for the worker claim)
- **Chose (recommend):** DB-native `UPDATE … WHERE status='pending' RETURNING` / `findOneAndUpdate`.
- **Why:** the state already lives in the DB; no second system to keep consistent; row lock gives the same
  mutual exclusion. **Redis earns its place** for sub-ms coordination, rate-limit counters, or taking load
  off the DB — not just "it's distributed."
- **Flip when:** I need cross-service locks or very high lock churn → Redis (with a TTL/lease + heartbeat).

**26. SSE vs WebSocket vs polling** (real-time dashboard)
- **Chose (recommend):** SSE. **Alt:** WebSocket / polling.
- **Why:** the stream is one-directional (server→dashboard); SSE is simpler, auto-reconnects, survives
  proxies. WebSocket only if I need client→server. Polling wastes requests.
- **Flip when:** bidirectional/low-latency interaction needed → WebSocket.

**27. Sliding-window-counter vs fixed-window vs sliding-log** (rate limiting)
- **Chose (recommend):** sliding window counter. **Alt:** fixed window (boundary burst) / sliding log (memory-heavy).
- **Why:** O(1) memory, no 2× boundary burst, cheap. In Redis + Lua for atomic cross-pod counting.
- **Flip when:** need perfect accuracy → sliding log; need dead-simple → fixed window.

**28. Embed vs reference** (Mongo modeling)
- **Chose (recommend):** embed analysis/KPIs/lead in the call doc; reference the big raw payload.
- **Why:** read-together data in one atomic doc (kills the transaction); large/unbounded payload stays
  separate (16MB cap).
- **Flip when:** a sub-document grows unbounded, or is queried independently/shared → reference it.

**29. Tiered LLM funnel vs Opus-on-everything** (scale)
- **Chose (recommend):** Tier-0 heuristics → Haiku → Opus on ~1–5% (flagged + sampled).
- **Why:** Opus on 2.5B calls/day is millions/day + rate-limit-impossible; cost should scale with
  *interesting* calls, not total.
- **Flip when:** volume is low enough that simplicity > cost → score everything.

**30. Sharding by `locationId`** (Mongo scale)
- **Chose (recommend):** shard key = `locationId` (compound `{locationId, callAt}`).
- **Why:** co-locates a tenant → most queries hit one shard, avoids scatter-gather.
- **Flip/mitigate when:** a whale tenant hot-spots a shard → hashed suffix `{locationId, callId}`. And note:
  **sharding is for scale, not security** — tenant isolation needs the enforced query filter, not the shard key.

---

## The meta-pattern (say this if you blank)
> *"My default reasoning: optimize for the actual constraint. For a 5-day solo build that's **correctness +
> closing the loop on real data + honesty about gaps** — so I chose the simplest thing that's correct and
> documented where I'd harden it for scale (queue, atomic claim, SSO). At HighLevel's scale the constraints
> change to **throughput, multi-tenant isolation, and cost**, and that's exactly where I'd flip each of
> these — to a durable queue, DB/atomic claims, SSO-derived tenancy, and a tiered LLM funnel."*
