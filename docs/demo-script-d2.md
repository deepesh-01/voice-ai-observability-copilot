# D2 — Demo script (2–5 min Loom)

A single clean take. Target ~3.5 min. The brief wants three beats: **ingesting & monitoring
transcripts**, the **unified dashboard of issues + metrics**, and **AI recommendations for an
agent based on its call history** — all shown **inside HighLevel**. The beats below cover that
plus the eval criteria (E1 native UX, E2 closed loop, E3 architecture clarity).

## Before you hit record (pre-roll)

- Log into the **HighLevel sub-account** (`Demo / Bengaluru`) and open the **Voice AI
  Observability** item in the left sidebar — leave it on the **overview**.
- Confirm it's live: summary strip shows `1 agent · 16 calls · 64 avg · 10 missed · 7 need human`.
- Close other tabs/notifications; full-screen the browser. Loom: record **screen + mic + cam bubble**.
- Have the **agent card** and one **low-scoring call** in mind so the drill-down is smooth.
- One dry run silently to nail the click path; then record once.

## The script

| ⏱ | Screen / click | Say (voiceover) |
|----|----------------|-----------------|
| **0:00–0:20** | Sidebar item highlighted; dashboard rendered inside the HighLevel chrome. Wave the cursor along the GHL left nav, then to the dashboard. | "This is the Voice AI Observability Copilot — and notice it's running **inside HighLevel**, as a native page in the sub-account. It automates the *Monitor* and *Analyze* phases for Voice AI agents, so you're not reading call logs by hand." |
| **0:20–0:45** | Point at the summary strip, then the agent card + its weakest-KPI line. | "Out of the box it's a unified view across agents: 16 calls ingested, an average score of 64, and the two signals that matter — **10 missed opportunities** and **7 calls that need a human**. Each agent card flags its weakest KPI — here Info Capture at 44." |
| **0:45–1:05** | (Optional) open the **Connections** icon → modal → close. Or just narrate. | "Calls land here automatically — when a Voice AI call ends, HighLevel fires a webhook, we score the transcript against the agent's goals, and persist it. It's a real-time flywheel, not a manual pull." |
| **1:05–1:35** | Click the **agent card** → agent view. Point at the KPI profile (weakest-first) and the signal tallies / filter toggles. | "Drilling into the agent: a KPI profile sorted weakest-first, and the same signals at the agent level — I can filter straight to the calls that missed an opportunity or need a human." |
| **1:35–2:25** | Scroll to **Recommendations**. Read ONE card: the title, then **Problem → Recommended Fix → Evidence**. | "And this is the payoff — recommendations the model **synthesized across the agent's whole call history**, not one call. This one: the agent keeps ending calls without capturing a name or number. The fix is a concrete prompt guardrail, and it's backed by specific evidence calls." |
| **2:25–3:05** | Click an **evidence call** link → call view. Click a **KPI evidence chip** (e.g. Info Capture → T5) so the transcript scrolls + highlights; point at a **deviation** and a **Use Action** amber banner. | "Click the evidence and it takes me to the exact call — the KPI chips jump to the transcript moment they're scored on, deviations link to their turn, and the **Use Action** segments mark exactly where a human should step in or the script needs training." |
| **3:05–3:30** | Point at the **Lead & Outcome** panel: booking status, the two signals with reasons, the **GHL-confirmed** source badge, expand the **native extractedData** drawer. | "Alongside the scoring, the business outcome: booking status, the missed-opportunity and human-action signals with reasons, and a provenance badge showing this came from HighLevel's own extracted data — not guessed." |
| **3:30–3:55** | Back to overview (breadcrumb). Rest on the unified view. | "So the loop is closed end to end — a raw transcript comes in, gets scored against KPIs, the failure moments get flagged, and it turns into a concrete, evidenced fix — all native inside HighLevel. That's the Validation Flywheel." |

## Delivery tips

- **Pace:** calm and steady; let each screen breathe ~2s before talking over it.
- **Cursor = pointer:** move deliberately to what you're naming; don't wander.
- **Name the value, not the UI:** "the calls that need a human" beats "this blue badge."
- **One genuine insight beat:** the recommendation card is the emotional peak — slow down there.
- If you fluff a line, keep going; trim in Loom rather than restart.
- Drop the final Loom URL into the submission next to the **D2** deliverable.

## Coverage check (so nothing's missed)

- ✅ Embedded in HighLevel (R1.2 / E1) — beat 1
- ✅ Ingesting & monitoring transcripts (R2.1 / R2.1a) — beat 3
- ✅ Unified dashboard of issues + metrics across agents (R2.4) — beats 2, 4
- ✅ Deviations / failures / missed opportunities vs KPIs (R2.3) — beats 4, 6
- ✅ AI recommendations from call history (R2.5) — beat 5
- ✅ "Use Actions" — human-intervention segments (R2.6) — beat 6
- ✅ Closed loop raw → recommendation (E2) — beat 7
