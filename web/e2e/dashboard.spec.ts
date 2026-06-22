import { test, expect } from '@playwright/test';
import { mockApi, AGENT_NAME } from './mock';

/**
 * Dashboard E2E. Covers the full loop (overview → agent → recommendations → call →
 * transcript evidence), every UX-004 state, and the Emil craft layer (UX-007) —
 * the animation work is validated by asserting computed styles + reduced-motion
 * behavior, no screen recording required.
 */

test.describe('states (UX-004)', () => {
  test('empty: no calls ingested yet', async ({ page }) => {
    await mockApi(page, { empty: true });
    await page.goto('/');
    await expect(page.getByText('No calls ingested yet')).toBeVisible();
  });

  test('error: failed load shows a retry affordance', async ({ page }) => {
    await mockApi(page, { fail: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Could not load agents' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

test.describe('overview (R2.4)', () => {
  test('renders the agent card with real-shaped data and flags the weakest KPI', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // Summary strip
    await expect(page.getByText('Calls analyzed')).toBeVisible();
    // Agent card shows the resolved NAME (not the raw id) and a KPI strip
    await expect(page.getByText(AGENT_NAME)).toBeVisible();
    await expect(page.getByText('Info Capture').first()).toBeVisible();
    // info_capture (52) is the weakest → flagged
    await expect(page.getByText('Weakest')).toBeVisible();
  });
});

test.describe('drill-down + recommendations (R2.5/R2.6 · UX-002/003)', () => {
  test('overview → agent → recommendations → call → transcript evidence', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');

    // → agent
    await page.locator('.agent-card').first().click();
    await expect(page.getByRole('heading', { name: 'KPI Profile' })).toBeVisible();

    // recommendations rendered (R2.5) with the actionable fix surfaced
    await expect(page.getByText('Force full-name and email capture')).toBeVisible();
    await expect(page.getByText('Fix the opening greeting / agent identity')).toBeVisible();

    // → call detail
    await page.locator('.call-row').first().click();
    await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();

    // Use Action banner sits over the transcript (R2.6)
    await expect(page.getByText('Email objection conceded')).toBeVisible();

    // Evidence chip → scroll-to + highlight the exact turn (UX-003)
    const infoCard = page.locator('.kpi-scorecard', { hasText: 'Info Capture' });
    await infoCard.getByRole('button', { name: 'T5' }).click();
    await expect(page.locator('#turn-5')).toHaveClass(/turn--highlighted/);
  });

  test('recommendations show the Opus "synthesizing" loading state', async ({ page }) => {
    await mockApi(page, { recsDelayMs: 1500 });
    await page.goto('/');
    await page.locator('.agent-card').first().click();
    await expect(page.getByText(/Synthesizing across .* calls/)).toBeVisible();
    // ...then resolves to cards, with a Refresh affordance for on-demand re-synthesis
    await expect(page.getByText('Force full-name and email capture')).toBeVisible();
    await expect(page.locator('.recs-refresh')).toBeVisible();
  });

  test('Refresh is non-destructive — stays on the current view', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('.agent-card').first().click();
    await page.locator('.call-row').first().click();
    await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
    // Hitting Refresh deep in the call view must NOT bounce back to the overview.
    await page.getByRole('button', { name: /Refresh/ }).click();
    // Visible feedback: button shows a spinner, then a "Refreshed" toast confirms.
    await expect(page.locator('.btn-spinner')).toBeVisible();
    await expect(page.locator('.toast')).toHaveText('Refreshed');
    await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
    await expect(page.getByText('Calls analyzed')).toHaveCount(0);
  });

  test('breadcrumbs navigate back up the stack', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('.agent-card').first().click();
    await page.locator('.call-row').first().click();
    await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
    // First breadcrumb returns to overview
    await page.locator('.crumb').first().click();
    await expect(page.getByText('Calls analyzed')).toBeVisible();
  });

  test('deviation turn-link jumps to and highlights its turn', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('.agent-card').first().click();
    await page.locator('.call-row').first().click();
    await page.getByRole('button', { name: /Turn 5/ }).click();
    await expect(page.locator('#turn-5')).toHaveClass(/turn--highlighted/);
  });
});

test.describe('connections (icon trigger → modal)', () => {
  test('connections live behind a corner icon and open a modal with details', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    // The full-width bar is gone — connections are a compact header icon now.
    await expect(page.locator('.conn-trigger')).toBeVisible();
    await expect(page.locator('.modal')).toHaveCount(0);
    // Opening reveals the details in a centered modal
    await page.locator('.conn-trigger').click();
    await expect(page.getByRole('dialog', { name: 'Connections & Settings' })).toBeVisible();
    await expect(page.getByText('Backend connected')).toBeVisible();
    // Esc closes it
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(0);
  });
});

test.describe('observability signals + leads (R2.3/R2.6 · task #12)', () => {
  test('overview surfaces per-agent + location-wide signal counts', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    // Location-wide tallies in the summary strip (two distinct stats)
    await expect(page.locator('.summary-strip').getByText('Missed', { exact: true })).toBeVisible();
    await expect(page.locator('.summary-strip').getByText('Need human', { exact: true })).toBeVisible();
    // Per-agent card: 2 missed (aaa+bbb), 1 needs human (bbb)
    await expect(page.locator('.agent-sig--missed')).toContainText('2 missed');
    await expect(page.locator('.agent-sig--human')).toContainText('1 need human');
  });

  test('agent view shows signal summary, per-row badges, and filters the call list', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('.agent-card').first().click();

    // Header signal summary
    await expect(page.getByText(/2 missed opportunities/)).toBeVisible();
    await expect(page.getByText(/1 need.* human action/)).toBeVisible();

    // All three calls visible; two carry an MO badge, one an HA badge
    await expect(page.locator('.call-row')).toHaveCount(3);
    await expect(page.locator('.row-sig--missed')).toHaveCount(2);
    await expect(page.locator('.row-sig--human')).toHaveCount(1);

    // Filter to "Needs human" → only the one flagged call remains
    await page.getByRole('button', { name: /Needs human/ }).click();
    await expect(page.locator('.call-row')).toHaveCount(1);
    await expect(page.locator('.call-row .row-sig--human')).toBeVisible();
  });

  test('call view renders the Lead & Outcome panel with provenance + native drawer', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('.agent-card').first().click();
    await page.locator('.call-row').first().click();

    // Panel header + GHL-confirmed provenance badge
    await expect(page.getByRole('heading', { name: /Lead & Outcome/ })).toBeVisible();
    await expect(page.locator('.source-badge--ghl')).toHaveText('GHL-confirmed');

    // Booking status + confirmed + the missed-opportunity signal with its reason
    await expect(page.locator('.booking-pill')).toHaveText('Booked');
    await expect(page.getByText('✓ Confirmed')).toBeVisible();
    await expect(page.getByText('Missed opportunity')).toBeVisible();
    await expect(page.getByText(/never offered to add it/)).toBeVisible();

    // Native extractedData drawer is collapsed, then expands to show raw fields
    const toggle = page.getByRole('button', { name: /Native extractedData/ });
    await expect(page.locator('.native-grid')).toHaveCount(0);
    await toggle.click();
    await expect(page.locator('.native-grid')).toBeVisible();
    await expect(page.locator('.native-grid')).toContainText('Last Name');
  });
});

test.describe('craft layer (UX-007) — validated via computed styles, not a recording', () => {
  test('strong easing token is defined globally', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const ease = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim(),
    );
    expect(ease).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
  });

  test('KPI bar fill is GPU transform-based (scaleX), not width-animated', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const fill = page.locator('.kpi-bar-fill').first();
    // --fill-scale drives a scaleX transform → computed transform is a non-identity matrix
    const transform = await fill.evaluate((el) => getComputedStyle(el).transform);
    expect(transform).not.toBe('none');
    expect(transform.startsWith('matrix')).toBe(true);
    // The reveal animation is the named grow, and width is NOT transitioned
    const { animationName, transitionProperty } = await fill.evaluate((el) => {
      const s = getComputedStyle(el);
      return { animationName: s.animationName, transitionProperty: s.transitionProperty };
    });
    // Vue scopes @keyframes names per-component, so match the prefix (kpi-grow / kpi-grow-xxxx).
    expect(animationName).toMatch(/^kpi-grow/);
    expect(transitionProperty).not.toContain('width');
  });

  test('agent cards carry the staggered entrance animation', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const name = await page
      .locator('.agent-card')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('enter-up');
  });

  test('drilling into a view plays the view-enter transition', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('.agent-card').first().click();
    // The AgentView root carries .view-enter → a spatial slide-up on navigation
    const name = await page
      .locator('.agent-view')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('view-enter');
  });

  test('signal filter toggles give press feedback (transform transition)', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.locator('.agent-card').first().click();
    const prop = await page
      .locator('.filter-toggle')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(prop).toContain('transform');
  });

  test('primary buttons transition transform for press feedback', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const prop = await page
      .locator('.btn')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(prop).toContain('transform');
  });
});

test.describe('accessibility — reduced motion (real behavioral check)', () => {
  test('entrance + KPI grow animations are switched off when the OS asks', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page);
    await page.goto('/');
    await page.locator('.agent-card').first().waitFor();
    // Confirm the emulation is actually active, then assert the CSS responded.
    const reduceActive = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(reduceActive).toBe(true);
    const cardAnim = await page
      .locator('.agent-card')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    const fillAnim = await page
      .locator('.kpi-bar-fill')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(cardAnim).toBe('none');
    expect(fillAnim).toBe('none');
  });
});
