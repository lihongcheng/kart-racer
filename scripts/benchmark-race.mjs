import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const trackId = process.argv[2] === 'canyon' ? 'canyon' : 'coastline';
const phase = trackId === 'canyon' ? 'phase3' : 'phase2';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
const resourceWarnings = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const url = message.location().url;
  if (url?.endsWith('/favicon.ico')) resourceWarnings.add(`Missing browser tab icon: ${url}`);
  else errors.push(`${url}: ${message.text()}`);
});
await page.addInitScript(() => localStorage.setItem('coastline.settings', JSON.stringify({
  sound: false, quality: new URL(location.href).searchParams.get('quality'), motion: true, difficulty: 'normal', paint: 0,
  trackId: new URL(location.href).searchParams.get('track'),
})));
async function sample(duration) {
  return page.evaluate(duration => new Promise(resolve => {
    const frames = [], calls = [], triangles = [];
    let lowDetailFrames = 0, driftFrames = 0, peakParticles = 0, peakMarks = 0;
    const start = window.__kart?.snapshot(), started = performance.now();
    let last = started;
    function frame(now) {
      frames.push(now - last); last = now;
      const diagnostics = window.__kart?.diagnostics();
      if (diagnostics) {
        calls.push(diagnostics.renderer.calls); triangles.push(diagnostics.renderer.triangles);
        if (diagnostics.visuals.some(v => v.low)) lowDetailFrames++;
        if (window.__kart.snapshot().drifting) driftFrames++;
        peakParticles = Math.max(peakParticles, diagnostics.effects.activeParticles);
        peakMarks = Math.max(peakMarks, diagnostics.effects.marks);
      }
      if (now - started < duration) { requestAnimationFrame(frame); return; }
      const average = values => values.reduce((sum, n) => sum + n, 0) / values.length;
      const sorted = [...frames].sort((a, b) => a - b);
      const end = window.__kart?.snapshot();
      resolve({
        fps: +(1000 / average(frames)).toFixed(2),
        p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
        frames: frames.length, sampleSeconds: +((now - started) / 1000).toFixed(3),
        framesOver33ms: frames.filter(ms => ms > 33.34).length,
        drawCalls: calls.length ? +average(calls).toFixed(1) : null,
        triangles: triangles.length ? Math.round(average(triangles)) : null,
        lowDetailFrames, driftFrames, peakParticles, peakMarks,
        memory: diagnostics ? { ...diagnostics.memory } : null,
        race: start ? { elapsedFrom: start.elapsed, elapsedTo: end.elapsed, lapFrom: start.lap, lapTo: end.lap, racers: end.racers.length, phase: end.phase } : null,
      });
    }
    requestAnimationFrame(frame);
  }), duration);
}
const measurements = [];
for (const quality of ['high', 'low']) {
  await page.goto(`http://localhost:5174?quality=${quality}&track=${trackId}`);
  await page.waitForFunction(() => window.__kart?.snapshot().assets === 2);
  await page.evaluate(() => { window.__kart.start('race'); window.__kart.advance(4); window.__kart.autopilot(true); });
  await page.waitForFunction(() => window.__kart.snapshot().elapsed >= 2);
  // Real-time physics + rendering; no accelerated simulation during sampling.
  measurements.push({ quality, ...await sample(40_000) });
  if (quality === 'high') await page.screenshot({ path: `docs/screenshots/${phase}-race.png` });
  console.log(`${quality} race sample complete`);
}
await page.close();
const blankPage = await browser.newPage();
const blank = await blankPage.evaluate(() => new Promise(resolve => {
  const intervals = []; let last = performance.now();
  function frame(now) {
    intervals.push(now - last); last = now;
    if (intervals.length < 180) requestAnimationFrame(frame);
    else resolve(+(1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length)).toFixed(2));
  }
  requestAnimationFrame(frame);
}));
const report = {
  date: new Date().toISOString(), browser: browser.version(), headless: true,
  viewport: '1920x1080', deviceScaleFactor: 1, difficulty: 'normal', motion: true, trackId,
  blankPageBaselineFps: blank, measurements, errors, resourceWarnings: [...resourceWarnings],
};
await writeFile(`docs/performance-${phase}-race.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
await browser.close();
if (errors.length || measurements.some(m => m.race.phase !== 'racing' || m.race.elapsedTo - m.race.elapsedFrom < 39)) process.exitCode = 1;
