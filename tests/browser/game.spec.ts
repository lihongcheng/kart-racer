import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import type { KartGame } from '../../apps/web/src/game/engine';

declare global { interface Window { __kart: ReturnType<KartGame['debug']> } }
async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__kart?.snapshot().assets === 2);
}
async function start(page: Page) {
  await page.getByRole('button', { name: '即刻出发' }).click();
  const tutorial = page.getByRole('button', { name: '明白了，出发！' });
  if (await tutorial.isVisible()) await tutorial.click();
  await page.waitForFunction(() => window.__kart.snapshot().phase === 'racing');
}
const screenshotDir = 'docs/screenshots';
test.beforeAll(async () => { await mkdir(screenshotDir, { recursive: true }); });

test('A/left and D/right match the driver view, including drift', async ({ page }) => {
  await ready(page);
  for (const drift of [false, true]) for (const key of ['a', 'ArrowLeft', 'd', 'ArrowRight']) {
    await page.evaluate(() => { window.__kart.start('time'); window.__kart.advance(4); });
    await page.keyboard.down('w');
    await page.waitForFunction(() => window.__kart.snapshot().speed > 50);
    const before = await page.evaluate(() => ({
      yaw: window.__kart.diagnostics().racers[0].yaw,
      racer: window.__kart.snapshot().racers[0],
      elapsed: window.__kart.snapshot().elapsed,
    }));
    if (drift) await page.keyboard.down('Shift');
    await page.keyboard.down(key);
    await page.waitForFunction(time => window.__kart.snapshot().elapsed >= time + 0.3, before.elapsed);
    await page.keyboard.up(key);
    if (drift) await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    const after = await page.evaluate(() => ({
      yaw: window.__kart.diagnostics().racers[0].yaw,
      racer: window.__kart.snapshot().racers[0],
    }));
    // Screen-right from a camera behind a +Z-facing car is local -X.
    const rightX = -Math.cos(before.yaw), rightZ = Math.sin(before.yaw);
    const headingRight = Math.sin(after.yaw) * rightX + Math.cos(after.yaw) * rightZ;
    const travelRight = (after.racer.x - before.racer.x) * rightX + (after.racer.z - before.racer.z) * rightZ;
    const expectedSide = key === 'a' || key === 'ArrowLeft' ? -1 : 1;
    expect(headingRight * expectedSide, `${key}, drift=${drift}: heading`).toBeGreaterThan(0.1);
    expect(travelRight * expectedSide, `${key}, drift=${drift}: movement`).toBeGreaterThan(0.01);
  }
});

test('keyboard driving, drift release, reset, pause and replay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  await page.screenshot({ path: `${screenshotDir}/menu.png` });
  await page.getByRole('button', { name: '计时练习', exact: true }).click();
  await start(page);
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__kart.snapshot().speed > 75);
  await page.screenshot({ path: `${screenshotDir}/race.png` });
  await page.keyboard.down('Shift'); await page.keyboard.down('d');
  await page.waitForFunction(() => window.__kart.snapshot().driftTime > 0.7);
  await expect(page.getByRole('progressbar', { name: '小喷准备进度' })).toHaveAttribute('aria-valuenow', '100');
  await page.screenshot({ path: `${screenshotDir}/drift.png` });
  await page.keyboard.up('Shift'); await page.keyboard.up('d');
  await page.waitForFunction(() => window.__kart.snapshot().mini && !window.__kart.snapshot().nitro);
  await page.keyboard.up('w');
  const elapsed = await page.evaluate(() => window.__kart.snapshot().elapsed);
  await page.keyboard.press('r');
  expect(await page.evaluate(() => window.__kart.snapshot().elapsed)).toBeGreaterThan(elapsed + 1.9);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toContainText('比赛已暂停');
  const pauseTime = await page.evaluate(() => window.__kart.snapshot().elapsed);
  const frozenTime = await page.evaluate(() => window.__kart.advance(5).elapsed);
  expect(frozenTime).toBe(pauseTime);
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  expect(await page.evaluate(() => window.__kart.snapshot().lapTimes)).toHaveLength(0);
  expect(await page.evaluate(() => window.__kart.snapshot().elapsed)).toBe(0);
  expect(errors).toEqual([]);
});

test('pause freezes drift visuals, restart clears effects and disabling motion fixes the FOV', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '加速镜头效果' }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => { window.__kart.start('time'); window.__kart.advance(4); });
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__kart.snapshot().speed > 75);
  await page.keyboard.down('Shift'); await page.keyboard.down('d');
  await page.waitForFunction(() => window.__kart.snapshot().miniProgress >= 1 && window.__kart.diagnostics().effects.activeParticles > 0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  const frozen = await page.evaluate(() => ({
    effects: window.__kart.diagnostics().effects, visual: window.__kart.diagnostics().visuals[0], time: window.__kart.snapshot().elapsed,
  }));
  // Longer than any particle lifetime: a paused particle must still exist afterwards.
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => ({
    effects: window.__kart.diagnostics().effects, visual: window.__kart.diagnostics().visuals[0], time: window.__kart.snapshot().elapsed,
  }))).toEqual(frozen);
  await page.keyboard.up('Shift'); await page.keyboard.up('d'); await page.keyboard.up('w');
  await page.getByRole('button', { name: '继续比赛', exact: true }).click();
  await page.waitForFunction(time => window.__kart.snapshot().elapsed > time + 0.15, frozen.time);
  expect(await page.evaluate(() => window.__kart.snapshot().mini)).toBe(false);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  expect(await page.evaluate(() => window.__kart.diagnostics().effects.marks)).toBe(0);
  expect(await page.evaluate(() => window.__kart.diagnostics().effects.activeParticles)).toBe(0);
  await page.evaluate(() => window.__kart.advance(4));
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__kart.snapshot().speed > 75);
  await page.keyboard.down('Shift'); await page.keyboard.down('d');
  await page.waitForFunction(() => window.__kart.snapshot().miniProgress >= 1);
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => window.__kart.snapshot().mini);
  expect(await page.evaluate(() => window.__kart.diagnostics().fov)).toBe(62);
  await page.keyboard.up('d'); await page.keyboard.up('w');
});

test('garage paints, asset previews and settings persist across reload', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '我的车库', exact: true }).click();
  await page.getByRole('button', { name: '日落橘子', exact: true }).click();
  // Let the camera finish moving from its aerial position to the garage orbit.
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${screenshotDir}/garage.png` });
  await expect(page.getByRole('button', { name: '日落橘子', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '游戏音效' }).click();
  await page.getByLabel('画面质量').selectOption('low');
  await page.getByLabel('对手难度').selectOption('normal');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: /每一辆车/ }).click();
  await expect(page.locator('.asset-list button')).toHaveCount(4);
  await expect(page.locator('.asset-list button.active')).toContainText('浪游者 Classic');
  await expect(page.locator('.model-preview')).toHaveAttribute('data-loaded', 'true');
  await expect(page.getByRole('link', { name: '下载 GLB' })).toHaveAttribute('href', '/models/classic-kart.glb');
  await expect(page.getByRole('link', { name: '查看原作' })).toHaveCount(0);
  await page.screenshot({ path: `${screenshotDir}/classic-workshop.png` });
  await page.getByRole('button', { name: /海岛棕榈/ }).click();
  await expect(page.locator('.model-preview')).toHaveAttribute('data-loaded', 'true');
  await page.screenshot({ path: `${screenshotDir}/workshop.png` });
  await page.reload();
  await page.waitForFunction(() => window.__kart?.snapshot().assets === 2);
  await expect(page.getByRole('button', { name: '开启声音' })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('画面质量')).toHaveValue('low');
  await expect(page.getByLabel('对手难度')).toHaveValue('normal');
});

test('ten full races, both AI difficulties, saved results and solo practice', async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  const results = [];
  for (let n = 0; n < 10; n++) {
    if (n === 5) {
      await page.getByRole('button', { name: '返回俱乐部', exact: true }).click();
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByLabel('对手难度').selectOption('normal');
      await page.getByRole('button', { name: '关闭', exact: true }).click();
    }
    const result = await page.evaluate(() => {
      window.__kart.start('race');
      return window.__kart.advance(240, true);
    });
    expect(result.phase).toBe('finished');
    expect(result.lapTimes).toHaveLength(3);
    expect(result.racers).toHaveLength(6);
    results.push({ difficulty: n < 5 ? 'easy' : 'normal', elapsed: result.elapsed, rank: result.rank, lapTimes: result.lapTimes });
  }
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/finish.png` });
  // Hold the player at the grid while all five AI complete their races.
  const ai = await page.evaluate(() => {
    window.__kart.start('race');
    return window.__kart.advance(240);
  });
  expect(ai.racers.filter(racer => racer.name !== '你' && racer.finishedAt !== null)).toHaveLength(5);
  const solo = await page.evaluate(() => {
    window.__kart.start('time');
    return window.__kart.advance(240, true);
  });
  expect(solo.phase).toBe('finished'); expect(solo.racers).toHaveLength(1);
  await page.reload(); await page.waitForFunction(() => window.__kart?.snapshot().ready);
  await page.getByRole('button', { name: '个人纪录', exact: true }).click();
  await expect(page.locator('.records-table > div:not(.table-head)')).toHaveCount(11);
  await writeFile('docs/race-validation.json', JSON.stringify({ races: results, allFiveAiFinished: true, solo: { time: solo.elapsed, lapTimes: solo.lapTimes }, persistedRecords: 11 }, null, 2));
});
