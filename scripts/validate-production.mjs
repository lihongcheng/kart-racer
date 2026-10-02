import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';

// Serve only actual files under the repository prefix: SPA fallback must not mask a missing GLB.
const base = '/kart-racer/', root = resolve('dist');
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', glb: 'model/gltf-binary', wasm: 'application/wasm' };
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const file = resolve(root, decodeURIComponent(path.slice(base.length)) || 'index.html');
  if (!path.startsWith(base) || !file.startsWith(root + sep)) { response.writeHead(404).end(); return; }
  try { response.setHeader('Content-Type', types[file.split('.').at(-1)] ?? 'application/octet-stream'); response.end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
let url = process.argv[2];
if (!url) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}${base}`;
}
await mkdir('docs/screenshots', { recursive: true });
const ci = !!process.env.CI;
// Hosted Linux runners have no physical GPU; request Chromium's software renderer explicitly.
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || (ci ? undefined : 'chrome'),
  args: ci ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
const page = await browser.newPage({ viewport: ci ? { width: 1280, height: 720 } : { width: 1440, height: 900 } });
page.setDefaultTimeout(ci ? 60_000 : 30_000);
const readyTimeout = ci ? 30_000 : 5000;
const errors = [];
const forbiddenRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const requestUrl = new URL(request.url());
  if (requestUrl.origin === new URL(url).origin && /^\/(api|models|assets)\//.test(requestUrl.pathname)) forbiddenRequests.push(requestUrl.pathname);
  if (requestUrl.pathname.includes('/api/')) forbiddenRequests.push(requestUrl.pathname);
});
page.on('console', message => {
  if (message.type() === 'error' && /WebGL|Shader|THREE/.test(message.text())) errors.push(message.text());
});
try {
await page.goto(url);
await expect(page.getByRole('button', { name: '即刻出发' })).toBeEnabled({ timeout: readyTimeout });
expect(await page.evaluate(() => typeof window.__kart)).toBe('undefined');
const models = {};
for (const model of ['classic-kart', 'kart', 'palm', 'rocks']) {
  const response = await page.request.get(new URL(`models/${model}.glb`, page.url()).href);
  models[model] = response.status();
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 4).toString()).toBe('glTF');
}
const circuits = [];
for (const name of ['海风环线', '落日峡谷']) {
  if (name === '落日峡谷') {
    await page.locator('.track-card').click();
    await page.getByRole('button', { name: `选择${name}`, exact: true }).click();
    await page.getByRole('button', { name: /就跑这里/ }).click();
    await expect(page.getByRole('button', { name: '即刻出发' })).toBeEnabled({ timeout: readyTimeout });
  }
  await expect(page.locator('.world > canvas')).toHaveCount(1);
  await expect(page.locator('.world > canvas')).toHaveAttribute('aria-label', `${name} 3D 赛车场景`);
  await page.getByRole('button', { name: '计时练习', exact: true }).click();
  await page.getByRole('button', { name: '即刻出发' }).click();
  if (name === '海风环线') await page.getByRole('button', { name: '明白了，出发！' }).click();
  await expect(page.locator('.countdown')).toHaveCount(0, { timeout: ci ? 60_000 : 10_000 });
  await expect(page.locator('.race-lap')).toContainText(name);
  await page.keyboard.down('w');
  await page.waitForFunction(() => Number(document.querySelector('.speed strong')?.textContent) > 50);
  const speed = Number(await page.locator('.speed strong').textContent());
  await page.keyboard.press('Escape'); await page.keyboard.up('w');
  await expect(page.getByRole('dialog')).toContainText('比赛已暂停');
  await page.screenshot({ path: `docs/screenshots/phase4-production-${name === '海风环线' ? 'coastline' : 'canyon'}.png`, animations: 'disabled' });
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await expect(page.locator('.countdown')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回俱乐部', exact: true }).click();
  circuits.push({ name, keyboardSpeedKmh: speed, pause: true, restart: true, singleCanvas: true });
}
await page.reload();
await expect(page.getByRole('button', { name: '即刻出发' })).toBeEnabled({ timeout: readyTimeout });
await expect(page.locator('.track-card')).toContainText('落日峡谷');
await page.getByRole('button', { name: /每一辆车/ }).click();
await expect(page.locator('.asset-list button')).toHaveCount(4);
await expect(page.locator('.model-preview')).toHaveAttribute('data-loaded', 'true', { timeout: readyTimeout });
await expect(page.getByRole('link', { name: '下载 GLB' })).toHaveAttribute('href', `${new URL(url).pathname}models/classic-kart.glb`);
await expect(page.locator('.creator-panel')).toHaveCount(0);
for (const name of ['初代 Rodin 概念车', '海岛棕榈', '海岸砂岩']) {
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.locator('.model-preview')).toHaveAttribute('data-loaded', 'true', { timeout: readyTimeout });
  const href = await page.getByRole('link', { name: '下载 GLB' }).getAttribute('href');
  expect((await page.request.get(new URL(href, url).href)).status()).toBe(200);
}
await page.screenshot({ path: 'docs/screenshots/phase4-production-workshop.png', animations: 'disabled' });
const report = { date: new Date().toISOString(), browser: browser.version(), ci, viewport: page.viewportSize(), base: new URL(url).pathname, models, circuits,
  trackPersists: true, staticWorkshop: true, debugHarness: false, forbiddenRequests, errors };
await writeFile('docs/phase4-production-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
expect(forbiddenRequests).toEqual([]);
expect(errors).toEqual([]);
} catch (error) {
  await mkdir('test-results/production', { recursive: true });
  const ui = await page.evaluate(() => ({
    error: document.querySelector('.error-banner')?.textContent,
    countdown: document.querySelector('.countdown')?.textContent,
    speed: document.querySelector('.speed strong')?.textContent,
    phase: document.querySelector('.app')?.className,
  })).catch(() => null);
  const diagnostic = { message: error.message, stack: error.stack, url: page.url(), ui, errors, forbiddenRequests };
  await writeFile('test-results/production/failure.json', JSON.stringify(diagnostic, null, 2) + '\n');
  await page.screenshot({ path: 'test-results/production/failure.png', timeout: 5000 }).catch(() => {});
  // Public check annotations retain the actual failure even when log downloads require authentication.
  if (process.env.CI) console.error(`::error title=Static browser validation::${JSON.stringify(diagnostic).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
  throw error;
} finally {
await browser.close();
server.close();
}
