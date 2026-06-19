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
