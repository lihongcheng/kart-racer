import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { getTrack, type TrackId } from '../../apps/web/src/game/track';
import { trafficGap } from '../../apps/web/src/game/ai';

async function ready(page: Page, trackId: TrackId = 'coastline') {
  await page.waitForFunction(id => window.__kart?.snapshot().assets === 2 && window.__kart.snapshot().trackId === id, trackId);
}
async function drift(page: Page) {
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__kart.snapshot().speed >= 60);
  await page.keyboard.down('Shift'); await page.keyboard.down('d');
  await page.waitForFunction(() => window.__kart.snapshot().miniProgress >= 1);
}
async function stopKeys(page: Page) {
  await page.keyboard.up('Shift'); await page.keyboard.up('d'); await page.keyboard.up('w');
}
const records = (page: Page) => page.evaluate(() => ({
  results: localStorage.getItem('coastline.records.v2'), timing: localStorage.getItem('coastline.timing.v1'),
}));

for (const trackId of ['coastline', 'canyon'] as const) {
  test(`${trackId}: keyboard course, pause, reset, saved resume and record isolation`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(trackId === 'coastline' ? { width: 1280, height: 720 } : { width: 1440, height: 900 });
    await page.goto('/'); await ready(page);
    if (trackId === 'canyon') {
      await page.locator('.track-card').click();
      await page.getByRole('button', { name: '选择落日峡谷', exact: true }).click();
      await ready(page, trackId);
      await page.getByRole('button', { name: /就跑这里/ }).click();
    }
    await page.evaluate(() => { window.__kart.start('time'); window.__kart.advance(300, true); });
    await page.getByRole('button', { name: '返回俱乐部', exact: true }).click();
    const before = await records(page);
    expect(before.results).not.toBeNull(); expect(before.timing).not.toBeNull();
    await page.getByRole('button', { name: /驾驶实操 · 四步上手/ }).click();
    await page.waitForFunction(() => window.__kart.snapshot().phase === 'racing');
    await page.keyboard.down('Shift'); await page.keyboard.down('d');
    await page.evaluate(() => window.__kart.advance(1));
    expect(await page.evaluate(() => window.__kart.snapshot().training?.completed)).toBe(0);
    await stopKeys(page);
    await drift(page);
    expect(await page.evaluate(() => window.__kart.snapshot().training?.completed)).toBe(2);
    await page.keyboard.press('Escape'); await stopKeys(page);
    const frozen = await page.evaluate(() => window.__kart.snapshot().elapsed);
    expect(await page.evaluate(() => window.__kart.advance(5).elapsed)).toBe(frozen);
    await expect(page.getByRole('dialog')).toContainText('训练已暂停');
    await page.reload(); await ready(page, trackId);
    await page.getByRole('button', { name: '继续实操 · 2/4' }).click();
    await page.waitForFunction(() => window.__kart.snapshot().phase === 'racing');
    expect(await page.evaluate(() => window.__kart.snapshot().ghostAvailable)).toBe(false);
    expect(await page.evaluate(() => window.__kart.snapshot().racers.length)).toBe(1);
    await page.keyboard.press('Shift');
    expect(await page.evaluate(() => window.__kart.snapshot().training?.completed)).toBe(2);
    await drift(page);
    await page.screenshot({ path: `docs/screenshots/phase5-training-${trackId}.png` });
    const bounds = await page.locator('.training-card').boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(trackId === 'coastline' ? 470 : 620);
    await stopKeys(page);
    await page.waitForFunction(() => window.__kart.snapshot().training?.completed === 3);
    const resetBefore = await page.evaluate(() => window.__kart.snapshot().elapsed);
    await page.keyboard.press('r');
    expect(await page.evaluate(() => window.__kart.snapshot().elapsed)).toBeLessThan(resetBefore + 1);
    expect(await page.evaluate(() => window.__kart.snapshot().cans)).toBe(1);
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window.__kart.snapshot().training?.completed === 4);
    await page.keyboard.up('Space');
    await expect(page.getByRole('dialog')).toContainText('四步完成');
    expect(await records(page)).toEqual(before);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('coastline.training.v1')!).completed)).toBe(4);
    await page.screenshot({ path: `docs/screenshots/phase5-complete-${trackId}.png` });
    await page.getByRole('button', { name: '再练一次', exact: true }).click();
    expect(await page.evaluate(() => window.__kart.snapshot().training?.completed)).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '重试当前课目', exact: true }).click();
    expect(await page.evaluate(() => window.__kart.snapshot().training?.completed)).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '返回俱乐部', exact: true }).click();
    await page.getByRole('button', { name: '快速竞速', exact: true }).click();
    await page.getByRole('button', { name: '即刻出发' }).click();
    const acknowledge = page.getByRole('button', { name: '明白了，出发！' });
    if (await acknowledge.isVisible()) await acknowledge.click();
    expect(await page.evaluate(() => window.__kart.snapshot().training)).toBeNull();
    expect(await page.evaluate(() => window.__kart.snapshot().cans)).toBe(0);
    expect(await page.evaluate(() => window.__kart.snapshot().racers.length)).toBe(6);
    expect(errors).toEqual([]);
  });
}

test('AI passes a slow player, follows blocked traffic and handles the finish seam', async ({ page }) => {
  await page.goto('/'); await ready(page);
  const track = getTrack('coastline');
  const report = [];
  for (const t of [0.08, 0.99]) {
    await page.evaluate(({ t, length }) => {
      window.__kart.traffic([{ id: 0, t: t + 18 / length, offset: 0, speed: 8 },
        { id: 1, t, offset: 0, speed: 24 }]);
    }, { t, length: track.length });
    const samples = [];
    for (let second = 0; second < 12; second++) {
      const sample = await page.evaluate(() => {
        window.__kart.advance(1);
        return window.__kart.diagnostics().racers.slice(0, 2);
      });
      samples.push(sample);
      if (trafficGap(sample[0].t, sample[1].t, track.length) > 6) break;
    }
    const last = samples.at(-1)!;
    expect(trafficGap(last[0].t, last[1].t, track.length), JSON.stringify(samples)).toBeGreaterThan(6);
    expect(last[1].ai.laneChanges).toBeGreaterThan(0);
    expect(last[1].collisions).toBe(0); expect(last[1].resetCount).toBe(0);
    expect(Math.max(...samples.map(s => Math.abs(s[1].offset)))).toBeLessThan(track.width / 2);
    report.push({ scenario: t === 0.99 ? 'finish-seam' : 'slow-player', samples });
  }
  await page.evaluate(length => window.__kart.traffic([
    { id: 0, t: 0.08 + 12 / length, offset: 0, speed: 0 },
    { id: 1, t: 0.08, offset: 0, speed: 14 },
    { id: 2, t: 0.08 + 2 / length, offset: -3.6, speed: 0, pace: 0 },
    { id: 3, t: 0.08 + 2 / length, offset: 3.6, speed: 0, pace: 0 },
  ]), track.length);
  const blocked = await page.evaluate(() => { window.__kart.advance(3); return window.__kart.diagnostics().racers; });
  expect(blocked[1].speed).toBeLessThan(4);
  expect(blocked[1].ai.boostSafe).toBe(false);
  expect(blocked[1].collisions).toBe(0);
  report.push({ scenario: 'blocked', samples: [blocked] });
  // A parked player used to deadlock the easy grid as cars tried to steer at zero speed.
  const parked = await page.evaluate(() => {
    window.__kart.start('race'); const result = window.__kart.advance(240);
    return { finishers: result.racers.filter(r => r.name !== '你' && r.finishedAt !== null),
      diagnostics: window.__kart.diagnostics().racers };
  });
  expect(parked.finishers).toHaveLength(5);
  expect(parked.diagnostics.every(r => r.collisions === 0 && r.resetCount === 0)).toBe(true);
  report.push({ scenario: 'parked-player-easy', samples: [parked.diagnostics] });
  await writeFile('docs/phase5-traffic-validation.json', JSON.stringify(report, null, 2));
});
