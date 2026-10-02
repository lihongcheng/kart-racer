import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { getTrack, type TrackId } from '../../apps/web/src/game/track';
import { RESULTS_KEY } from '../../apps/web/src/game/results';

async function ready(page: Page, trackId: TrackId = 'coastline') {
  await page.waitForFunction(id => window.__kart?.snapshot().trackId === id && window.__kart?.snapshot().assets === 2, trackId);
}
async function selectTrack(page: Page, trackId: TrackId) {
  await page.locator('.track-card').click();
  await page.getByRole('button', { name: `选择${getTrack(trackId).name}`, exact: true }).click();
  await ready(page, trackId);
  await expect(page.getByRole('button', { name: `选择${getTrack(trackId).name}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /就跑这里/ }).click();
  await expect(page.locator('.world > canvas')).toHaveCount(1);
  await expect(page.locator('.world > canvas')).toHaveAttribute('aria-label', `${getTrack(trackId).name} 3D 赛车场景`);
}
test('switch circuits repeatedly, preserve garage settings, drive canyon with keyboard and reset', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: '我的车库', exact: true }).click();
  await page.getByRole('button', { name: '日落橘子', exact: true }).click();
  for (const id of ['canyon', 'coastline', 'canyon', 'coastline', 'canyon'] as const) {
    await selectTrack(page, id);
    expect(await page.evaluate(() => window.__kart.snapshot().racers.find(r => r.name === '你')?.color)).toBe('#ff8057');
    await expect(page.getByRole('button', { name: '日落橘子', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: '开始竞速', exact: true }).click();
  await page.locator('.track-card').click();
  await page.screenshot({ path: 'docs/screenshots/phase3-track-selection.png', animations: 'disabled' });
  await page.getByRole('button', { name: /就跑这里/ }).click();
  // Intentional camera transition from garage orbit to aerial view.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'docs/screenshots/phase3-canyon-menu.png', animations: 'disabled' });
  await page.getByRole('button', { name: '计时练习', exact: true }).click();
  await page.getByRole('button', { name: '即刻出发' }).click();
  await page.getByRole('button', { name: '明白了，出发！' }).click();
  await page.waitForFunction(() => window.__kart.snapshot().phase === 'racing');
  await expect(page.locator('.race-lap')).toContainText('落日峡谷');
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__kart.snapshot().speed > 65);
  const before = await page.evaluate(() => ({ yaw: window.__kart.diagnostics().racers[0].yaw, time: window.__kart.snapshot().elapsed }));
  await page.keyboard.down('a');
  await page.waitForFunction(t => window.__kart.snapshot().elapsed > t + 0.35, before.time);
  await page.keyboard.up('a'); await page.keyboard.up('w');
  const after = await page.evaluate(() => window.__kart.diagnostics().racers[0].yaw);
  expect(Math.atan2(Math.sin(after - before.yaw), Math.cos(after - before.yaw))).toBeGreaterThan(0.1);
  await page.keyboard.press('r');
  const reset = await page.evaluate(() => window.__kart.snapshot());
  const player = reset.racers[0];
  expect(getTrack('canyon').project(player.x, player.z).distance).toBeLessThan(4);
  expect(reset.elapsed).toBeGreaterThan(before.time + 2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toContainText('比赛已暂停');
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  expect(await page.evaluate(() => window.__kart.snapshot().trackId)).toBe('canyon');
  expect(await page.evaluate(() => window.__kart.snapshot().lapTimes)).toEqual([]);
  await page.reload(); await ready(page, 'canyon');
  await expect(page.locator('.track-card')).toContainText('落日峡谷');
  expect(errors).toEqual([]);
});

test('canyon ten full races, both difficulties, all AI finish, batched completions and isolated records', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await ready(page); await selectTrack(page, 'canyon');
  const races = [];
  for (const difficulty of ['easy', 'normal']) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('对手难度').selectOption(difficulty);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    // A single JS task deliberately exercises React batching of multiple finishes.
    const batch = await page.evaluate(() => Array.from({ length: 5 }, () => {
      window.__kart.start('race');
      const result = window.__kart.advance(300, true);
      return { result, diagnostics: window.__kart.diagnostics().racers };
    }));
    for (const { result, diagnostics } of batch) {
      expect(result.phase, JSON.stringify(diagnostics)).toBe('finished');
      expect(result.lapTimes).toHaveLength(3);
      expect(result.racers).toHaveLength(6);
      expect(result.trackId).toBe('canyon');
      expect(diagnostics[0].passed).toBe(72);
      races.push({ difficulty, elapsed: result.elapsed, rank: result.rank, lapTimes: result.lapTimes });
    }
    await expect(page.locator('.result-hero .medal-badge')).toBeVisible();
    const ai = await page.evaluate(() => { window.__kart.start('race'); return window.__kart.advance(300); });
    expect(ai.racers.filter(r => r.name !== '你' && r.finishedAt !== null)).toHaveLength(5);
    await page.evaluate(() => window.__kart.pause());
    await page.getByRole('button', { name: '返回俱乐部', exact: true }).click();
  }
  const solo = await page.evaluate(() => { window.__kart.start('time'); return window.__kart.advance(300, true); });
  expect(solo.phase).toBe('finished'); expect(solo.racers).toHaveLength(1);
  await expect(page.locator('.personal-best')).toContainText('刷新个人最佳');
  await page.screenshot({ path: 'docs/screenshots/phase3-canyon-finish.png', animations: 'disabled' });
  await page.reload(); await ready(page, 'canyon');
  await page.getByRole('button', { name: '个人纪录', exact: true }).click();
  await expect(page.locator('.records-table > div:not(.table-head)')).toHaveCount(11);
  await page.getByLabel('纪录赛道').selectOption('coastline');
  await expect(page.locator('.records-table')).toHaveCount(0);
  await page.getByLabel('纪录赛道').selectOption('canyon');
  await page.getByLabel('纪录模式').selectOption('time');
  await expect(page.locator('.records-table > div:not(.table-head)')).toHaveCount(1);
  await page.screenshot({ path: 'docs/screenshots/phase3-records.png', animations: 'disabled' });
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), RESULTS_KEY);
  expect(Object.keys(stored.bests)).toHaveLength(2);
  expect(errors).toEqual([]);
  await writeFile('docs/phase3-race-validation.json', JSON.stringify({ races, allFiveAiFinishedBothDifficulties: true, solo: { time: solo.elapsed, lapTimes: solo.lapTimes }, persistedRecords: 11, errors }, null, 2));
});

test('legacy records migrate, invalid settings fall back and first v2 write preserves history', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('test.seeded')) return;
    localStorage.setItem('test.seeded', 'true');
    localStorage.setItem('coastline.settings', JSON.stringify({ trackId: 'unknown' }));
    localStorage.setItem('coastline.records', JSON.stringify([{ date: '2026-09-30T12:00:00.000Z', time: 100, bestLap: 30, rank: 1, mode: 'race' }]));
  });
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: '个人纪录', exact: true }).click();
  await expect(page.locator('.records-table')).toContainText('海风环线');
  await expect(page.locator('.records-table .medal-badge')).toHaveText('金牌');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await selectTrack(page, 'canyon');
  await page.evaluate(() => { window.__kart.start('time'); window.__kart.advance(300, true); });
  await page.reload(); await ready(page, 'canyon');
  const data = await page.evaluate(key => ({ old: JSON.parse(localStorage.getItem('coastline.records')!), current: JSON.parse(localStorage.getItem(key)!) }), RESULTS_KEY);
  expect(data.old).toHaveLength(1);
  expect(data.current.history).toHaveLength(2);
  expect(data.current.bests['coastline:race'].time).toBe(100);
  expect(data.current.bests['canyon:time'].time).toBeGreaterThan(0);
});

test('switching during a delayed model load never restores the disposed scene', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let release!: () => void, seen!: () => void, held = false;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const firstRequest = new Promise<void>(resolve => { seen = resolve; });
  await page.route('**/models/palm.glb', async route => {
    if (!held) { held = true; seen(); await delayed; }
    await route.continue();
  });
  await page.goto('/'); await firstRequest;
  await expect(page.getByRole('button', { name: '即刻出发' })).toBeEnabled();
  await page.locator('.track-card').click();
  await page.getByRole('button', { name: '选择落日峡谷', exact: true }).click();
  await expect(page.locator('.world > canvas')).toHaveAttribute('aria-label', '落日峡谷 3D 赛车场景');
  await expect(page.getByRole('button', { name: '即刻出发' })).toBeEnabled();
  // Three.js deduplicates pending URLs: both scenes share this fetch.
  // Finish it after the new scene is playable using procedural scenery.
  const response = page.waitForResponse('**/models/palm.glb');
  release(); await (await response).finished();
  await ready(page, 'canyon');
  await page.getByRole('button', { name: /就跑这里/ }).click();
  await expect(page.locator('.world > canvas')).toHaveCount(1);
  await expect(page.locator('.world > canvas')).toHaveAttribute('aria-label', '落日峡谷 3D 赛车场景');
  const result = await page.evaluate(() => { window.__kart.start('time'); return window.__kart.advance(5, true); });
  expect(result.trackId).toBe('canyon'); expect(result.phase).toBe('racing'); expect(result.assets).toBe(2);
  expect(errors).toEqual([]);
});
