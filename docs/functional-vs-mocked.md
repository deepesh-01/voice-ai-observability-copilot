# Functional vs Mocked — Living Ledger

> Required deliverable **D3.1**: "Notes on what is functional (real-time transcript
> ingestion) vs what is mocked." This is a living table — update it as components move from
> mocked → real. Honesty here is graded (E2, E4).

**Legend:** 🟢 Functional (real) · 🟡 Partial / behind a flag · 🔴 Mocked · ⬜ Not built yet

| Component | Traces to | State | Notes |
|-----------|-----------|-------|-------|
| HighLevel OAuth (install/callback/refresh) | R1.2 | 🟢 | **Real install completed** — sandbox sub-account `B7TzvBb6H6QvDNdEEhlt` connected; token stored + refresh wired. |
| HighLevel sandbox & marketplace app install | R1.1, R1.2 | 🟢 | App **Live**; installed on a sandbox sub-account. Adding Voice AI scopes via a new version + reinstall (A-007/A-011). |
| Transcript ingestion (API) | R2.1, D1.1 | 🟢 | **Live, real data captured (S-012).** List + Get Call Log both live; real transcripts in `server/fixtures/` (incl. a full 123s booking call). `getCallLog` fixed to pass `locationId`. Capture tool `server/scripts/capture-call-shape.mts`. Still a **manual pull** — no webhook/poll ingestion pipeline yet (TBD). |
| Voice AI agent config (API write) | R2.2 setup | 🟢 | **Live (S-012).** Agent created in UI, then re-provisioned via `PATCH /voice-ai/agents/:id` (`Version: v3`) with `scripts/configure-agent.mts`. App carries `voice-ai-agents.write` + `voice-ai-agent-goals.write` after reinstall. Goals/actions not yet set (→ A-005). |
| Transcript parser | R2.1 | 🟢 | **Built + tested (S-012).** `analysis/transcript.ts` parses the `bot:/human:` string → typed turns (merges consecutive same-speaker lines; no timestamps). 9 unit tests; verified on real fixtures. |
| Observability parameters / KPI config | R2.2 | 🟢 | **Built (S-012).** `analysis/kpis.ts` — 6 config-driven KPIs (A-004): goal_completion, script_adherence, info_capture, accuracy, objection_handling, sentiment. Weighted overall, unit-tested. Dead-air dropped (no timestamps). |
| KPI scoring & deviation detection (LLM) | R2.3 | 🟢 | **Live, run end-to-end (S-012).** `analysis/score.ts` scores transcript+goal → KPI scores + deviations + "Use Actions" via the **Claude Agent SDK** (`claude-opus-4-8`, structured output), authed by `CLAUDE_CODE_OAUTH_TOKEN` (no bare API key). Pure logic unit-tested (7 tests); **closed the loop on the real 123s booking call** (overall 89/100, caught first-name-only + dropped-email gaps). Run: `scripts/score-fixture.mts`. |
| Unified dashboard | R2.4, E1 | 🟡 | Vue 3 shell built + embeddable; health/installs wired. Full agent/call/issue views pending. |
| Recommendations engine | R2.5 | ⬜ | Claude-based synthesis over call history. |
| "Use Actions" segment flagging | R2.6 | 🟡 | Modeled in the scorer output (`UseAction` spans of turns to review) — not yet surfaced in the UI or tied to `extractedData`/`executedCallActions` (A-005). |

## Rule

When a component ships, change its state and write one line of *what is real vs simulated*
(e.g. "real ingestion via webhook; KPI thresholds seeded from a default profile, not yet
learned"). No silent mocking — a faked path must say so here.
