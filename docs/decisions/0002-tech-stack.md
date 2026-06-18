# ADR-0002: Core tech stack

- **Status:** Accepted
- **Date:** 2026-06-18
- **Session:** S-001
- **Traces to:** D1 (Node.js backend + Vue.js frontend), R1.2 (integrate via custom JS / GHL marketplace app), R2.1–R2.6 (ingest, analyze, recommend), C3 (AI is core)
- **Rests on assumptions:** A-001, A-002

## Context

The brief **mandates** the language/framework for two layers and leaves the rest to us. We
need an AI engine to do the actual analysis (C3), a place to store transcripts and derived
metrics, and a way to live inside the HighLevel customer account (R1.2). This ADR fixes the
stack so implementation can start; sub-decisions still open are listed at the bottom.

## Options considered

### Backend framework (language fixed = Node.js by D1)

| Option | Pros | Cons |
|--------|------|------|
| **Express** | Ubiquitous, minimal, every GHL example uses it, fastest to scaffold | Less structure; we add our own |
| NestJS | Batteries-included, DI, structure | Heavier; more boilerplate than a 5-day build needs |
| Fastify | Faster throughput | Throughput is not our bottleneck (LLM latency dominates) |

→ **Express** — LLM calls dominate latency (C1 time budget matters more than req/s; A-002).

### Frontend framework (library fixed = Vue.js by D1)

| Option | Pros | Cons |
|--------|------|------|
| **Vue 3 + Vite + TypeScript** | Modern default, fast HMR, Composition API, type safety for E4 | — |
| Vue 2 | — | EOL; no reason to start here |

→ **Vue 3 + Vite + TypeScript**, charts via a lightweight lib (ECharts/Chart.js — see open items).

### AI / LLM engine (we choose — C3)

| Option | Pros | Cons | Evidence |
|--------|------|------|----------|
| **Anthropic Claude (Opus 4.8 + Sonnet 4.6)** | Strong instruction-following & long-context for whole-transcript reasoning; reliable structured/tool output for scoring JSON; tiered models let us route cheap vs deep | External API cost/latency | Latest, most capable Claude family as of cutoff; structured-output + tool use fit the scoring/recommendation task |
| OpenAI GPT family | Capable, mature | No advantage here; same external-API tradeoffs | — |
| Local/OSS model | No API cost | Quality/latency/ops cost not worth it in a 5-day solo build | — |

→ **Claude**, with model **routing**: cheaper/faster **Sonnet 4.6** for per-transcript KPI
scoring at volume; **Opus 4.8** for deeper cross-call recommendation synthesis (R2.5). This
keeps cost/latency sane while preserving quality where it matters. (Validate routing in a
later ADR once we measure.)

### Transcript / metrics storage (we choose)

| Option | Pros | Cons |
|--------|------|------|
| **MongoDB** | Schema-flexible for varied transcript/KPI shapes; HighLevel's own stack is Mongo-heavy; easy local via Docker | Need indexes for dashboard queries |
| Postgres + JSONB | Strong querying, relational metrics | Slightly more schema upfront |
| SQLite | Zero-infra | Weak for concurrent/aggregate dashboard reads |

→ **MongoDB** — flexible transcript/KPI documents, trivial local setup, aligns with the
target platform's ecosystem. Revisit if dashboard aggregations get heavy.

### HighLevel integration surface (R1.2)

| Option | Pros | Cons |
|--------|------|------|
| **GHL Marketplace App with a Custom Page / embedded iframe + OAuth** | "Code resides within the customer account" as asked; real install story for D1.1; uses official APIs | Marketplace app setup overhead |
| Custom JS snippet only | Fastest | Thinner integration; less of a real "app" |

→ **Marketplace App (Custom Menu Link / embedded dashboard) + OAuth**, with a Custom JS
fallback if marketplace provisioning blocks us in the sandbox (tracked as A-001).

## Decision

**Express (Node.js) + Vue 3/Vite/TS + Anthropic Claude (Sonnet 4.6 / Opus 4.8 routed) +
MongoDB, delivered as a HighLevel Marketplace App** embedded in the customer account.

## Rationale

Two layers are dictated by D1; for the rest we optimized for the binding constraint —
**time (C1)** — while protecting **AI quality (C3, E3)** and a credible **install story
(D1.1)**. Express + Vite are the fastest credible scaffolds; Claude gives reliable
structured scoring/recommendations; Mongo matches the data shape and the platform; a
marketplace app is the integration the brief actually describes (R1.2).

## Consequences

- Secrets (`ANTHROPIC_API_KEY`, GHL OAuth creds) move to env/secret config from day one.
- LLM output must be schema-validated (structured output) so the dashboard can rely on it.
- Cost/latency depend on transcript volume → a real-vs-mocked line for ingestion (see
  `functional-vs-mocked.md`) and a model-routing ADR will follow once measured.

## Open sub-decisions (to be their own ADRs when reached)

- Charting library (ECharts vs Chart.js vs Vue-native).
- Real-time ingestion mechanism: GHL **webhooks** vs **polling** the API (D1.1 / "real-time").
- KPI/observability-parameter schema (how R2.2 goals/script map to measurable KPIs).
- Hosting for the demo (local Docker vs a cloud URL the sandbox can reach).
