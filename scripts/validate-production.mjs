import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && /WebGL|Shader|THREE/.test(message.text())) errors.push(message.text());
});
await page.goto('http://127.0.0.1:4176');
await expect(page.getByRole('button', { name: '即刻出发' })).toBeEnabled();
expect(await page.evaluate(() => typeof window.__kart)).toBe('undefined');
const models = {};
for (const model of ['classic-kart', 'kart', 'palm', 'rocks']) {
  const response = await page.request.get(new URL(`/models/${model}.glb`, page.url()).href);
  models[model] = response.status();
  expect(response.status()).toBe(200);
}
const circuits = [];
for (const name of ['海风环线', '落日峡谷']) {
  if (name === '落日峡谷') {
    await page.locator('.track-card').click();
    await page.getByRole('button', { name: `选择${name}`, exact: true }).click();
    await page.getByRole('button', { name: /就跑这里/ }).click();
    await expect(page.getByRole('button', { name: '即刻出发' })).toBeEnabled();
  }
  await expect(page.locator('.world > canvas')).toHaveCount(1);
  await expect(page.locator('.world > canvas')).toHaveAttribute('aria-label', `${name} 3D 赛车场景`);
  await page.getByRole('button', { name: '计时练习', exact: true }).click();
  await page.getByRole('button', { name: '即刻出发' }).click();
  if (name === '海风环线') await page.getByRole('button', { name: '明白了，出发！' }).click();
  await expect(page.locator('.countdown')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.race-lap')).toContainText(name);
  await page.keyboard.down('w');
  await page.waitForFunction(() => Number(document.querySelector('.speed strong')?.textContent) > 50);
  const speed = Number(await page.locator('.speed strong').textContent());
  await page.keyboard.press('Escape'); await page.keyboard.up('w');
  await expect(page.getByRole('dialog')).toContainText('比赛已暂停');
  await page.screenshot({ path: `docs/screenshots/phase3-production-${name === '海风环线' ? 'coastline' : 'canyon'}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await expect(page.locator('.countdown')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回俱乐部', exact: true }).click();
  circuits.push({ name, keyboardSpeedKmh: speed, pause: true, restart: true, singleCanvas: true });
}
await page.reload();
await expect(page.getByRole('button', { name: '即刻出发' })).toBeEnabled();
await expect(page.locator('.track-card')).toContainText('落日峡谷');
await page.getByRole('button', { name: /每一辆车/ }).click();
await expect(page.locator('.asset-list button')).toHaveCount(4);
await expect(page.locator('.model-preview')).toHaveAttribute('data-loaded', 'true');
await expect(page.getByRole('link', { name: '下载 GLB' })).toHaveAttribute('href', '/models/classic-kart.glb');
await page.screenshot({ path: 'docs/screenshots/phase3-production-workshop.png', animations: 'disabled' });
const report = { date: new Date().toISOString(), browser: browser.version(), models, circuits, trackPersists: true, staticWorkshop: true, debugHarness: false, errors };
await writeFile('docs/phase3-production-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
await browser.close();
expect(errors).toEqual([]);
