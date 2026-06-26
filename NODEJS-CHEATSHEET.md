# 🟩 Node.js Core Internals — Cheat Sheet

Their coding round leans on **event-loop internals + async/concurrency**. This is the deep one.
Anchored to *your* server (`server/src/`): Express, **ESM**, `pg.Pool`, the webhook fire-and-forget
async IIFE, Claude SDK calls.

> **The one framing:** "Node runs my JS on a **single thread** (one event loop). I/O is offloaded
> (libuv thread pool / kernel), so it's **concurrent, not parallel** for my code. That makes it great
> at I/O-bound work and bad at CPU-bound work — and parallelism comes from multiple pods / worker_threads,
> not my request handler."

---

## 1. Concurrency vs parallelism in Node (lead with this)

- **Concurrency** = many tasks *in progress*, interleaved (structure). **Parallelism** = many tasks
  *executing at the same instant* (multi-core).
- **Node = concurrency, single-threaded JS.** One thread runs your callbacks one at a time. While you
  `await` I/O, the thread is free to run other callbacks.
- **The I/O actually happens off-thread:** sockets via the OS kernel (epoll/kqueue); files/DNS/crypto
  via **libuv's thread pool** (default **4 threads**, `UV_THREADPOOL_SIZE` to raise).
- **True parallelism comes from:** multiple **processes** (cluster / N pods), **worker_threads** (CPU),
  or **external systems** (DB, queue, LLM API).
- ⚠️ **Single-threaded ≠ race-free** — see §5 (the await-gap).

> 🎤 *"'Handle 10k webhooks' isn't a threading problem — it's I/O-scheduling + back-pressure. The
> parallelism has to come from more pods or a queue, not my handler."*

---

## 2. The event loop — phases (libuv)

Each loop iteration ("tick") runs these phases **in order**:

```
   ┌─────────────────────────────┐
┌─▶│ timers          │ setTimeout / setInterval callbacks whose time elapsed
│  ├─────────────────────────────┤
│  │ pending callbacks│ deferred I/O callbacks (e.g. some TCP errors)
│  ├─────────────────────────────┤
│  │ idle, prepare    │ internal
│  ├─────────────────────────────┤
│  │ poll            │ ← retrieve new I/O events; execute I/O callbacks; may BLOCK here
│  ├─────────────────────────────┤
│  │ check           │ setImmediate callbacks
│  ├─────────────────────────────┤
│  │ close callbacks  │ 'close' events (socket.on('close'))
└──┴─────────────────────────────┘
```

> 🔑 **Microtasks (Promises + `process.nextTick`) are NOT a phase** — they drain **between every phase
> and after every single callback**. (See §3.)

---

## 3. Microtasks vs macrotasks — the #1 tested concept

- **Macrotasks** (a.k.a. "tasks"): `setTimeout`, `setInterval`, `setImmediate`, I/O callbacks. One per
  loop-phase turn.
- **Microtasks:** `Promise.then/catch/finally`, `await` continuations, `queueMicrotask`,
  `process.nextTick`. **Drained FULLY before the next macrotask.**
- **Two microtask queues, with priority:**
  1. **`process.nextTick` queue** — drains **first**.
  2. **Promise microtask queue** — drains **second**.

> 🔑 **Two rules to memorize:**
> 1. **Microtasks beat macrotasks** (all microtasks drain before any timer/immediate/IO callback).
> 2. **`nextTick` beats Promises** (nextTick queue empties before the Promise queue).

⚠️ **`process.nextTick` starvation:** a `nextTick` that schedules another `nextTick` can **starve the
event loop** (it never reaches I/O). Prefer `setImmediate` / `queueMicrotask` unless you specifically
need pre-Promise ordering.

---

## 4. `setTimeout(fn,0)` vs `setImmediate` (classic question)

- **At the top level:** order is **non-deterministic** (depends on whether the ~1ms timer threshold
  elapsed before the loop reaches the timers phase).
- **Inside an I/O callback:** **`setImmediate` ALWAYS fires first.** You're in the `poll` phase; `check`
  (setImmediate) comes immediately after, before the loop wraps back to `timers`.

```js
const fs = require('fs');
fs.readFile(__filename, () => {        // we're now in an I/O (poll) callback
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));   // ← always prints FIRST here
});
```

---

## 5. async/await internals + the await-gap (ties to your concurrency work)

- **An `async` function runs SYNCHRONOUSLY up to its first `await`.** Only code *after* `await` is
  deferred (scheduled as a microtask continuation).
- `await x` ≈ `Promise.resolve(x).then(continuation)` — the rest of the function becomes a microtask.
- 🔑 **The await-gap:** across an `await`, the event loop runs **other** code. That's where
  **check-then-act races** live — even though Node is single-threaded.

```js
// YOUR webhook bug, in miniature:
if (!(await analysisRepo.has(callId))) {   // ← yields here; a duplicate webhook's handler runs in the gap
  await scoreCall(...)                       // → both pass has()===false → both score (double-spend)
}
```
**Fix isn't a lock — it's the atomic claim / idempotent write:** `INSERT … ON CONFLICT` /
`findOneAndUpdate({status:'pending'})`. *No amount of locking closes the gap perfectly; idempotency
makes the double-run harmless.* (See §13.)

---

## 6. 🧪 Output-prediction drills (with answers)

**Drill A:**
```js
console.log('1');
setTimeout(() => console.log('2'), 0);
setImmediate(() => console.log('3'));
Promise.resolve().then(() => console.log('4'));
process.nextTick(() => console.log('5'));
console.log('6');
```
**→ `1, 6, 5, 4, 2, 3`**  (sync `1,6`; microtasks nextTick `5` then Promise `4`; macrotasks `2`/`3`
non-deterministic at top level).

**Drill B (await):**
```js
async function run(){ console.log('A'); await Promise.resolve(); console.log('B'); }
console.log('C'); run(); setTimeout(()=>console.log('D'),0);
Promise.resolve().then(()=>console.log('E')); console.log('F');
```
**→ `C, A, F, B, E, D`**  (`A` is sync — async runs until first await; then sync `F`; microtasks `B`
then `E`; macrotask `D`).

> Reusable rule: **sync → drain microtasks (nextTick then Promise) → one macrotask → drain microtasks → …**

---

## 7. Blocking the event loop (CPU-bound is the enemy)

- A long synchronous loop / big `JSON.parse` / sync crypto / `fs.*Sync` **blocks the one thread** —
  *nothing else runs*, all requests stall.
- **Fixes:** break work into chunks (`setImmediate` between batches); offload to **`worker_threads`**;
  push to an external service; stream instead of buffering.
- **In your app:** Opus scoring is ~20s but it's **I/O (network) await**, so it *doesn't* block the loop
  — the thread is free during the await. The real issue there was **durability/back-pressure**, not
  blocking. (Good distinction to make: I/O-wait ≠ CPU-block.)

---

## 8. True parallelism: worker_threads / cluster / child_process

| Tool | Use for |
|---|---|
| **`worker_threads`** | CPU-bound work (parsing, crypto, image/ML) — shares memory via `SharedArrayBuffer` |
| **`cluster`** | fork N processes sharing a port → use all cores for an HTTP server (1 process/core) |
| **`child_process`** (`spawn`/`fork`/`exec`) | run separate programs / scripts |
| **PM2 / N pods (k8s)** | the production version of "more processes" — horizontal scale |

> "For HighLevel scale I scale **horizontally** (pods behind a load balancer), and reach for
> `worker_threads` only if I had genuine CPU-bound work in-process."

---

## 9. Promises — combinators (know the differences cold)

| Combinator | Resolves when | Rejects when | Use |
|---|---|---|---|
| `Promise.all` | **all** fulfill (array of results) | **any** rejects (fail-fast) | parallel fetches that all must succeed (you use it: analyses+KPIs+leads) |
| `Promise.allSettled` | **all** settle | never | when you want every result incl. failures |
| `Promise.race` | **first** settles (fulfill or reject) | first rejects | timeouts (race vs a timer) |
| `Promise.any` | **first** fulfills | all reject (`AggregateError`) | first success wins |

```js
// Parallel (your pattern) — all fire at once:
const [a,b,c] = await Promise.all([fetchAnalyses(...), fetchKpis(...), fetchLeads(...)]);
// Sequential (SLOWER — only when b depends on a):
const a = await fetchA(); const b = await fetchB(a);
// Bounded concurrency for a big list (don't fire 10k at once): p-limit / chunked loop.
```

⚠️ **`Promise.all` is fail-fast** — one rejection rejects the whole thing (others keep running but
their results are lost). Use `allSettled` if you need partial success. (Your `fetchLeads(...).catch(()=>[])`
is the right move — isolate a non-critical failure so it doesn't sink the batch.)

---

## 10. Error handling

- **Sync:** `try/catch`.
- **async/await:** `try/catch` works (the await throws). Wrap awaits that can reject.
- **Promises:** `.catch()` — an unhandled rejection → `process.on('unhandledRejection')` (crash in
  modern Node).
- **Error-first callbacks** (old style): `(err, data) => { if (err) ... }`.
- **EventEmitter:** an `'error'` event with no listener **throws** → always `emitter.on('error', …)`.
- **Process-level safety nets:**
  - `process.on('uncaughtException', …)` — last resort; **log + exit**, don't resume (state may be corrupt).
  - `process.on('unhandledRejection', …)` — catch stray promise rejections.
- ⚠️ **In your webhook:** the fire-and-forget IIFE has its own `try/catch`, but if it threw *outside*
  that, it'd be an unhandled rejection. Detached async work must always self-contain its error handling
  (you do) — and ideally live in a queue with retries (the real fix).

---

## 11. Streams & backpressure (likely "how do you handle large data")

- **Streams** process data in chunks instead of buffering it all in memory: `Readable`, `Writable`,
  `Duplex`, `Transform`.
- **Backpressure:** `writable.write()` returns `false` when the buffer's full → pause the readable until
  `'drain'`. `pipe()` / `pipeline()` handle this for you.
  ```js
  const { pipeline } = require('node:stream/promises');
  await pipeline(readStream, transformStream, writeStream);  // handles backpressure + errors
  ```
- Use for: large files, HTTP proxying, CSV/log processing, transcript ingestion at scale.

---

## 12. Modules — CommonJS vs ESM (your server is ESM)

| | CommonJS | **ESM (yours)** |
|---|---|---|
| import | `require()` | `import` |
| export | `module.exports` | `export` |
| loading | synchronous | async, static analysis (tree-shakeable) |
| file ext in imports | optional | **required** (`./x.js`) ← your code does this |
| top-level await | ❌ | ✅ |
| enabled by | default | `"type":"module"` in package.json |

> Your imports use `.js` extensions on TS files (`'../config.js'`) because ESM requires the extension and
> TS compiles `.ts`→`.js` — a common ESM+TS gotcha worth being able to explain.

---

## 13. Idempotency & concurrency patterns (the "internals" half they drill)

- **At-least-once + idempotent effects = exactly-once outcome.** You can't get exactly-once *execution*
  in a distributed system.
- **Atomic claim** (no double-process): `INSERT … ON CONFLICT DO NOTHING RETURNING` /
  `findOneAndUpdate({_id, status:'pending'})` — one winner, others bail.
- **Idempotency key** (e.g. `/charge` retries): **client-generated**, stable across retries, backed by a
  **unique constraint**; on a duplicate **replay the stored result** (don't re-run, don't error).
- **Lease + heartbeat:** a lock needs a TTL (else a crash deadlocks it); heartbeat it so *slow ≠ dead*.
- 🔑 **The lock is a cost optimization; the idempotent write is the correctness guarantee.**
- **The three idempotency-key parts people miss:** (1) client-generated, (2) replay the stored result,
  (3) unique constraint = the atomic claim.

---

## 14. Process & runtime essentials

- `process.env.X` — config (you load `.env` via dotenv).
- `process.argv` — CLI args (your `tsx scripts/*.mts`).
- `process.nextTick(fn)` — highest-priority microtask.
- `process.exit(code)` — force exit (avoid mid-request; prefer graceful shutdown).
- **Signals / graceful shutdown** (important at scale): on `SIGTERM` (k8s rollout) → stop accepting new
  requests, drain in-flight, close the DB pool, then exit:
  ```js
  process.on('SIGTERM', async () => { server.close(); await pool.end(); process.exit(0); });
  ```
  > This is the real-world version of "a pod gets redeployed mid-scoring" — graceful shutdown + a durable
  > queue is how you don't lose work.

---

## 15. Memory & GC (one-liners if asked)

- V8 heap, generational GC (young/old). Default old-space cap ~1.5–2GB (raise with
  `--max-old-space-size`).
- **Leaks come from:** uncleared timers/intervals, growing module-level caches/Maps, lingering event
  listeners, closures holding big objects.
- ⚠️ Your `agents.ts` / recommendation caches are module-level — fine, but unbounded caches are the
  classic leak; add TTL/size limits at scale. Your `toastTimer` should be cleared on unmount.
- Inspect: `--inspect` + Chrome DevTools, heap snapshots, `process.memoryUsage()`.

---

## 16. Likely Node interview Qs (one-line answers)

- **Is Node single-threaded?** JS execution yes (one event loop); I/O is offloaded to libuv's thread
  pool / the kernel → concurrent, not parallel.
- **Event loop phases?** timers → pending → poll → check → close; microtasks drain between each.
- **Micro vs macro order?** all microtasks before next macro; nextTick before Promises.
- **setImmediate vs setTimeout(0)?** non-deterministic at top level; setImmediate first inside I/O callbacks.
- **Why is Node bad at CPU work?** it blocks the single thread → use worker_threads / offload.
- **How to use all cores?** cluster / multiple pods (worker_threads for CPU).
- **Promise.all vs allSettled?** all = fail-fast; allSettled = always resolves with every outcome.
- **uncaughtException — resume?** No — log and exit; state may be corrupt.
- **Backpressure?** `write()` returns false → pause until `'drain'`; `pipeline()` handles it.
- **CommonJS vs ESM?** require/sync vs import/async-static-tree-shakeable; ESM needs file extensions + top-level await.
- **Race conditions in single-threaded Node?** yes — across `await` points (check-then-act); fix with atomic ops / idempotency.

---

## 17. 🎤 One-liners (drop verbatim)

- *"Node is concurrent, not parallel — single-threaded JS, I/O offloaded to libuv."*
- *"Microtasks beat macrotasks; nextTick beats Promises."*
- *"async runs synchronously until the first await; only the continuation is deferred."*
- *"Single-threaded doesn't mean race-free — the await-gap lets other handlers interleave."*
- *"My ~20s Opus call doesn't block the loop — it's I/O-wait, not CPU. The real issue was durability, not blocking."*
- *"Scale Node horizontally — more pods — and offload CPU to worker_threads; keep the event loop free."*
- *"Graceful shutdown on SIGTERM + a durable queue is how I don't lose in-flight work on a redeploy."*
- *"The lock is a cost optimization; the idempotent write is the correctness guarantee."*
