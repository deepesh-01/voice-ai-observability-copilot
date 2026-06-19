# ADR-0009: Dashboard KPI visualization — CSS bars, no charting library

- **Status:** Accepted
- **Date:** 2026-06-19
- **Session:** S-013
- **Traces to:** R2.4 (dashboard), E1 (UI/UX), E4 (no unnecessary deps)
- **Rests on assumptions:** none
- **Closes open sub-decision in:** ADR-0002 ("Charting library (ECharts vs Chart.js vs Vue-native)")

## Context

ADR-0002 left the charting library (ECharts vs Chart.js) as an open sub-decision. The
dashboard's KPI data is inherently tabular: one score (0–100) per KPI per agent or call. The
primary visualization need is a "bar" — communicate rank and magnitude at a glance.

## Options considered

| Option | Pros | Cons |
|--------|------|------|
| **CSS bars (no dep)** | Zero bundle cost; full control of color/layout/animation; aligns with HighLevel's clean aesthetic; no canvas/SVG rendering quirks in iframe embeds | No tooltips or zoom by default (not needed for our use case) |
| ECharts | Rich chart types | 700 KB+ bundle; overkill for a single bar type; iframe size matters for GHL embedding |
| Chart.js | Lighter than ECharts | Still ~200 KB extra; canvas — harder to style to match design tokens |

## Decision

**CSS bars**: each KPI score is a `<div>` with `width: {score}%` and `background` set from
the `scoreColor()` helper. The bar track is a rounded rectangle in `--border` background.
Transition is `width 0.45s cubic-bezier(0.4,0,0.2,1)` — smooth on first render.

Components:
- `KpiBar.vue` — reusable bar with label, score, calls count, and "Weakest" flag.
- Inline bars in `CallView.vue` for per-KPI scorecards.

## Rationale

The data is inherently one-dimensional (0–100) and the HighLevel aesthetic is clean/flat.
CSS bars are exactly sufficient, cost nothing in bundle size, and stay perfectly on-brand.
Adding a charting library for a single bar type would violate E4 ("only non-slop code") and
slow the iframe load for embedded GHL pages.

## Consequences

- If future requirements add trend lines or comparative histograms across time, this decision
  should be revisited. Lightweight options at that point: `uPlot` (40 KB) or CSS-only sparklines.
- No canvas element in the critical path — avoids Safari iframe canvas sizing bugs.
