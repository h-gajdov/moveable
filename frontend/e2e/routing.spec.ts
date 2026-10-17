import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Full keyboard-only flow against the real backend and imported Skopje data:
 * search two real places, choose the wheelchair profile, get a route and read
 * the steps without touching the map.
 */
async function chooseFirstResult(page: Page, field: string, query: string) {
  const input = page.getByRole('combobox', { name: field });
  await input.focus();
  await page.keyboard.type(query, { delay: 20 });
  await expect(page.getByRole('listbox', { name: field }).getByRole('option').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(input).not.toHaveValue(query);
}

/** Go through the plan steps: start, destination, needs, then find routes from the summary. */
async function planTrip(page: Page, profile?: string) {
  const stepHeading = page.getByRole('heading', { name: /Step \d of 4/, level: 2 });
  const next = page.getByRole('button', { name: 'Continue' });
  await expect(stepHeading).toHaveText(/Step 1 of 4\s*Start/);
  await chooseFirstResult(page, 'Start', 'ploshtad makedonija');
  await next.click();
  await expect(stepHeading).toBeFocused();
  await expect(stepHeading).toHaveText(/Step 2 of 4\s*Destination/);
  await chooseFirstResult(page, 'Destination', 'Стара скопска чаршија');
  await next.click();
  await expect(stepHeading).toHaveText(/Step 3 of 4\s*Your needs/);
  if (profile) {
    const radio = page.getByRole('radio', { name: profile });
    await radio.focus();
    await page.keyboard.press('Space');
    await expect(radio).toBeChecked();
  }
  await next.click();
  await expect(stepHeading).toHaveText(/Step 4 of 4\s*Check and find/);
  await page.getByRole('button', { name: 'Find route' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('accessible-skopje:lang', 'en');
    // Text-only layout: proves nothing depends on the map.
    window.localStorage.setItem('accessible-skopje:settings:v1', JSON.stringify({ ui: { showMap: false } }));
  });
});

test('keyboard-only wheelchair route between two real places', async ({ page }) => {
  await page.goto('/');
  await planTrip(page, 'Wheelchair or wheeled aid');

  const results = page.getByRole('heading', { name: 'Routes', level: 2 });
  await expect(results).toBeFocused({ timeout: 30_000 });
  await expect(page.getByText(/not guaranteed to be accessible or safe/)).toBeVisible();
  await expect(page.getByText('No mapped stairs')).toBeVisible();
  // Secondary details are collapsed rows; open one with the keyboard.
  await page.locator('summary', { hasText: 'Why this route' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Leaves out stairs, as you asked.')).toBeVisible();

  const steps = page.locator('ol.route-line > li');
  expect(await steps.count()).toBeGreaterThan(2);
  await expect(steps.first()).toContainText(/^.*Head (north|south|east|west|northeast|northwest|southeast|southwest)/);
  await expect(steps.last()).toContainText('You have arrived at your destination.');

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.failureSummary).join(' | ')}`)).toEqual([]);

  // Navigation without GPS: manual steps.
  await page.getByRole('button', { name: 'Start navigation' }).click();
  await expect(page.getByRole('heading', { name: 'Navigation', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText('Now, Step 2 of')).toBeVisible();
  await page.getByRole('button', { name: 'Stop navigation' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('the trip folds into a summary that can be changed', async ({ page }) => {
  await page.goto('/');
  await planTrip(page);
  await expect(page.getByRole('heading', { name: 'Routes', level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('combobox', { name: 'Start' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change start, destination or needs' }).click();
  const stepHeading = page.getByRole('heading', { name: /Step \d of 4/, level: 2 });
  await expect(stepHeading).toBeFocused();
  await expect(stepHeading).toHaveText(/Step 4 of 4\s*Check and find/);
  await page.getByRole('button', { name: 'Change: Your needs' }).click();
  await expect(stepHeading).toHaveText(/Your needs/);
  await page.getByRole('radio', { name: 'Reduced mobility' }).check();
  await page.getByRole('button', { name: 'Back to summary' }).click();
  await expect(page.locator('dd', { hasText: 'Reduced mobility' })).toBeVisible();
  await page.getByRole('button', { name: 'Find route' }).click();
  await expect(page.getByRole('heading', { name: 'Routes', level: 2 })).toBeFocused({ timeout: 30_000 });
});

test('standard profile is allowed to use stairs; the route says so', async ({ page }) => {
  await page.goto('/');
  await planTrip(page, 'Standard walking');
  await expect(page.getByRole('heading', { name: 'Routes', level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/set of stairs/).first()).toBeVisible();
});

test('each plan step checks its answer before going on', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  const summary = page.getByRole('alert').filter({ hasText: 'Please fix the following' });
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Choose where you start.');

  await chooseFirstResult(page, 'Start', 'ploshtad makedonija');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(summary).toContainText('Choose where you are going.');

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test('obstacle report form goes step by step and validates each step', async ({ page }) => {
  await page.route('**/api/obstacles/reports', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":"test","status":"PENDING"}' }));
  await page.goto('/report');
  const stepHeading = page.getByRole('heading', { name: /Step \d of 5/, level: 2 });
  await expect(stepHeading).toHaveText(/Step 1 of 5\s*Location/);
  await page.getByRole('button', { name: 'Continue' }).click();
  const summary = page.getByRole('alert').filter({ hasText: 'Please fix the following' });
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Choose where the obstacle is.');

  await chooseFirstResult(page, 'Where is it?', 'ploshtad makedonija');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(stepHeading).toBeFocused();
  await expect(stepHeading).toHaveText(/Step 2 of 5\s*Obstacle/);
  await page.getByRole('radio', { name: 'Construction or barrier' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(stepHeading).toHaveText(/Step 3 of 5\s*Impact/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(summary).toContainText('Choose how much it gets in the way.');
  await page.getByRole('radio', { name: 'I got past with difficulty' }).check();
  await expect(page.getByRole('checkbox', { name: /This is temporary/ })).toBeChecked();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(stepHeading).toHaveText(/Step 4 of 5\s*Details/);
  await expect(page.getByLabel('Photo')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(stepHeading).toHaveText(/Step 5 of 5\s*Check and send/);
  await expect(page.getByText('Temporary, about 30 days')).toBeVisible();
  await page.getByRole('button', { name: 'Change: Obstacle' }).click();
  await expect(stepHeading).toHaveText(/Obstacle/);
  await page.getByRole('radio', { name: 'High kerb' }).check();
  await page.getByRole('button', { name: 'Back to summary' }).click();
  await expect(page.locator('dd', { hasText: 'High kerb' })).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('heading', { name: 'Report sent', level: 1 })).toBeFocused();
});
