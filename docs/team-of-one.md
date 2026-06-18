# Team of One — Owning Product, Design, Engineering & QA

> Required deliverable **D3**: describe how "Team of One" ownership was handled across all
> four disciplines. This documents the *process*; the ADRs and session logs are the evidence.

The JD frames the role as a single builder owning a product outcome end-to-end. Rather than
context-switching ad hoc, each discipline has an explicit home in this repo so nothing is
dropped.

## Product

- **Owns:** what to build and why, scope under the 5-day constraint, product calls.
- **Lives in:** `requirements.md` (traceability) + `assumptions-and-product-calls.md`
  (every product call recorded with a status).
- **Key calls so far:** A-004 (KPIs as the observability model), A-005 ("Use Actions" =
  timestamped human-review/training segments), A-006 ("real-time" = near-real-time on
  call-completion). Scope is cut to *close the loop* (E2) rather than gold-plate any layer.

## Design

- **Owns:** the dashboard UX — must be customer-centric, intuitive, and feel native to
  HighLevel (E1).
- **Lives in:** ADRs for UX-affecting choices (charting, layout, embed surface) + design
  notes captured per-session. Design intent traces to R2.4 / R2.6.
- **Principle:** surface *the issue and the fix together* — a metric is only useful next to
  its recommendation and the call segment that caused it.

## Engineering

- **Owns:** architecture and implementation — ingestion → KPI scoring → recommendations →
  dashboard, plus the marketplace integration.
- **Lives in:** `decisions/` (ADRs) and the code itself. Architecture clarity is graded (E3),
  so each layer's choice is justified with compared alternatives.
- **Principle:** schema-validated LLM output so the UI can trust the data; secrets in env
  from day one.

## QA

- **Owns:** correctness, honesty about what's real, and "non-slop" review (E4).
- **Lives in:** `functional-vs-mocked.md` (no silent mocking) + a manual review pass before
  submission + tests where they earn their keep (LLM-output parsing, KPI scoring).
- **Principle:** every mocked path is declared; the demo shows the real loop, not a facade.

## How the disciplines interlock

The tracking loop in `README.md` (Trace → Compare → Decide → Log → Register) is the
mechanism that lets one person wear four hats without losing the thread: a product call
becomes an assumption, an engineering choice becomes an ADR, a QA reality becomes a ledger
row, and every session log stitches them into a timeline.
