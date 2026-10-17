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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('accessible-skopje:lang', 'en');
    // Text-only layout: proves nothing depends on the map.
    window.localStorage.setItem('accessible-skopje:settings:v1', JSON.stringify({ ui: { showMap: false } }));
  });
});

test('keyboard-only wheelchair route between two real places', async ({ page }) => {
  await page.goto('/');
  const wheelchair = page.getByRole('radio', { name: 'Wheelchair or wheeled aid' });
  await wheelchair.focus();
  await page.keyboard.press('Space');
  await expect(wheelchair).toBeChecked();

  // Routes are found as soon as both points are chosen.
  await chooseFirstResult(page, 'Start', 'ploshtad makedonija');
  await chooseFirstResult(page, 'Destination', 'Стара скопска чаршија');

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
  await chooseFirstResult(page, 'Start', 'ploshtad makedonija');
  await chooseFirstResult(page, 'Destination', 'Стара скопска чаршија');
  await expect(page.getByRole('heading', { name: 'Routes', level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('combobox', { name: 'Start' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change start, destination or needs' }).click();
  await expect(page.getByRole('combobox', { name: 'Start' })).toBeFocused();
  await page.getByRole('button', { name: 'Find route' }).click();
  await expect(page.getByRole('heading', { name: 'Routes', level: 2 })).toBeFocused({ timeout: 30_000 });
});

test('standard profile is allowed to use stairs; the route says so', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Standard walking' }).check();
  await chooseFirstResult(page, 'Start', 'ploshtad makedonija');
  await chooseFirstResult(page, 'Destination', 'Стара скопска чаршија');
  await expect(page.getByRole('heading', { name: 'Routes', level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/set of stairs/).first()).toBeVisible();
});

test('missing destination gives an accessible error', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Find route' }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose a start and a destination first.');
});

test('obstacle report form validates and labels everything', async ({ page }) => {
  await page.goto('/report');
  await page.getByRole('button', { name: 'Send report' }).click();
  const summary = page.getByRole('alert').filter({ hasText: 'Please fix the following' });
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Choose where the obstacle is.');
  await expect(page.getByRole('group', { name: 'What is it?' })).toBeVisible();
  await expect(page.getByLabel('Photo')).toBeVisible();
});
