# Requirements — Traceability Source of Truth

> Source: `[Hiring] FSB Assignment Q226.pdf` — "Voice AI Observability Copilot".
> Every requirement below has a stable ID. All ADRs, assumptions, and code should trace
> back to one or more of these IDs. Do not edit IDs once assigned — only append.

## Objective (verbatim intent)

Design and implement an **Agent Observability Copilot** that automates the **"Monitor"**
and **"Analyze"** phases for HighLevel Voice AI agents. Move beyond manual log review by
using AI to autonomously track call performance against metrics and provide immediate,
actionable recommendations. The tool acts as a **"Validation Flywheel"** — a real-time
observability layer ensuring agents perform optimally through automated analysis.

---

## 1. Setup & Integration

| ID | Requirement |
|------|-------------|
| **R1.1** | Use a sandbox account from the HighLevel Marketplace. |
| **R1.2** | Integrate the solution into the HighLevel interface using **custom JS or a GHL marketplace app** that allows our code to reside within the customer account. |

## 2. Core Functionality — two observability loops

### Monitor (Observability)

| ID | Requirement |
|------|-------------|
| **R2.1** | Ingest and analyze existing Voice AI agent call transcripts. |
| **R2.1a** | **Continuous / real-time ingestion** — new calls are ingested and scored **automatically on completion** (via the `VoiceAiCallEnd` webhook), not only on a manual pull. This is the brief's "**real-time observability layer**" / "**Validation Flywheel**." *(Derived: implied by the Challenge's "real-time" language, not in the verbatim numbered list. Satisfied — see the webhook ingestion pipeline.)* |
| **R2.2** | Set observability parameters based on the agent's specific goals or script. |
| **R2.3** | Identify deviations, failures, or missed opportunities against success criteria (KPIs) in the logs. |

### Analyze (Unified Dashboard)

| ID | Requirement |
|------|-------------|
| **R2.4** | Build an intuitive dashboard that visualizes performance issues **across existing agents**. |
| **R2.5** | Provide **immediate recommendations** for prompt/script/agent adjustments based on identified failures. |
| **R2.6** | Highlight **"Use Actions"** — specific segments of a call that require human intervention or script training. |

---

## Deliverables

| ID | Deliverable |
|------|-------------|
| **D1** | GitHub repo for the widget/marketplace app and backend logic — **Node.js backend, Vue.js frontend**. |
| **D1.1** | Documented steps to install and run the observability suite inside a HighLevel sandbox. |
| **D2** | Demo (2–5 min): show Copilot ingesting & monitoring transcripts → unified dashboard view → AI-generated recommendations for a specific agent based on its call history. (Loom recommended.) |
| **D3** | A brief README describing the **architecture** and how "Team of One" ownership was handled (Product, Design, Engineering & QA). |
| **D3.1** | Notes on what is **functional** (real-time transcript ingestion) vs what is **mocked**. |

---

## Evaluation Criteria

| ID | Criterion | What "good" looks like |
|------|-----------|------------------------|
| **E1** | **Product Thinking + UI/UX** | Dashboard is customer-centric, intuitive, and seamlessly integrated into HighLevel. |
| **E2** | **Completeness** | System closes the loop from raw logs → actionable recommendations. |
| **E3** | **Technical Integrity** | Clear observability architecture and recommendations logic. |
| **E4** | **Manual Code Review** | Only non-slop code, submitted after thorough manual review. |

---

## Derived constraints (not verbatim, but binding)

| ID | Constraint | Basis |
|------|------------|-------|
| **C1** | 5-day delivery window (2026-06-18 → 2026-06-23). | Cover email: "submit within 5 days". |
| **C2** | Single builder owns the whole SDLC. | JD: "operate as a Team of One … You own the product." |
| **C3** | AI/LLM is core, not optional — analysis & recommendations must be AI-driven. | Objective: "using AI to autonomously track … provide … recommendations". |
