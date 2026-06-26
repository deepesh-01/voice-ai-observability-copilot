# 🐘↔🍃 Postgres → Mongo — Side-by-Side Cheat Sheet

Read it as: **"here's the Postgres way I know, here's the Mongo equivalent."** Your strength is PG;
this closes the Mongo gap. Anchored to *your* schema (`raw_call`, `call_analysis`, `call_kpi`,
`call_lead`, `agent_recommendations`, `oauth_tokens`).

> **The one mental shift:** PG = normalize + JOIN to assemble. Mongo = **embed** what's read together,
> **reference** what's large/unbounded/shared. Then: shard by tenant, push analytics to ClickHouse.

---

## 0. Vocabulary

| Postgres | Mongo |
|---|---|
| database | database |
| table | **collection** |
| row | **document** (can nest objects/arrays) |
| column | **field** |
| primary key | `_id` (unique, indexed, required) |
| foreign key | ❌ none — embed, or reference + app-side join |
| `JOIN` | `$lookup` (works, **discouraged at scale**) |
| SQL | aggregation pipeline / find filters |
| sequence/serial | `ObjectId` (default `_id`) |
| `NULL` | missing field (or explicit `null`) |

---

## 1. Create a record (INSERT)

```sql
-- Postgres
INSERT INTO call_analysis (call_id, location_id, overall_score, analysis)
VALUES ($1,$2,$3,$4);
```
```js
// Mongo
db.calls.insertOne({ _id: callId, locationId, overallScore, analysis: {...} });
```

---

## 2. Read / filter (SELECT … WHERE)

```sql
SELECT * FROM call_analysis WHERE location_id = $1 AND agent_id = $2;
```
```js
db.calls.find({ locationId, agentId });
// projection (pick fields) = SELECT col1, col2
db.calls.find({ locationId }, { overallScore: 1, summary: 1, _id: 0 });
```

| SQL | Mongo |
|---|---|
| `=` | `{f: v}` |
| `!=` | `{f: {$ne: v}}` |
| `>` `>=` `<` `<=` | `$gt $gte $lt $lte` |
| `IN (...)` | `{f: {$in: [...]}}` |
| `AND` | `{a:1, b:2}` (implicit) |
| `OR` | `{$or: [{a:1},{b:2}]}` |
| `LIKE 'x%'` | `{f: /^x/}` (regex) |
| `IS NULL` | `{f: {$exists:false}}` or `{f:null}` |
| `ORDER BY x DESC` | `.sort({x:-1})` |
| `LIMIT n` | `.limit(n)` |

---

## 3. Update

```sql
UPDATE call_analysis SET overall_score = $2, scored_at = now() WHERE call_id = $1;
```
```js
db.calls.updateOne({ _id: callId },
  { $set: { overallScore: 89, scoredAt: new Date() } });
// operators: $set $inc $push $pull $addToSet $unset
db.calls.updateOne({ _id: id }, { $inc: { retries: 1 } });   // = SET retries = retries + 1
```

---

## 4. Delete

```sql
DELETE FROM raw_call WHERE call_id = $1;   -- cascades to derived tables (FK ON DELETE CASCADE)
```
```js
db.calls.deleteOne({ _id: callId });       // if embedded, derived data goes with it (no cascade needed)
```
> 🔑 PG cascade is automatic via FK. Mongo has no FK — **embedding makes cascade free** (one doc),
> or you delete referenced docs in app code / a background job.

---

## 5. Upsert (your `ON CONFLICT` pattern)

```sql
INSERT INTO oauth_tokens (install_key, access_token, ...) VALUES ($1,$2,...)
ON CONFLICT (install_key) DO UPDATE SET access_token = EXCLUDED.access_token;
```
```js
db.tokens.updateOne({ _id: installKey },
  { $set: { accessToken } }, { upsert: true });
```

---

## 6. The atomic claim (your dedup / concurrency — CRITICAL)

```sql
-- Postgres: insert-as-claim (your callId PK)
INSERT INTO raw_call (call_id, ...) VALUES ($1, ...)
ON CONFLICT (call_id) DO NOTHING RETURNING call_id;   -- row back = I won

-- Postgres: status claim + lease
UPDATE raw_call SET status='scoring', claimed_at=now()
WHERE call_id=$1 AND (status='pending' OR claimed_at < now()-interval '2 min')
RETURNING call_id;
```
```js
// Mongo: insert-as-claim (duplicate _id throws / is ignored)
try { await db.calls.insertOne({ _id: callId, status:'pending', ... }); /* I won */ }
catch (e) { if (e.code === 11000) return; /* duplicate key — someone else has it */ }

// Mongo: status claim + lease (THE idiom — say this verbatim)
const claimed = await db.calls.findOneAndUpdate(
  { _id: callId, $or: [{status:'pending'}, {claimedAt: {$lt: leaseExpiry}}] },
  { $set: { status:'scoring', claimedAt: new Date() } },
  { returnDocument: 'after' });
if (!claimed) return;   // lost the claim — bail
```
> 🔑 **Both guarantee one winner** because the engine serializes concurrent writers to the same
> key/document. Unique `_id` (or PK) = atomic dedup; `findOneAndUpdate` / `UPDATE…RETURNING` = atomic
> claim. **The lock is a cost optimization; the idempotent write (unique `_id`) is correctness.**

---

## 7. Aggregation (GROUP BY) — your KPI averages

```sql
-- Postgres: flat call_kpi table → trivial
SELECT agent_id, kpi_key, ROUND(AVG(score)) AS avg, COUNT(*) AS calls
FROM call_kpi WHERE location_id = $1
GROUP BY agent_id, kpi_key;
```
```js
// Mongo: if kpiScores embedded as an array → $unwind first
db.calls.aggregate([
  { $match: { locationId } },                              // = WHERE
  { $unwind: "$analysis.kpiScores" },                     // unfold the array
  { $group: { _id: { agent:"$agentId", kpi:"$analysis.kpiScores.key" },
              avg: { $avg: "$analysis.kpiScores.score" },
              calls: { $sum: 1 } } }                       // = GROUP BY + AVG/COUNT
]);
```
Pipeline stages = SQL clauses: `$match`=WHERE, `$group`=GROUP BY, `$sort`=ORDER BY, `$limit`=LIMIT,
`$project`=SELECT cols, `$lookup`=JOIN, `$unwind`=unfold array.

> 🔑 **Honest senior line:** "`$unwind`+`$group` works, but at 250 TB I don't make Mongo do analytics —
> KPI rollups go to **ClickHouse** (columnar, built for billions of rows). Knowing when *not* to use
> the aggregation pipeline is the point."

---

## 8. Joins

```sql
SELECT ca.*, rc.duration_sec, rc.call_at
FROM call_analysis ca JOIN raw_call rc USING (call_id) WHERE ca.call_id = $1;
```
```js
// Option A (preferred): EMBED so there's no join — one document has it all
db.calls.findOne({ _id: callId });   // analysis + duration + callAt all in one doc

// Option B: $lookup (avoid on hot paths / across shards)
db.analyses.aggregate([
  { $match: { _id: callId } },
  { $lookup: { from:"rawCalls", localField:"_id", foreignField:"_id", as:"raw" } }
]);
```
> 🔑 In Mongo you **design away the join by embedding**. `$lookup` exists but is the thing you avoid at scale.

---

## 9. Schema & data model — your call, normalized vs embedded

**Postgres (your real design):** 4 tables, FK'd by `call_id`:
```
raw_call (PK call_id) ──1:1──▶ call_analysis ──1:N──▶ call_kpi
                      └─1:1──▶ call_lead
```
**Mongo (the port):** ~one document per call:
```js
{
  _id: callId,                 // = your PK + dedup key
  locationId, agentId, callAt, durationSec,
  status: "scored",            // claim/lease field
  analysis: {                  // ← embed call_analysis
    overallScore, summary,
    kpiScores: [{key, score}], // ← embed call_kpi (was a table)
    deviations: [...], useActions: [...]
  },
  lead: { bookingStatus, missedOpportunity, humanActionNeeded, source },  // ← embed call_lead
  rawPayload: {...}            // ← maybe SEPARATE collection if large (16MB cap)
}
```
**Embed vs reference rule:** embed if read-together + bounded + belongs-to-parent; reference if large,
unbounded, or queried independently. **Hard limit: 16 MB/document.**

> 🔑 **Win to volunteer:** "Embedding `kpiScores` makes the write a **single atomic document** — the
> Postgres transaction wrapping `call_analysis` + `call_kpi` *disappears*. Mongo is simpler here."

---

## 10. Constraints & validation

| Postgres | Mongo |
|---|---|
| `NOT NULL`, `CHECK`, types | **JSON Schema validation** on the collection (optional) |
| `UNIQUE` | unique index (`createIndex({f:1},{unique:true})`) |
| `FOREIGN KEY` | ❌ none — enforce in app / embed |
| enum / `CHECK (x IN ...)` | schema `enum`, or validate in app |
| schema enforced by default | **schemaless by default** — flexible, but YOU own consistency |

> Mongo's flexibility cuts both ways: adding a field is free (great for schema evolution), but nothing
> stops malformed docs unless you add validation. Version docs (`schemaVersion`) for safety.

---

## 11. Schema evolution (add a 7th KPI)

- **PG:** `ALTER TABLE` / new rows in `call_kpi`. Old calls have no row for the new KPI → `AVG` per KPI
  is independent → no corruption. (You ship shape changes as one-shot scripts, no ALTER on boot.)
- **Mongo:** schemaless — old docs just **lack the field** (not null, no error). `$avg`/`$group`
  **ignore** docs missing it. Add to the KPI catalog; new calls score 7; optional async backfill.
- **Shared subtlety:** the overall score mixes 6-KPI (old) and 7-KPI (new) calls → version the
  analysis doc (`schemaVersion`/`kpiSet`) so they stay comparable.

---

## 12. Indexing

```sql
CREATE INDEX idx_call_lead_agent ON call_lead (agent_id);
CREATE INDEX ... ON call_lead (location_id) WHERE missed_opportunity;  -- partial
```
```js
db.calls.createIndex({ agentId: 1 });
db.calls.createIndex({ locationId: 1, callAt: -1 });      // compound (order matters)
db.calls.createIndex({ locationId: 1 },                   // PARTIAL — direct parity!
  { partialFilterExpression: { "lead.missedOpportunity": true } });
db.tokens.createIndex({ field: 1 }, { unique: true });
```
- Compound index rule (both DBs): **equality fields first, then range/sort** (ESR: Equality, Sort, Range).
- Mongo: `db.coll.explain("executionStats")` ≈ PG `EXPLAIN ANALYZE`. Watch for `COLLSCAN` (= Seq Scan).
- ✅ **Partial indexes exist in both** — your "only index `missedOpportunity=true` rows" ports exactly.

---

## 13. Transactions

```sql
-- Postgres: first-class, cheap
BEGIN; INSERT call_analysis ...; INSERT call_kpi ...; COMMIT;
```
```js
// Mongo: multi-doc txns exist (need a replica set) but are HEAVIER
const s = client.startSession();
await s.withTransaction(async () => { await db.analyses.insertOne(...,{session:s}); ... });
```
> 🔑 The idiomatic Mongo move is to **avoid the txn by embedding** → one atomic document write. Reach
> for multi-doc transactions only when data genuinely can't be co-located.

---

## 14. Pagination

```sql
-- Postgres: keyset (cursor) pagination — NOT OFFSET at scale
SELECT * FROM call_analysis WHERE location_id=$1 AND call_at < $2 ORDER BY call_at DESC LIMIT 50;
```
```js
// Mongo: range/cursor on _id or callAt — NEVER skip() at scale (O(n) scan)
db.calls.find({ locationId, callAt: { $lt: cursor } }).sort({ callAt: -1 }).limit(50);
```
> 🔑 Both: **avoid OFFSET/`skip`** for deep pages — they scan everything skipped. Use a cursor on an
> indexed, monotonic column (`call_at`/`_id`).

---

## 15. Multi-tenancy & scale (THE HighLevel question)

| Concern | Postgres | Mongo |
|---|---|---|
| Tenant column | `location_id` on every table (you do) | `locationId` on every document |
| Horizontal scale | table **partitioning** / Citus | **sharding** |
| Shard/partition key | partition by `location_id` | **shard key = `locationId`** (compound `{locationId, callAt}`) |
| Row-level isolation | **RLS** (native, DB enforces) | ❌ no RLS — enforce in a shared data-access layer (auto-inject filter) |

**The 3-layer multi-tenant answer (same in both):**
1. **Tenant from the verified token**, never the client request.
2. **Every query scoped by `locationId`** — auto-injected in a shared data layer so a dev can't forget.
3. **Physical isolation** via shard/partition by tenant.

> ⚠️ **Sharp nuance (impress here):** sharding by `locationId` is for **scale, not security** — a query
> missing the filter still **scatter-gathers across all shards** and can leak. Sharding stops *slow*
> queries; the **enforced filter** stops *leaky* ones. RLS (PG) is the one feature that makes it
> structurally impossible at the DB; Mongo has no equivalent, so the enforced data-access layer is your RLS.

---

## 16. Real-time / change capture

| Postgres | Mongo |
|---|---|
| `LISTEN`/`NOTIFY`, logical replication, WAL/Debezium | **Change Streams** (tail the oplog) |
| poll a `received_at` cursor (your current approach) | change stream + **resume token** (at-least-once) |

> "I'd replace my poll loop with a **change stream** — react to inserts the instant they happen, with a
> resume token for recovery; it also feeds the real-time dashboard." (PG equivalent: logical decoding /
> Debezium → Kafka.)

---

## 17. When to pick which (say this if asked)

- **Postgres:** relational integrity, complex joins/transactions, strong analytics via SQL, RLS, you
  know the schema. *Your choice — because the core query is KPI aggregation (`GROUP BY`).*
- **Mongo:** flexible/evolving schema, document-shaped data read as a unit, massive horizontal write
  scale, polyglot at scale. *HighLevel's choice — 250TB, 250k writes/sec, schema flux across 250 services.*
- **Honest framing:** "I'd default to Postgres for its integrity + SQL analytics; I'd choose Mongo when
  the data is document-shaped, the schema evolves fast, and I need to shard horizontally — which is
  exactly HighLevel's world. The *questions* don't change: shard by tenant, atomic claim, embed by read
  locality, analytics to ClickHouse."

---

## 18. 🎤 Mongo one-liners (drop verbatim)

- *"`_id` = my `callId` — primary key AND dedup key carry over unchanged."*
- *"Embed what's read together and bounded; reference what's large or unbounded; 16MB is the ceiling."*
- *"`findOneAndUpdate({_id, status:'pending'})` is the atomic claim — same guarantee as `UPDATE…WHERE…RETURNING`."*
- *"Embedding kills the transaction — one atomic document write instead of `BEGIN/COMMIT`."*
- *"Shard key = `locationId` to co-locate a tenant and avoid scatter-gather; hashed suffix if a whale tenant hot-spots."*
- *"Sharding is for scale, not security — an unscoped query still scatter-gathers across tenants."*
- *"Don't make Mongo do analytics at 250TB — rollups to ClickHouse."*
- *"No RLS in Mongo — I enforce the tenant filter in a shared data-access layer so it can't be forgotten."*
- *"Change streams replace polling; resume token = at-least-once recovery."*
- *"Cursor-paginate on `_id`/`callAt`; never `skip()` — it scans."*
