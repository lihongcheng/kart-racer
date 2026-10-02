import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const label = process.argv[2] || 'current';
const browser = await chromium.launch({ channel: 'chrome' });
let page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function sample() {
  return page.evaluate(() => new Promise(resolve => {
    const frames = [], calls = [], triangles = [];
    let last = performance.now();
    function frame(now) {
      const d = window.__kart?.diagnostics();
      frames.push(now - last); last = now;
      if (d) { calls.push(d.renderer.calls); triangles.push(d.renderer.triangles); }
      if (frames.length < 90) { requestAnimationFrame(frame); return; }
      const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
      resolve({
        fps: +(1000 / avg(frames)).toFixed(2),
        p95FrameMs: +frames.sort((a, b) => a - b)[85].toFixed(2),
        drawCalls: calls.length ? +avg(calls).toFixed(1) : null,
        triangles: triangles.length ? Math.round(avg(triangles)) : null,
        memory: d ? { ...d.memory } : null,
      });
    }
    requestAnimationFrame(frame);
  }));
}
const measurements = [];
await page.addInitScript(() => localStorage.setItem('coastline.settings', JSON.stringify({
  sound: false, quality: new URL(location.href).searchParams.get('quality'), motion: false, difficulty: 'easy', paint: 0,
})));
for (const quality of ['high', 'low']) {
  await page.goto(`http://localhost:5174?quality=${quality}`);
  await page.waitForFunction(() => window.__kart?.snapshot().assets === 2);
  // Aerial menu has tiny distant racers and many repeated track decorations.
  measurements.push({ quality, scene: 'menu', ...await sample() });
  await page.evaluate(() => { window.__kart.start('race'); window.__kart.advance(4); window.__kart.pause(); });
  // Intentional one-second settling of the chase camera; race positions are frozen.
  await page.waitForTimeout(1000);
  measurements.push({ quality, scene: 'grid', ...await sample() });
}
await page.close();
page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const blank = await sample();
const report = {
  label, date: new Date().toISOString(), browser: browser.version(), headless: true,
  viewport: '1920x1080', deviceScaleFactor: 1, framesPerSample: 90,
  blankPageBaselineFps: blank.fps, measurements, errors,
};
await writeFile(`docs/performance-${label}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
await browser.close();
if (errors.length) process.exitCode = 1;
