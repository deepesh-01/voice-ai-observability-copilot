# 🎟️ HighLevel Extension Round — Cheat Sheet

Voice AI Observability Copilot · Coding + System Design (120 min) · Shivam (SDE-3, pushes
concurrency/real-time/workflow) + Tushar (generalist: Mongo, multi-tenancy, rate limits).

> **Hold SDE-3:** narrate trade-offs + ownership, not framework fluency. Downlevel risk is real.
> Your *thinking* is senior; the leak is *delivery in the first 3 answers*. Fix the openers.

---

## 0. The 3 reflexes that fix everything

1. **Lead with the MECHANISM, not the property.** Don't say "it's atomic / synchronous / use a
   queue." Say the actual op: `findOneAndUpdate({status:'pending'})` / `UPDATE … WHERE
   status='pending' RETURNING` / `INSERT … ON CONFLICT DO NOTHING`. **Name → mechanism, same breath.**
2. **Say `locationId` in your first 3 sentences of any system answer.** Tenant scoping is their spine.
3. **Don't improvise vague when you actually know it.** "Let me reason from my design…" > a fast fuzzy answer.

## 0.5. The 2 meta-reflexes (safety net for ANY unseen question)

- **Decouple cheap-durable ingest from expensive-retriable work** → queue + retries/backoff + DLQ + reconciliation.
- **Replace check-then-act with an atomic claim OR idempotent write.**
  - 🔑 **The lock is a COST optimization; idempotency is the CORRECTNESS guarantee.**

---

## 1. 30-second system pitch (LEAD WITH THIS)

> "It's a **multi-tenant** observability copilot for HighLevel Voice AI agents — everything scoped to
> a `locationId` (the sub-account). It closes one loop on **real data**: a call ends → GHL fires the
> `VoiceAiCallEnd` webhook → I verify the Ed25519 signature, **store the raw call, ack 202 in ~30ms**,
> and score **async**. Scoring is an **Opus** call (6 KPIs + deviations + 'Use Action' segments, judged
> against the agent's *own* configured goal), then a cheaper **Haiku** pass extracts lead facts. Results
> persist in **Postgres**, and a cross-call **synthesis** turns recurring failures into copy-pasteable
> prompt/script fixes — surfaced in a Vue dashboard **embedded in HighLevel**. The two decisions I'm
> proudest of: (1) **`raw_call` is the source-of-record** written before any analysis, so the system is
> independent of GHL and I can re-run any stage with zero data loss; (2) a **flat per-KPI table** so
> per-agent averages are one `GROUP BY` — that's *why* it's Postgres, not a doc store."

---

## 2. Design rationale — one-liners to defend cold

| Decision | The defense (say the mechanism) |
|---|---|
| **Ack-fast, process-async** | Scoring is ~20s; GHL times out slow handlers + retries → I 202 immediately, work happens off the request path. |
| **`raw_call` source-of-record** | Persist the call *before* analysis; a scoring failure never loses it (re-ingest replays). Durability ≠ processing. |
| **Postgres + flat `call_kpi`** | Product's core query is "avg KPI per agent" → `GROUP BY agent_id, kpi_key`. Flat rows make it one indexed query. JSONB keeps full fidelity for detail views. |
| **Denormalize `locationId`/`agent_id`** | In nearly every WHERE; immutable per call → no update anomaly. Trade bytes for join-free tenant reads. |
| **Schema-validated, pure LLM assembly** | Never trust raw model output. Schema constrains shape; pure+total `assemble*()` clamps 0–100, drops unknown KPIs, validates turn indices, strips hallucinated call-ids. Makes a probabilistic component safe behind a typed API. |
| **Opus + Haiku routing** | Judgement (scoring/synthesis) → Opus; fact extraction → Haiku (fraction of cost). Same `runStructured` seam. |
| **Recommendation cache** | Keyed by scored-call count; the expensive Opus synthesis only re-runs on new calls or `?refresh=1` (67s → 0.005s). |
| **Native-facts > contact > LLM; signals always LLM** | Facts: agent's own `extractedData` is ground-truth. Signals ("agent failed to convert", "human must follow up") = what GHL *doesn't* emit → LLM. `source` flag keeps it honest. |
| **Swappable repos / single seams** | Storage = interface, LLM = `runStructured`, GHL = thin client. The seam where Firestore / their model gateway plugs in. |
| **Idempotent ingest** | Webhooks are at-least-once → `has()` skip + `ON CONFLICT` upserts. Re-delivery is safe. |
| **Skipped on purpose** | No Act/booking workflow (re-implements their CRM, ADR-0012); no timing KPIs (no transcript timestamps); no per-user auth yet (documented). |

---

## 3. Weaknesses to VOLUNTEER (volunteering = ownership signal)

| Gap | Fix to say |
|---|---|
| **Dedup is in-memory (`inFlight` Set)** — single-pod only; double-spend race | Atomic claim in shared state: `INSERT raw_call ON CONFLICT DO NOTHING RETURNING` (PK = the lock) or `findOneAndUpdate({status:'pending'})`. |
| **🥇 Multi-tenant authz hole** — API trusts client-supplied `locationId` | Derive `locationId` from the **verified token** (HighLevel SSO: decrypt embedded context w/ Shared Secret), never the request. **This is my #1 fix.** |
| **Async work = fire-and-forget IIFE in process memory** — lost on restart | Durable queue (Kafka/Pub/Sub) + retries (exp backoff + jitter) + DLQ. |
| **No retry/DLQ; poll backfill is manual** | Reconciliation cron: `SELECT raw_call LEFT JOIN call_analysis WHERE analysis IS NULL` → re-enqueue. |
| **Webhook `locationId` falls back to `listInstalls()[0]`** | Require it / resolve from `agentId`. Never guess the tenant. |
| **Sig verify opt-in; key unconfirmed** | Confirm key vs a live delivery, enforce in prod, dedup by `webhookId`. |
| **N+1 GHL calls/ingest, no rate-limit guard** | Cache agent prompts per location; token-bucket + 429 backoff. |
| **Opus on every call** | Tiered funnel + sampling (see §7). |
| **Poll reads first page only** | Paginate to `nextPage`; checkpoint `call_at` cursor. |

---

## 4. CONCURRENCY (Shivam's lane — the one that decides level)

### Concurrency vs parallelism
- **Concurrency** = dealing with many things at once (structure, interleaving). **Parallelism** = doing many at once (execution, multi-core).
- **Node:** your JS is **concurrent, single-threaded**. I/O happens off-thread; *your callbacks* run one at a time. Great for I/O-bound, bad for CPU-bound. **Parallelism comes from multiple pods / worker_threads / external systems.**
- ⚠️ **Single-threaded ≠ race-free.** Across an `await`, the event loop runs *other* code → check-then-act races happen on one thread. Across pods, it's true parallelism.

### Q1 — "10k webhooks at once. Walk me through it."
- **Break:** fire-and-forget IIFE = no back-pressure (blows LLM rate limit, DB pool, sockets, memory) + not durable (restart loses in-flight) + `inFlight` Set is per-pod.
- **Hidden bottleneck to volunteer:** `snapshot()` does a `writeFile` per webhook *before* the ack — pull it out of the hot path.
- **Fix, in order:** (1) handler = verify → `INSERT raw_call ON CONFLICT DO NOTHING` → **enqueue {callId}** → 202, nothing else; (2) worker pool, **bounded concurrency**, LLM rate-limited; (3) retries exp-backoff+jitter → **DLQ**; (4) **reconciliation cron** backstop; (5) at scale add the tiered funnel.
- **Line:** *"Ack isn't the hard part — durability of the work AFTER the ack is. The queue is the seam between cheap-durable ingest and expensive-retriable processing."*

### Q2 — "Two deliveries hit two pods. No double-score."
- **The bug:** `has()` (read) → 20s `scoreCall` → `save` (write) is **check-then-act** with a HUGE race window. Both pass `has()===false` → both score → double-spend.
- **Fix = atomic claim** (`status: pending→scoring→scored`):
  - PG: `UPDATE raw_call SET status='scoring' WHERE call_id=$1 AND status='pending' RETURNING call_id;` → exactly one row returned, loser gets 0.
  - **Mongo (say verbatim):** `findOneAndUpdate({_id:callId, status:'pending'}, {$set:{status:'scoring'}})` → one winner, others get `null`.
- **Why only one wins:** concurrent writers are **serialized by a lock**; the second blocks, then re-evaluates against the committed row (PG: READ COMMITTED + EvalPlanQual recheck) → its WHERE no longer matches → 0 rows. Unique index does the same for INSERT.
- **`callId` as PK = the cleanest dedup:** `INSERT … ON CONFLICT (call_id) DO NOTHING RETURNING` — got a row = I'm first, own it; nothing = someone else has it, bail.
- **INSERT-claim** = "is this call new?" (ingest dedup). **UPDATE-claim + lease** = "can I claim this row to process/retry?" Use both, layered.

### Lease / TTL (the #1 follow-up)
- A lock with no timeout deadlocks on crash. Lease = TTL covering **ONE attempt** (~20–30s + buffer), retry loop re-acquires fresh.
- **Heartbeat** the lease while alive → a *slow-but-alive* worker keeps it; only a *truly dead* one expires. Now expiry means "dead," not "slow."

### 🔑 Idempotency (THE deep one)
- **You can't get exactly-once *execution* in a distributed system. Aim for at-least-once + idempotent effects = exactly-once *outcome*.**
- **Two costs of double-processing:** duplicate DATA (correctness — fixed 100% by idempotent write) vs wasted Opus (money — minimized, never 0).
- **Visualization:** both workers score, both `INSERT … ON CONFLICT (call_id) DO UPDATE` → PK means **one row, second overwrites** → DB correct *by construction*. You don't prevent the 2nd run; you make it *not matter*.
- **Minimize the wasted spend:** (1) re-check `has()` right *before* the Opus call (shrinks window to ms); (2) heartbeat lease; (3) consciously accept a rare bounded double-spend.
- **🎤 Killer line:** *"The lock protects my wallet statistically; idempotency protects my data absolutely. I accept a rare double-spend on crash rather than over-engineer for an impossible exactly-once."*

---

## 5. Sliding window rate limiting (Tushar — 100/10s + 200k/day per tenant)

- **Fixed window:** bucket by time, `INCR`+`EXPIRE`. ❌ allows 2× burst across the boundary.
- **Sliding log:** store every timestamp in a sorted set, evict old, count. ✅ accurate ❌ memory-heavy.
- **✅ Sliding window counter (the answer):** `count = current + previous × (1 − elapsed_fraction)`.
  - e.g. prev=80, current=20, 30% into window → `20 + 80×0.7 = 76`. O(1) memory, no boundary burst.
- **Distributed:** counter in **Redis** (shared across pods), increment via **Lua script** (atomic — avoids its own check-then-act).
- **Two limiters per tenant** (10s burst + daily quota), keyed on **authenticated `locationId`** (not client input).
- Reject → `429` + `Retry-After`; emit `X-RateLimit-Remaining`.

---

## 6. Durable workflow / Wait step (Shivam — DripEngage lane; your strong topic)

> **A Wait step is NOT `setTimeout` — it's a persisted row + a poller + idempotent firing + condition re-check at wake.**

1. **Persisted intent:** `scheduled_action {id, type, fire_at, status:'pending', payload, dedup_key}` — survives restarts.
2. **Exactly-once firing:** poller claims due rows with the **Q2 atomic claim** (`UPDATE … WHERE status='pending' AND fire_at<=now() RETURNING`). *Same primitive as Q2.*
3. **Resumable/cancellable:** re-check live state at fire time (e.g. `human_action_needed` still true?) → no-op if resolved during the wait. State lives in DB; timer just wakes the evaluator.
4. **Idempotent action:** `dedup_key` on the SMS so a retried fire doesn't double-text.
- Generalize: Wait/If/Send = rows in a workflow-instance table; engine = **durable state machine** (like Temporal / Step Functions). **Say:** "the durable timer reuses my Q2 atomic claim for exactly-once firing — same primitive."

---

## 7. Scale / cost (Q4 — "can't Opus 2.5B calls/day")

> **Triage funnel — the expensive model only sees calls that earned it.** (Opus on everything = ~$1.25M/day, impossible.)

- **Tier 0** (every call, ~free): heuristics — length, booking words, was phone captured. Decides who escalates.
- **Tier 1** (every call, cheap): **Haiku** — fact extraction + coarse pass/fail. *(You already do this.)*
- **Tier 2** (~1–5%): **Opus** — only flagged/risky calls + **random sample for calibration** + on-demand when an operator opens a call.
- **Aggregates never touch the LLM** — KPI averages read pre-computed `call_kpi` rows; at scale → **ClickHouse**.
- **Line:** *"Cost scales with *interesting* calls, not *total* calls. Opus sees ~2%, analytics see 0%."*

---

## 8. Real-time dashboard (Q5 — FanClash fan-out lane)

1. After `save`, **publish** `{type:'call.scored', locationId, callId, score}`.
2. Clients hold **SSE** (one-directional server→client, survives proxies; WS only if bidirectional).
3. Fan-out via **Redis pub/sub** (or Pub/Sub + gateway), **filtered by `locationId`** (tenant isolation on the channel).
4. Don't hold connection→client maps in one process (same single-pod trap as `inFlight`).
5. Missed events: client reconnects with a `since` cursor → backfill from DB (never trust the socket alone).

---

## 9. Multi-tenancy (Tushar — fire ALL 3 LAYERS immediately)

> **Trusted token → auto-injected query filter → physical isolation.**

1. **Source of truth:** `locationId` from the **verified token**, never the request. Tenant is **not a client parameter** → nothing to forge. (HighLevel: SSO context decrypted with app **Shared Secret**, server-side.)
   - *Signing = integrity (can't modify); encryption = confidentiality (can't read). For tenant id you need integrity → JWT enough.*
2. **Query-scoped:** every query carries the token-derived `locationId` — enforce it in a **shared data-access layer that auto-injects the filter** (per-table config; global collections opt out) so a dev **can't forget**. *(NOT RBAC — RBAC = what you can DO; tenant isolation = what you can SEE.)*
3. **Physical isolation:** shard/DB per tenant-or-shard.
   - ⚠️ **Sharp nuance (A+):** *sharding by `locationId` is for SCALE, not security* — a forgotten filter still **scatter-gathers across all shards** and leaks. Sharding stops slow queries, the enforced filter stops leaky ones.
- **Volunteer:** "My current build trusts a client-supplied `locationId` — that's my #1 fix."

---

## 10. Postgres → Mongo mapping (your flagged weak area — keep it simple)

**Core shift: embed vs reference.** *Embed when read-together & belongs-to-parent; reference when large/unbounded/shared.* Hard cap: **16MB/doc**.

| Postgres | Mongo |
|---|---|
| table / row / column | collection / document / field |
| JOIN | `$lookup` (discouraged at scale) |
| GROUP BY | aggregation pipeline (`$match`/`$unwind`/`$group`) |
| `callId` PK | `_id: callId` (dedup carries over) |
| partial index | `partialFilterExpression` (direct parity) |

- **Your call → ~one document:** `_id`=callId, `locationId` on every doc, embed `analysis`+`kpiScores`+`lead`; keep big `rawPayload` separate (16MB).
  - **Win:** embedding `kpiScores` makes the write a **single atomic doc** → the Postgres txn (`call_analysis`+`call_kpi`) **disappears**. *"Mongo is actually simpler here."*
- **Analytics challenge:** `$match → $unwind kpiScores → $group {$avg}`. **But the honest senior answer: don't make Mongo do analytics at 250TB — push KPI rollups to ClickHouse.** *(Knowing when NOT to use the aggregation pipeline = the signal.)*
- **Shard key = `locationId`** (compound `{locationId, callAt}`): co-locates a tenant, avoids scatter-gather. Hot-spot risk on a whale tenant → hashed suffix `{locationId, callId}`.
- **Concurrency:** `findOneAndUpdate({_id, status:'pending'})` — native, identical guarantee to your PG claim.
- **Change streams** replace your poll loop: react to inserts (resume token = at-least-once), doubles as the real-time feed.
- **Pagination:** range/cursor on `_id`/`callAt`, **never `skip`** (O(n) scan).
- **Humility line:** *"I'm deepest in Postgres — the questions don't change though: shard key = tenant, atomic `findOneAndUpdate`, embed-vs-reference by read-locality + 16MB, analytics → ClickHouse. Where does HighLevel draw those lines?"*

---

## 11. Schema evolution (Tushar — add a 7th KPI)

- **Add to KPI catalog (config-driven data)** → new calls score 7 automatically. ✅ your real strength.
- **Averages don't corrupt** because KPIs average **independently** (`GROUP BY kpi_key`): old calls have no `compliance` row → excluded naturally, no divide-by-wrong-N. *That's why flat per-KPI rows.*
- **Subtlety (A+):** `weightedOverall` normalizes by *present* weights → old overalls (6 KPIs) vs new (7) aren't directly comparable. Fix: **version the doc** (`schemaVersion`/`kpiSet`) so UI knows the set; backfill optional/async.
- **Mongo old docs:** schemaless → missing field is just **absent** (not null, no error); `$avg`/`$group` **ignore** docs missing the field → average auto-correct.

---

## 12. Node event-loop internals (coding round may probe)

- **Phases (libuv):** timers (`setTimeout`/`setInterval`) → pending → poll (I/O) → **check (`setImmediate`)** → close.
- **Microtasks run BETWEEN every phase + after each callback.** Order: **`process.nextTick` queue first, then Promise queue.**
- **`setImmediate` vs `setTimeout(fn,0)`:** inside an I/O callback, **`setImmediate` fires first** (check before next timers loop). At top level → non-deterministic.
- **`await` yields to the microtask queue** → code after `await` is a microtask. This is the **await-gap** where check-then-act races live (§4).
- **CPU-bound work blocks the single thread** → use `worker_threads` / break into chunks / offload.
- Macrotask = timers/IO/immediate; microtask = promises/nextTick. Microtasks drain fully before the next macrotask.

---

## 13. 🎤 One-liners to drop verbatim

- *"Everything's scoped to a `locationId` — the sub-account."* (open with it)
- *"`raw_call` is the source-of-record; the system is independent of GHL once the webhook lands."*
- *"Flat per-KPI table → averages are one `GROUP BY` — that's why it's Postgres."*
- *"Ack isn't the hard part; durability of the work after the ack is."*
- *"At-least-once delivery means an atomic claim, not check-then-act."* (`findOneAndUpdate`/`UPDATE…RETURNING`)
- *"The lock protects my wallet statistically; idempotency protects my data absolutely."*
- *"Exactly-once execution is impossible — at-least-once + idempotent effects = exactly-once outcome."*
- *"Every lock gets a lease; heartbeat so expiry means dead, not slow."*
- *"Tenant isn't a client parameter — it comes from the verified token, never the request."*
- *"Auto-inject the tenant filter in a shared data layer so a dev can't forget."*
- *"Sharding is for scale, not security — an unscoped query still scatter-gathers across tenants."*
- *"Don't make Mongo do analytics at 250TB — push rollups to ClickHouse."*
- *"The durable timer reuses my atomic-claim primitive for exactly-once firing."*
- *"My #1 fix is the multi-tenant authz hole — the API trusts a client-supplied `locationId` today."*

---

## 14. Final mindset

- **Lead with the mechanism. Say `locationId` early. Volunteer your gaps. Tie answers to decisions you made.**
- When stuck → the 2 meta-reflexes (§0.5): **queue the work** + **atomic-claim-or-idempotent**.
- You reason to the right answer under pressure — that IS senior. Just land the plane out loud.
- Honesty is on-brand for HighLevel. Use it. Good luck. 🚀
