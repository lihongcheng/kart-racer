import { test, expect, type Page } from '@playwright/test';
import { TIMING_KEY } from '../../apps/web/src/game/timing';
import { RESULTS_KEY } from '../../apps/web/src/game/results';
import type { TrackId } from '../../apps/web/src/game/track';

async function ready(page: Page, track: TrackId = 'coastline') {
  await page.waitForFunction(id => window.__kart?.snapshot().trackId === id && window.__kart.snapshot().assets === 2, track);
}
async function menu(page: Page) {
  await page.getByRole('button', { name: '返回俱乐部', exact: true }).click();
}
for (const track of ['coastline', 'canyon'] as const) {
  test(`${track}: full ghost, nine splits, frozen reference, reset, restart and persistence`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(id => {
      if (!localStorage.getItem('coastline.settings')) localStorage.setItem('coastline.settings', JSON.stringify({ trackId: id, sound: false }));
    }, track);
    await page.goto('/'); await ready(page, track);
    await page.getByRole('button', { name: '计时练习', exact: true }).click();
    await expect(page.locator('.ghost-option')).toContainText('首次完赛');
    const first = await page.evaluate(() => {
      window.__kart.start('time'); window.__kart.advance(9);
      return window.__kart.advance(300, true);
    });
    expect(first.phase).toBe('finished'); expect(first.sectorEnds).toHaveLength(9);
    expect(first.sectorEnds[8]).toBe(first.elapsed); expect(first.referenceEnds).toEqual([]);
    await expect(page.locator('.sector-results tbody tr')).toHaveCount(9);
    const storedFirst = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), TIMING_KEY);
    expect(storedFirst.bests[track].frames.length).toBeGreaterThan(500);
    expect(storedFirst.bests[track].frames[0][0]).toBe(0);
    const second = await page.evaluate(() => {
      window.__kart.start('time');
      return window.__kart.advance(300, true);
    });
    expect(second.elapsed).toBeLessThan(first.elapsed);
    expect(second.referenceEnds).toEqual(first.sectorEnds);
    expect(second.racers).toHaveLength(1); expect(second.rank).toBe(1);
    await expect(page.locator('.sector-results')).toContainText('进步最多');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: `docs/screenshots/phase4-${track}-results.png` });
    const dialog = await page.getByRole('dialog').boundingBox();
    expect(dialog!.y).toBeGreaterThanOrEqual(0); expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(720);
    const third = await page.evaluate(() => {
      window.__kart.start('time'); window.__kart.advance(15);
      return window.__kart.advance(300, true);
    });
    expect(third.elapsed).toBeGreaterThan(second.elapsed);
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), TIMING_KEY);
    expect(stored.bests[track].total).toBe(second.elapsed);
    await page.reload(); await ready(page, track);
    await page.getByRole('button', { name: '计时练习', exact: true }).click();
    await expect(page.locator('.ghost-option')).toContainText('已记录');
    await page.screenshot({ path: `docs/screenshots/phase4-${track}-menu.png` });
    await page.evaluate(() => { window.__kart.start('time'); window.__kart.advance(22, true); window.__kart.pause(); });
    await page.waitForFunction(() => window.__kart.diagnostics().ghost.visible);
    const before = await page.evaluate(() => ({ ghost: window.__kart.diagnostics().ghost, time: window.__kart.snapshot().elapsed }));
    const after = await page.evaluate(() => { window.__kart.advance(5); return { ghost: window.__kart.diagnostics().ghost, time: window.__kart.snapshot().elapsed }; });
    expect(after).toEqual(before);
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    expect(await page.evaluate(() => window.__kart.snapshot().elapsed)).toBe(0);
    expect(await page.evaluate(() => window.__kart.snapshot().sectorEnds)).toEqual([]);
    await page.evaluate(() => { window.__kart.advance(20, true); window.__kart.reset(); window.__kart.advance(300, true); });
    // The slower reset run cannot overwrite the faster, complete replay.
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).bests[window.__kart.snapshot().trackId].total, TIMING_KEY)).toBe(second.elapsed);
    await menu(page);
    await page.getByRole('switch', { name: '显示最佳幽灵车' }).click();
    await page.reload(); await ready(page, track);
    await page.getByRole('button', { name: '计时练习', exact: true }).click();
    await expect(page.getByRole('switch', { name: '显示最佳幽灵车' })).toHaveAttribute('aria-checked', 'false');
    await page.evaluate(() => { window.__kart.start('time'); window.__kart.advance(8, true); });
    expect(await page.evaluate(() => window.__kart.diagnostics().ghost.visible)).toBe(false);
    expect(await page.evaluate(() => window.__kart.diagnostics().ghost.samples)).toBeGreaterThan(20);
    await page.evaluate(() => window.__kart.start('race'));
    expect(await page.evaluate(() => window.__kart.snapshot().ghostAvailable)).toBe(false);
    expect(await page.evaluate(() => window.__kart.snapshot().racers.length)).toBe(6);
    expect(errors).toEqual([]);
  });
}
test('legacy fastest remains intact without an invented ghost', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('coastline.records', JSON.stringify([
    { date: '2026-10-01', time: 60, bestLap: 20, rank: 1, mode: 'time' },
  ])));
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: '计时练习', exact: true }).click();
  await expect(page.locator('.ghost-option')).toContainText('刷新最佳后记录');
  const result = await page.evaluate(() => { window.__kart.start('time'); return window.__kart.advance(300, true); });
  expect(result.referenceEnds).toEqual([]); expect(result.ghostAvailable).toBe(false);
  expect(await page.evaluate(key => localStorage.getItem(key), TIMING_KEY)).toBeNull();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).bests['coastline:time'].time, RESULTS_KEY)).toBe(60);
});
test('storage failure retains the new baseline in this page and reports the failure', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key === 'coastline.timing.v1') throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/'); await ready(page);
  await page.evaluate(() => { window.__kart.start('time'); window.__kart.advance(300, true); });
  await expect(page.locator('.storage-notice')).toContainText('当前页面保留');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).bests['coastline:time'].time, RESULTS_KEY)).toBeGreaterThan(0);
  await page.evaluate(() => window.__kart.start('time'));
  expect(await page.evaluate(() => window.__kart.snapshot().ghostAvailable)).toBe(true);
});
test('long runs keep all splits, reset jumps are encoded and corrupt data does not prevent play', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const result = await page.evaluate(() => {
    window.__kart.start('time'); window.__kart.advance(907); return window.__kart.advance(300, true);
  });
  expect(result.replayLimited).toBe(true); expect(result.sectorEnds).toHaveLength(9);
  await expect(page.locator('.sector-results')).toContainText('超过回放容量');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).bests.coastline.frames, TIMING_KEY)).toBeNull();
  await page.evaluate(() => {
    window.__kart.start('time'); window.__kart.advance(12, true); window.__kart.reset(); window.__kart.advance(300, true);
  });
  const jumps = await page.evaluate(key => {
    const frames = JSON.parse(localStorage.getItem(key)!).bests.coastline.frames;
    const index = frames.findIndex((f: number[]) => f[8] === 1);
    return { reset: frames[index], next: frames[index + 1] };
  }, TIMING_KEY);
  expect(jumps.reset).toBeDefined(); expect(jumps.next[0] - jumps.reset[0]).toBeCloseTo(2);
  expect(jumps.next.slice(1, 7)).toEqual(jumps.reset.slice(1, 7));
  await page.evaluate(key => localStorage.setItem(key, '{broken'), TIMING_KEY);
  await page.reload(); await ready(page);
  await page.getByRole('button', { name: '计时练习', exact: true }).click();
  await expect(page.locator('.ghost-option')).toContainText('刷新最佳后记录');
  await expect(page.getByRole('button', { name: '即刻出发' })).toBeEnabled();
});
