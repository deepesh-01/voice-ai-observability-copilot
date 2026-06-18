# Session S-006 — 2026-06-18 — First authorize attempt: app-version error

## Goal

Complete the first live OAuth authorize against the sandbox and capture a real transcript.

## Done / observed

- Server verified healthy; `/oauth/install` correctly 302s to chooselocation with the
  `voai` redirect URI. **No callback ever reached our server** (0 `[oauth]` log lines).
- Builder's browser showed (screenshot): **`error.noAppVersionIdFound`** and
  **`HttpException: No integration found with the id: 6a341c086a3eceb7ad2e99f9`** (the
  prefix of our `CLIENT_ID`), plus a "Please login to HighLevel to continue" panel.
- Added richer OAuth callback logging (surfaces upstream error body) to aid debugging.

## Diagnosis

The failure is **portal-side**, before the redirect returns to us:
1. Not logged into the sandbox in that browser session.
2. The app's **Auth/OAuth config (scopes + Redirect URL) is not completed + saved**, so
   HighLevel has no integration/app-version for this client_id → `noAppVersionIdFound`.

## Fix (builder, in dev portal)

1. Log into the sandbox account.
2. My Apps → app → Advanced Settings → **Auth**: set Redirect URL
   `https://voai.deepesh-engg.in/oauth/callback`, select scopes, **Save** (this registers the
   integration/version). Confirm Client Keys exist (Manage → Secrets).
3. Ensure App Type=Private, Distribution=Sub-account; create/save a version if prompted.
4. Re-run `https://voai.deepesh-engg.in/oauth/install`.

## Decisions / assumptions

- **A-009 (new, 🟡):** OAuth fails with `noAppVersionIdFound` until Auth config is saved.
- Confirms **A-007** is resolved in the same place (scope selection).

## Update — real root cause (portal screenshot)

- App version badge shows **`vdraft • DRAFT`**. A DRAFT version has no resolvable
  integration → a hand-built `chooselocation?client_id=…` URL fails with
  `noAppVersionIdFound`. Redirect URL `https://voai.deepesh-engg.in/oauth/callback` **was**
  correctly saved; not the cause.
- App is administered on **`marketplace.gohighlevel.com`** → briefly switched our
  `authorizeUrl` to `leadconnectorhq` then **reverted** to `gohighlevel.com` (made it
  `AUTHORIZE_URL`-overridable).
- **Correct install path for a draft:** add Scopes (required) + Save, then use the portal's
  per-version **"Install link"** (or publish the version) — not our `/oauth/install`.
- A-009 updated with this root cause.

## Next action

- Builder: add scopes + Save, install via the portal Install link, share the exact Voice AI
  scope name (→ set `SCOPES`). Then I verify the install + pull a real `Get Call Log`
  payload (A-003) → KPI schema (A-004).
