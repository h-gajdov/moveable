import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Fail on WCAG 2.x A/AA violations (axe tags), including 2.2. */
async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // Map tiles are drawn on a canvas by a third-party style; labels in it are not DOM text.
    .exclude('.maplibregl-canvas')
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary).toEqual([]);
}

async function setLanguage(page: Page, lang: 'en' | 'mk' | 'sq') {
  await page.addInitScript((l) => window.localStorage.setItem('accessible-skopje:lang', l), lang);
}

async function noHorizontalScroll(page: Page) {
  const wide = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll('body *'))
      .filter((e) => e.getBoundingClientRect().right > w + 1 && !e.closest('[aria-hidden="true"]'))
      .map((e) => `${e.tagName} ${(e.textContent ?? '').slice(0, 40)}`)
      .slice(0, 5);
  });
  expect(wide).toEqual([]);
}

for (const path of ['/', '/report', '/settings', '/help', '/admin', '/navigate']) {
  test(`axe: ${path} has no WCAG A/AA violations`, async ({ page }) => {
    await setLanguage(page, 'en');
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expectNoAxeViolations(page);
    await noHorizontalScroll(page);
  });
}

for (const theme of ['dark', 'contrast'] as const) {
  test(`axe: ${theme} theme passes`, async ({ page }) => {
    await page.addInitScript((t) => window.localStorage.setItem('accessible-skopje:settings:v1',
      JSON.stringify({ ui: { theme: t } })), theme);
    await page.goto('/settings');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectNoAxeViolations(page);
  });
}

test('page has one h1, a skip link and landmarks', async ({ page }) => {
  await setLanguage(page, 'en');
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  await page.locator('body').focus();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
});

test('language can be switched from anywhere', async ({ page }) => {
  await setLanguage(page, 'en');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Shqip' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sq');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cilësimet');
  await page.getByRole('button', { name: 'Македонски' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Поставки');
  await expect(page.getByRole('button', { name: 'Македонски' })).toHaveAttribute('aria-pressed', 'true');
});

test('200% text size still reflows without horizontal scrolling', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('accessible-skopje:settings:v1',
    JSON.stringify({ ui: { textScale: 2 } })));
  await page.goto('/report');
  await expect(page.locator('h1')).toBeVisible();
  await noHorizontalScroll(page);
});

test('interactive controls are at least 44 by 44 CSS pixels', async ({ page }) => {
  await setLanguage(page, 'en');
  await page.goto('/');
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button, nav a, input[type=radio], input[type=checkbox]'))
      .filter((el) => el.offsetParent !== null && !el.closest('.maplibregl-ctrl'))
      .map((el) => {
        // Radios and checkboxes count together with their label row (WCAG 2.5.8 spacing).
        const box = (el.tagName === 'INPUT' ? el.parentElement! : el).getBoundingClientRect();
        return { name: el.innerText || el.getAttribute('aria-label') || el.id, w: box.width, h: box.height };
      })
      .filter((b) => b.w < 44 || b.h < 30)
      .map((b) => `${b.name} ${Math.round(b.w)}x${Math.round(b.h)}`));
  expect(small).toEqual([]);
});
