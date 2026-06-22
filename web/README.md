# `web/` — Frontend (Vue 3 + Vite + TypeScript)

The unified observability dashboard — a single-page app that **embeds inside HighLevel** (as a
marketplace Custom Page / left-sidebar Custom Menu Link) and renders the agent → call →
flagged-segment drill-down, recommendations, and the lead/observability signals.

> Big-picture architecture, decisions, and the Team-of-One split live in the [root README](../README.md).
> UI/UX decisions are logged in [`docs/ux-changelog.md`](../docs/ux-changelog.md). This file is the
> frontend's own map.

## Quick start

```bash
npm install
npm run dev        # Vite on :5173, proxying /api · /oauth · /health → backend :8095
```

Run the [backend](../server) first (or in parallel) — the dev server proxies to it, so the embedded
app talks to one origin. In production the backend serves the built `dist/` itself.

| Script | What |
|--------|------|
| `npm run dev` | Vite dev server (HMR) |
| `npm run build` | `vue-tsc -b && vite build` → `dist/` (typecheck gate + bundle) |
| `npm run test` | `vitest run` — unit (pure logic in `api.ts`) |
| `npm run test:e2e` | `playwright test` — full-flow E2E (API mocked at the browser layer) |

## Architecture

A small, dependency-light SPA (Vue is the only runtime dep — no router, no state library, no
charting lib). State and navigation are deliberately hand-rolled.

### View-state machine (`App.vue`)

A stack drives a three-level drill-down; breadcrumbs + a `view-enter` transition come from it:

```
overview ──select agent──▶ agent ──select call──▶ call
(OverviewView)            (AgentView)            (CallView)
   cross-agent cards        KPI profile +           KPI scorecards + evidence chips
   + summary signals        recommendations +       → transcript highlights, deviations,
                            call list + filters      Use Action segments, Lead & Outcome
```

A header **Refresh** bumps a `refreshSignal` each view watches → **non-destructive** in-place
re-fetch (keeps your place, filters, and scroll; silent swap on success).

### Typed API client (`api.ts`)

The single boundary to the backend. Every `/api` response is **schema-validated** here (fail-loud
in dev) before it reaches a component, so un-shaped LLM data can't leak into the UI. Also holds the
domain types (mirrors `server/src/analysis/types.ts`) and pure helpers (score colors, signal counts,
`parseTranscript` — kept **byte-for-byte identical to the backend** so evidence/turn indices align;
pinned by a unit test).

### Auth (`window.__API_TOKEN__`)

The backend injects the API bearer token into the served `index.html` at runtime (never in git);
`apiHeaders()` echoes it on every `/api` call. Absent in local dev (API open).

### Other pieces

- `agents.ts` — reactive agent-name cache (shows real names, not opaque ids; resolves once per location).
- `components/KpiBar.vue` — reusable KPI bar; GPU `transform: scaleX()` reveal (never animates `width`).
- `components/ConnectionsPanel.vue` — connection status as a corner icon → modal.
- `style.css` — design tokens, the shared `.page-loader`, badges/chips, and the reduced-motion rules.

## Directory map

```
index.html            pre-mount boot spinner; #app mount point
src/
  main.ts             createApp(App).mount('#app')
  App.vue             view-state machine, breadcrumbs, location/install picker, Refresh
  api.ts              typed client + schema validation + domain types + pure helpers
  agents.ts           agent-name cache (reactive, per-location)
  style.css           global tokens, page-loader, primitives, prefers-reduced-motion
  env.d.ts            ambient types (incl. window.__API_TOKEN__)
  components/         OverviewView · AgentView · CallView · KpiBar · ConnectionsPanel
e2e/                  dashboard.spec.ts (flows + craft + a11y) · mock.ts (hermetic API fixtures)
```

## Conventions

- **CSS bars, no charting library** (ADR-0009) — zero bundle cost, full control, no iframe canvas quirks.
- **Craft layer** (Emil Kowalski benchmark, ADR-0005): custom easing tokens, GPU transforms, staggered
  entrances, press feedback, full `prefers-reduced-motion` support — validated in E2E via computed styles.
- **Embed-safe:** the app assumes it runs framed inside HighLevel; the backend sets the `frame-ancestors`
  CSP. Native-feeling palette/card system to match the GHL surface.
- **Hermetic E2E:** `e2e/mock.ts` intercepts the API at the browser layer with real-shaped fixtures —
  no backend/DB/LLM needed to run the suite.

See [`docs/ux-changelog.md`](../docs/ux-changelog.md) and [`docs/decisions`](../docs/decisions) (ADR-0005, ADR-0009).
