# 🟢 Vue 3 — Self-Test Quiz (with answers)

Cover the answer, say it out loud, then check. Grounded in *your* frontend (`web/src/`).

> ⚠️ **Read the "How to talk about the frontend honestly" section at the bottom FIRST.** You directed an
> AI to build this frontend — that's legitimate and on-brand for a "Fullstack Builder AI" role. Lead with
> **architectural ownership + fundamentals**, not framework syntax. Don't fake Vue depth; you don't need to.

---

## Reactivity

**Q1. What's the difference between `ref` and `reactive`?**
> Both make data reactive (built on ES6 **Proxy**). `ref(x)` wraps **any** value (primitive or object) in
> a `{ value }` box → access via **`.value`** in JS, and you can **reassign** the whole thing. `reactive(obj)`
> wraps an **object/array** directly → no `.value`, mutate in place, but **reassigning the variable breaks it**.
> Default to `ref`.

**Q2. Why `calls.value` in JS but `{{ calls }}` (no `.value`) in the template?**
> Vue's template compiler **auto-unwraps top-level refs**. Plain JS has no such magic, so you reach into the
> box with `.value`.

**Q3. Is the difference that `ref` has a fixed schema and `reactive` can expand/shrink?**
> **No.** Both can add/remove keys reactively (Proxy tracks it — that's a Vue 3 upgrade over Vue 2). The
> real difference is only: `.value` wrapper + reassignability + what they can wrap.

**Q4. You fetch a fresh list of calls — `ref` or `reactive`? Why?**
> `ref` — because after a fetch you **reassign the whole array** (`calls.value = data`), which `ref` allows
> and `reactive` would break. Rule: **lists → `ref`.**

**Q5. `const u = reactive({name:'x'})`, then `u = {name:'y'}`. Does the UI update? Why?**
> No. Reassigning **swaps `u` from the tracked Proxy to a plain untracked object**; Vue loses its handle.
> Mutate in place instead (`u.name = 'y'`).

**Q6. Why `.value` at all / how does reactivity work?**
> A `ref` is a Proxy-tracked wrapper so Vue can **track reads** (in render/computed/watch) and **trigger
> re-runs on writes**. Vue 2 used `Object.defineProperty` (couldn't see new keys or array index sets); Vue 3
> uses **Proxy** (can).

---

## computed vs watch

**Q7. Why is `avgScore` a `computed` and not a `watch`?**
> `computed` **derives a value** — pure, synchronous, **cached**, auto-tracks deps, returns the value
> directly. With `watch` you'd need a separate `ref` to hold the result and manually recompute + assign
> (imperative, uncached) — a worse hand-rolled `computed`.

**Q8. Why is data-loading a `watch` and not a `computed`?**
> `watch` runs a **side effect** (re-fetch) when something changes. `computed` must be pure/sync — no
> fetches. Rule: **derive a value → `computed`; do a thing → `watch`.**

**Q9. The React mapping?**
> `ref`/`reactive` = `useState` · `computed` = `useMemo` · `watch`/`watchEffect` = `useEffect`.
> (Common trap: "reactive is like useEffect" — **wrong**; reactive is `useState`.)

**Q10. `watch` vs `watchEffect`?**
> `watch(src, cb)` = lazy, explicit deps, gives old+new values. `watchEffect(cb)` = runs immediately +
> re-runs when any dep **read inside it** changes (auto-tracked).

---

## Props & one-way data flow

**Q11. Can a child mutate `props.agentId` directly?**
> **No — props are read-only.** They flow **down** from the parent (the owner). Mutating throws a
> readonly warning. Props auto-update parent→child, never the reverse.

**Q12. Why read-only?**
> **Unidirectional data flow = predictability.** State changes in exactly one place (the owner), so you can
> reason about where any change came from.

**Q13. Child needs to change parent-owned state — what's the pattern?**
> **Emit an event** (`emit('selectCall', id)`); the parent hears it (`@select-call`) and changes **its own**
> state. "Props down, events up." The child never reaches into the parent.

**Q14. What is `v-model` shorthand for?**
> A **prop + an event**: `v-model="x"` = `:modelValue="x" @update:modelValue="x = $event"` (native input:
> `:value` + `@input`). Two-way binding built from one-way primitives.

**Q15. Like/unlike React?**
> **Like:** same philosophy — read-only props, **lift state up**, child calls back, parent owns state
> (`emit` ≈ React callback prop). **Unlike:** Vue events are first-class (`defineEmits`/`@`), props are
> reactive (no re-render call), and Vue has built-in `v-model` two-way sugar.

---

## :key & the view-state machine (your hand-rolled router)

**Q16. What does `:key` do?**
> Two jobs: (1) **list identity** for `v-for` diffing (reuse/reorder nodes correctly — never index keys on
> dynamic lists); (2) **changing it force-remounts** the component (fresh state, replayed mount + transition).

**Q17. How did you do navigation without vue-router?**
> A `ref<View[]>` **stack** is the view-state machine: **push** = drill in, **pop** = back, the array = the
> breadcrumb trail. `currentView = computed(() => stack.at(-1))`. Right-sized for a 3-level drill-down.

**Q18. Why `:key="\`agent-${agentId}\`"` on the view?**
> So switching agent/location **force-remounts** the view → fresh data load, no stale state from the
> previous one, and the enter-transition replays. (Same for `:key="locationId"`.)

**Q19. How do you call a child method from the parent (your Refresh button)?**
> Template **ref** + **`defineExpose`**: child exposes `reload()`, parent holds `viewRef` and calls
> `viewRef.value?.reload?.()`. Refresh re-fetches the active view in place (non-destructive).

---

## State management & structure

**Q20. No Pinia — how is shared state handled?**
> Module-level **`reactive`** + functions = a **composable** (your `agents.ts` agent-name cache). Any view
> that read a name re-renders when the cache fills. Right-sized; Pinia would be overkill here.

**Q21. `<script setup>` vs Options API?**
> `<script setup>` = Composition API with no boilerplate (top-level `ref`s/functions auto-exposed to the
> template). Composition organizes by **concern** + enables reuse via composables; Options API organizes by
> option type (`data`/`methods`/...).

---

## 🏛️ Frontend vs backend — where computation lives (YOUR STRENGTH — lead with this)

**Q22. Why is `avgScore` computed on the frontend, not the backend?**
> The client **already has** the `calls` data (loaded for the list) → averaging it is free, no round-trip;
> it's trivial; and it should react to client-side filters. Trivial-derived-from-data-already-here → frontend.

**Q23. Then why are KPI averages computed on the backend?**
> They aggregate over **all** of an agent's calls (could be thousands — not on the client); the **DB does
> `GROUP BY` efficiently with indexes**; reused across views. Aggregation over data the client doesn't hold → backend.

**Q24. The decision framework?**
> (1) **Trust/authority** → backend (never trust client for secure/persisted/business-critical). (2)
> **Data locality** — compute where the data already is. (3) **Who pays at scale** — offload trivial work
> to the client to save backend CPU. (4) **Interactivity** — values reacting to UI state → frontend. (5)
> **Consistency** — must be identical everywhere → backend (one implementation). (6) **Weight** — heavy/
> unknown-cost → backend or a worker.

**Q25. If backend work is slow (e.g. Opus scoring), how do you keep the UI responsive?**
> **Ack fast, process backend async, push the result over SSE/WebSocket** when ready (loader meanwhile).
> Don't block. (= the real-time-dashboard extension.)

> 🎤 **The line:** *"I push computation to wherever the data already lives and wherever it's cheapest to the
> system. Trivial values derived from data the client already has → frontend; aggregations, secrets, and
> heavy work → backend; slow backend work → ack fast and stream over SSE."*

---

## 🗣️ How to talk about the frontend HONESTLY (read this — it's your strategy)

You directed an AI to build the Vue frontend. **This is legitimate and, for a "Fullstack Builder AI" role,
it's literally the skill being hired.** Do NOT pretend to be a Vue expert — you'll get exposed on syntax and
it'll read worse than the truth. Play it like this:

**If they ask about the frontend / Vue:**
> *"Full transparency — I'm a backend engineer; I don't write Vue day-to-day. The brief said to build with
> AI, so I **directed** the frontend: I made the architectural calls and the AI implemented them. I chose a
> `ref`-stack view-state machine instead of vue-router for a 3-level drill-down, props-down/events-up between
> components, a single typed API client that schema-validates every response so unshaped LLM data can't reach
> the UI, and I drew the frontend/backend compute boundary deliberately — `avgScore` on the client, KPI
> aggregation and Opus scoring on the server. I understand the concepts and the trade-offs; I just lean on AI
> for the framework-specific implementation."*

**Why this is a STRONG answer, not a weak one:**
- It's **honest** — HighLevel grades honesty (your whole functional-vs-mocked ethos).
- It demonstrates the **exact skill the role is named after** — building real software by directing AI.
- It pivots to **architectural ownership** (your real strength) — the *decisions* are yours, which is the
  senior signal regardless of who typed the code.
- It **doesn't overclaim** — so no follow-up can catch you faking depth.

**What you CAN confidently defend** (all decisions, not syntax):
- The view-state-machine choice over a router (and why).
- Props-down/events-up and one-way data flow (the *concept*, which you know).
- The typed-client-as-single-boundary + schema validation (an architecture call).
- The **frontend vs backend computation split** (Q22–Q25) — this is pure system design, your home turf.
- Why no Pinia / no charting lib (right-sizing dependencies).

**What to NOT do:** don't volunteer to live-code Vue from scratch, and if pushed on exact syntax, say
*"I'd reach for the docs or AI for the exact API — the decision I can defend is X."* That's a senior answer.

---

### The 3 things to actually remember (if nothing else)
1. **ref/reactive = useState · computed = useMemo · watch = useEffect.**
2. **Props down, events up; parent owns state; `v-model` = prop + event.**
3. **The frontend/backend compute boundary reasoning (Q24)** — this is your strength, lead with it.
