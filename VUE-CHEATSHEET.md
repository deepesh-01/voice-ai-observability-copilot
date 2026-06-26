# 🟢 Vue 3 Core Concepts — Cheat Sheet

Grounded in *your* frontend (`web/src/`): Vue 3 + `<script setup>` + TS, Composition API, **no router,
no Pinia** (hand-rolled state). Examples cite your real files so you can defend them.

> **Your stack in one line:** "A dependency-light Vue 3 SPA — Composition API with `<script setup>`,
> a hand-rolled view-state machine (a `ref` stack) instead of a router, props-down/events-up between
> components, and a typed API client as the single backend boundary. Vue is the only runtime dep."

---

## 1. Reactivity — `ref` vs `reactive` (the #1 thing they probe)

| | `ref(x)` | `reactive(obj)` |
|---|---|---|
| Wraps | any value (primitive or object) | objects/arrays only |
| Access | **`.value`** in JS (auto-unwrapped in template) | direct (`obj.x`) |
| Reassign whole thing | ✅ `r.value = newVal` | ❌ replacing the variable breaks reactivity |
| Your usage | `viewStack`, `installs`, `calls`, `loadingMain` | `namesByLocation` (agent cache) |

```ts
const calls = ref<CallSummary[]>([]);   // calls.value in JS; {{ calls }} in template
calls.value = callData;                  // ✅ reassign the whole array — stays reactive

const namesByLocation = reactive<Record<string, Record<string,string>>>({}); // agents.ts
namesByLocation[locationId] = {...};     // ✅ mutate keys — stays reactive
```

> 🔑 **Default to `ref`.** It works for everything and you can reassign it. Reach for `reactive` only
> for a long-lived object you mutate in place (like your agent cache).

**Why `.value`?** Vue 3 reactivity is built on **ES6 Proxies**. A `ref` is an object with a `.value`
getter/setter so Vue can *track reads* (in render/computed) and *trigger updates* on writes. Primitives
can't be proxied directly — hence the wrapper. (Vue 2 used `Object.defineProperty`, which couldn't
detect new properties or array index sets — Vue 3's Proxy fixes both.)

**Reactivity gotchas (say these, they're classic interview traps):**
- ❌ **Destructuring loses reactivity:** `const { agentId } = props` → `agentId` is a plain snapshot.
  Use `toRefs(props)` or reference `props.agentId` directly (you do: `props.agentId`).
- ❌ **Replacing a `reactive` variable** (`namesByLocation = {}`) breaks the link — mutate keys instead.
- ✅ Reassigning a `ref` array (`calls.value = [...]`) is fine and the idiomatic way to update lists.

---

## 2. `computed` — derived, **cached** state

Recomputes **only when its reactive deps change**; otherwise returns the cached value. Use for any
value *derived* from state — never duplicate it into a `ref`.

```ts
// AgentView.vue — derived, auto-updates when calls/filters change
const avgScore = computed(() =>
  calls.value.length
    ? Math.round(calls.value.reduce((a,c)=>a+c.overallScore,0)/calls.value.length)
    : null);

const filteredCalls = computed(() =>           // recomputes only when calls or filters change
  (!filterMissed.value && !filterHuman.value)
    ? calls.value
    : calls.value.filter(c => /* ... */));
```

> **`computed` vs `method`:** a method re-runs on *every* render; a `computed` is **cached** until a
> dep changes. **`computed` vs `watch`:** computed = derive a *value* (pure, sync); watch = run a
> *side effect* (fetch, log) when something changes.

---

## 3. `watch` / `watchEffect`

```ts
// App.vue — re-run when location changes (reset drill-down)
watch(selectedLocation, (loc) => {
  viewStack.value = [{ kind: 'overview' }];
  if (loc) void ensureAgents(loc);
});

// AgentView.vue — watch multiple sources (array form)
watch(() => [props.locationId, props.agentId], () => { loadMain(); loadRecommendations(); });
```

- `watch(source, cb)` — lazy (fires on change), gives **old + new** values, explicit deps.
- `watchEffect(cb)` — runs **immediately** + re-runs when any dep *read inside it* changes (auto-tracked).
- Options: `{ immediate: true }` (run once on setup), `{ deep: true }` (watch nested object mutations).
- ⚠️ Watching a `props`/getter needs the **function form**: `watch(() => props.x, …)`.

---

## 4. `<script setup>` + Composition API vs Options API

- **`<script setup>`** (what you use): everything at top level *is* the component — `ref`s, functions,
  imports are auto-exposed to the template. No `return {}`, no `export default`. Less boilerplate.
- **Composition API** = logic via `ref`/`computed`/`watch` + lifecycle hooks; **reusable** via
  **composables** (`useXxx()` functions). Your `agents.ts` is essentially a composable (shared reactive
  state + functions).
- **Options API** (Vue 2 style) = `data() {}`, `methods: {}`, `computed: {}`, `watch: {}` — organized by
  *option type*. Composition organizes by *feature/concern* → better for large components + reuse.

> **Why Composition for this app:** "logic colocated by concern, and the shared agent-name cache is a
> plain module (`agents.ts`) with `reactive` state — a composable — reusable across every view without a
> store library."

---

## 5. Component communication — **props down, events up**

```ts
// AgentView.vue
const props = defineProps<{ locationId: string; agentId: string }>();   // in
const emit  = defineEmits<{ back: []; selectCall: [callId: string] }>(); // out
// ...
@click="emit('selectCall', call.callId)"
```
```vue
<!-- App.vue (parent) wires them -->
<AgentView :location-id="locationId" :agent-id="currentView.agentId"
           @back="backFromAgent" @select-call="selectCall" />
```

- **Props are one-way + read-only** — never mutate a prop; emit an event and let the parent change it.
  (One-way data flow = predictable; the parent owns the state.)
- **`v-model`** = sugar for a prop + an event (`:modelValue` + `@update:modelValue`). Your location
  `<select v-model="selectedLocation">` is two-way over local state.
- **Other channels:** `provide`/`inject` (pass deep down a tree without prop-drilling — you don't use
  it, but know it); a **store (Pinia)** for app-wide state (you hand-rolled this with module-level
  `reactive` instead — a legitimate call for a small app).
- **`defineExpose`** — expose methods to a **parent via a template ref**. You use it so the header
  Refresh can call the active view's `reload()`:
  ```ts
  defineExpose({ reload: () => loadMain(true) });   // AgentView
  // App.vue: const viewRef = ref(); ... viewRef.value?.reload?.()
  ```

---

## 6. Template directives (quick ref)

| Directive | What | Your usage |
|---|---|---|
| `v-if` / `v-else-if` / `v-else` | conditional **render** (adds/removes from DOM) | the view-state machine in `App.vue` |
| `v-show` | toggles **`display`** (stays in DOM) | use for frequent toggles (cheaper than v-if) |
| `v-for` + **`:key`** | list render — **always key it** | `v-for="call in filteredCalls" :key="call.callId"` |
| `v-bind` / `:` | bind attr/prop | `:location-id`, `:class`, `:style` |
| `v-on` / `@` | event | `@click`, `@select-call` |
| `:class` / `:style` | dynamic classes/styles | `:class="scoreClass(avgScore)"`, `:class="{ 'crumb--active': … }"` |

**`v-if` vs `v-show`:** `v-if` = lazy, real mount/unmount (use when rarely toggled or expensive);
`v-show` = always rendered, just CSS-hidden (use for frequent toggles). ⚠️ **Don't put `v-if` and
`v-for` on the same element** — wrap or filter via a `computed` (you do: `filteredCalls`).

---

## 7. `:key` — the concept they love to ask

Two jobs:
1. **List diffing identity** — tells Vue which `v-for` item is which, so it reuses/reorders DOM nodes
   correctly instead of patching by index (index keys cause bugs when the list reorders/filters).
2. **Force remount** — *changing* a `:key` destroys + recreates the component (fresh state, replays
   mount + transitions). You use this deliberately:
   ```vue
   <AgentView :key="`agent-${currentView.agentId}`" .../>   <!-- switch agent → fresh view -->
   <OverviewView :key="locationId" .../>                     <!-- switch location → reload -->
   ```
   > "Changing the `:key` is how I force a clean reload on navigation — new agent/location remounts the
   > view, so there's no stale data from the previous one and the `view-enter` transition replays."

---

## 8. Lifecycle hooks

```ts
onMounted(loadInstalls);        // App.vue — fetch after first render (DOM ready)
onMounted(() => { loadMain(); loadRecommendations(); });  // AgentView
```
- `onMounted` — after first DOM render → do initial fetches here (you do).
- `onUnmounted` / `onBeforeUnmount` — **cleanup**: clear timers, remove listeners, abort fetches.
  ⚠️ You set a `toastTimer` (`setTimeout`) in App.vue — in a long-lived app you'd `clearTimeout` on
  unmount to avoid a leak (minor here since App is the root).
- `onUpdated`, `onBeforeMount`, `onBeforeUpdate` — rarer.
- `nextTick()` — wait for the DOM to reflect a state change (e.g. scroll to a just-rendered element).

---

## 9. Async data / loading patterns (you do this well)

Your views model the **four UI states** explicitly — a senior pattern:
```
loading  →  error (with Retry)  →  empty (no data)  →  data
```
```ts
const loadingMain = ref(true); const errorMain = ref<string|null>(null);
async function loadMain(silent = false) {
  if (!silent) { loadingMain.value = true; errorMain.value = null; }
  try { const [a,b,c] = await Promise.all([...]); /* assign */ }
  catch (e) { if (!silent) errorMain.value = ...; }
  finally { if (!silent) loadingMain.value = false; }
}
```
- **`Promise.all`** for parallel fetches (you batch analyses + KPIs + leads).
- **Silent refresh** (`silent=true`) keeps old data visible, swaps on success → no loader flash. Nice.
- **Lazy / non-blocking** secondary data: recommendations load *after* mount without blocking the view.

---

## 10. Scoped styles + `:deep()`

- `<style scoped>` → styles apply only to this component (Vue adds a `data-v-…` attribute).
- **`:deep(.child)`** → reach into a child component's DOM from scoped styles. You use it to stagger
  the KPI bar reveals: `.kpi-profile > :nth-child(1) :deep(.kpi-bar-fill) { animation-delay: 40ms }`.

---

## 11. `Teleport` + `Transition`

```vue
<Teleport to="body">                 <!-- render outside the component tree (overlays/toasts/modals) -->
  <Transition name="toast">          <!-- enter/leave CSS transition hooks -->
    <div v-if="toast" class="toast" role="status" aria-live="polite">{{ toast }}</div>
  </Transition>
</Teleport>
```
- **`Teleport`** — move DOM elsewhere (escape `overflow:hidden`/stacking contexts) while keeping it
  logically in the component. Perfect for your toast/modal.
- **`Transition`** — auto-applies `*-enter-from/active/to` + `*-leave-*` classes; you wire the CSS.
  `TransitionGroup` for animating list add/remove/reorder.

---

## 12. Perf knobs (mention if asked "how would you scale the UI")

- `computed` caching (you lean on it) > methods in templates.
- Stable `:key`s; avoid index keys on dynamic lists.
- `v-show` for frequent toggles; `v-if` for rare/expensive.
- `v-once` / `v-memo` for static or expensive-but-rarely-changing subtrees.
- **Virtualize** long lists (only render visible rows) — relevant if your call list hits thousands.
- Lazy-load routes/components (`defineAsyncComponent`) — you lazy-load recommendations' *data*.
- Pagination/infinite scroll instead of `limit: 200`.

---

## 13. Vue 2 → Vue 3 (likely "what changed" question)

- **Reactivity:** `Object.defineProperty` → **Proxy** (detects new props + array index/length changes;
  no more `Vue.set`).
- **API:** Options API → **Composition API** + `<script setup>` (better logic reuse via composables).
- Multiple **root nodes** allowed (fragments); **`Teleport`**, **`Suspense`** added.
- Better **TS** support; smaller, tree-shakeable runtime.
- `createApp()` instead of `new Vue()`; global API is per-app now.

---

## 14. Likely Vue interview Qs (one-line answers)

- **ref vs reactive?** ref = any value, `.value`, reassignable (default); reactive = objects, mutate in place.
- **Why `.value`?** ref is a Proxy-tracked wrapper so reads/writes are reactive; auto-unwrapped in templates.
- **computed vs watch vs method?** computed = cached derived value; watch = side effect on change; method = runs every render.
- **How do components talk?** props down, events up; provide/inject for deep trees; store for app-wide.
- **Why `:key`?** stable list identity for correct diffing; changing it force-remounts (fresh state).
- **v-if vs v-show?** v-if mounts/unmounts (rare/expensive); v-show toggles CSS (frequent).
- **State management without Pinia?** module-level `reactive` + functions = a composable (your `agents.ts`).
- **How do you avoid losing reactivity?** don't destructure props/reactive; reference directly or `toRefs`.
- **How does the parent call a child method?** template `ref` + `defineExpose` (your Refresh → `reload()`).
- **One-way vs two-way?** props are one-way (read-only); `v-model` = prop + `update:` event sugar.

---

## 15. 🎤 One-liners for *your* frontend

- *"No router — a `ref<View[]>` stack is the view-state machine; push/pop drives the drill-down + breadcrumbs."*
- *"No Pinia — module-level `reactive` (the agent-name cache) is a composable; right-sized for a small SPA."*
- *"Props down, events up; the typed API client (`api.ts`) is the single backend boundary and it schema-validates every response so unshaped LLM data can't reach the UI."*
- *"Changing a component's `:key` force-remounts it — that's how location/agent switches get a clean reload."*
- *"Refresh is non-destructive: `defineExpose({reload})` lets the header silently re-fetch the active view in place, keeping scroll + filters."*
- *"KPI bars animate with GPU `transform: scaleX()`, never `width` — no layout thrash; full `prefers-reduced-motion` support."*
