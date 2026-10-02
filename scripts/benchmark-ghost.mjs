import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const measurements = [];
try {
  for (const quality of ['high', 'low']) {
    await page.addInitScript(quality => localStorage.setItem('coastline.settings', JSON.stringify({
      quality, trackId: 'canyon', sound: false, difficulty: 'normal', ghost: true,
    })), quality);
    await page.goto('http://localhost:5174');
    await page.waitForFunction(() => window.__kart?.snapshot().assets === 2);
    await page.evaluate(() => {
      window.__kart.start('time'); window.__kart.advance(300, true);
      window.__kart.start('time'); window.__kart.advance(4.1); window.__kart.autopilot(true);
    });
    await page.waitForFunction(() => window.__kart.snapshot().elapsed > 2 && window.__kart.diagnostics().ghost.visible);
    const sample = await page.evaluate(() => new Promise(resolve => {
      const intervals = [], calls = [], triangles = [];
      let visible = 0;
      const start = window.__kart.snapshot().elapsed, started = performance.now();
      let last = started;
      function frame(now) {
        intervals.push(now - last); last = now;
        const d = window.__kart.diagnostics();
        calls.push(d.renderer.calls); triangles.push(d.renderer.triangles);
        if (d.ghost.visible) visible++;
        if (now - started < 20_000) { requestAnimationFrame(frame); return; }
        const mean = array => array.reduce((a, b) => a + b, 0) / array.length;
        const sorted = [...intervals].sort((a, b) => a - b);
        resolve({ fps: +(1000 / mean(intervals)).toFixed(2), p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
          frames: intervals.length, ghostVisibleFrames: visible, drawCalls: mean(calls), triangles: Math.round(mean(triangles)),
          elapsedFrom: start, elapsedTo: window.__kart.snapshot().elapsed, phase: window.__kart.snapshot().phase,
          recordedSamples: d.ghost.samples, memory: d.memory });
      }
      requestAnimationFrame(frame);
    }));
    expect(sample.ghostVisibleFrames).toBe(sample.frames);
    expect(sample.elapsedTo - sample.elapsedFrom).toBeGreaterThan(19.5);
    expect(sample.phase).toBe('racing');
    if (quality === 'high') await page.screenshot({ path: 'docs/screenshots/phase4-ghost-race.png' });
    measurements.push({ quality, ...sample });
    console.log(JSON.stringify({ quality, fps: sample.fps, ghostVisibleFrames: sample.ghostVisibleFrames }));
  }
  const report = { date: new Date().toISOString(), browser: browser.version(), viewport: '1920x1080',
    headless: true, trackId: 'canyon', mode: 'time', measurements, errors };
  await writeFile('docs/performance-phase4-ghost.json', JSON.stringify(report, null, 2) + '\n');
  expect(errors).toEqual([]);
} finally { await browser.close(); }
