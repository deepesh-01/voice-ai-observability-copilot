# Fixtures — real HighLevel Voice AI shapes (A-003)

Canonical, *real* response shapes captured from the live sandbox — the scoring engine and
web build against these instead of guessed shapes.

Populate with `npx tsx scripts/capture-call-shape.mts` after placing a real call
(see `docs/setup-highlevel.md` §E).

- `real-call-list.json` — raw `GET /voice-ai/dashboard/call-logs` response.
- `real-call-<id>.json` — raw `GET /voice-ai/dashboard/call-logs/{id}` (transcript) response.

⚠️ These are real sandbox self-test calls and may contain PII (numbers/names spoken). Scrub
before sharing externally.
