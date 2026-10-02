import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { getTrack } from '../apps/web/src/game/track.ts';

const browser = await chromium.launch({ channel: 'chrome' });
const calibration = [], measurements = [], errors = [];
try {
  for (const trackId of ['coastline', 'canyon']) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(trackId => localStorage.setItem('coastline.settings', JSON.stringify({
      trackId, difficulty: 'easy', quality: 'high', sound: false,
    })), trackId);
    await page.goto('http://localhost:5174');
    await page.waitForFunction(() => window.__kart?.snapshot().assets === 2);
    for (const difficulty of ['easy', 'normal']) {
      if (difficulty === 'normal') {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '返回俱乐部', exact: true }).click();
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByLabel('对手难度').selectOption(difficulty);
        await page.getByRole('button', { name: '关闭', exact: true }).click();
      }
      const result = await page.evaluate(() => {
        window.__kart.start('time');
        const solo = window.__kart.advance(360, true);
        window.__kart.start('race');
        const race = window.__kart.advance(360);
        return { solo: { total: solo.elapsed, laps: solo.lapTimes, phase: solo.phase },
          ai: race.racers.filter(r => r.name !== '你').map(r => ({ name: r.name, finishedAt: r.finishedAt })),
          diagnostics: window.__kart.diagnostics().racers.slice(1) };
      });
      calibration.push({ trackId, difficulty, medals: getTrack(trackId).medals, ...result });
      expect(result.solo.phase).toBe('finished');
      expect(result.ai.every(r => r.finishedAt !== null), JSON.stringify({ trackId, difficulty, ai: result.ai, diagnostics: result.diagnostics })).toBe(true);
    }
    for (const quality of process.argv.includes('--calibrate-only') ? [] : ['high', 'low']) {
      if (quality === 'low') {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '返回俱乐部', exact: true }).click();
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByLabel('画面质量').selectOption('low');
        await page.getByRole('button', { name: '关闭', exact: true }).click();
      }
      await page.evaluate(() => { window.__kart.start('race'); window.__kart.advance(4); window.__kart.autopilot(true); });
      await page.waitForFunction(() => window.__kart.snapshot().elapsed > 2);
      const sample = await page.evaluate(() => new Promise(resolve => {
        const frames = [], calls = [];
        const start = window.__kart.snapshot().elapsed, started = performance.now();
        let last = started;
        function frame(now) {
          frames.push(now - last); last = now;
          calls.push(window.__kart.diagnostics().renderer.calls);
          if (now - started < 20_000) { requestAnimationFrame(frame); return; }
          const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
          const sorted = [...frames].sort((a, b) => a - b);
          resolve({ fps: 1000 / mean(frames), p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
            frames: frames.length, drawCalls: mean(calls), elapsedFrom: start,
            elapsedTo: window.__kart.snapshot().elapsed, racers: window.__kart.snapshot().racers.length,
            diagnostics: window.__kart.diagnostics().racers });
        }
        requestAnimationFrame(frame);
      }));
      expect(sample.elapsedTo - sample.elapsedFrom).toBeGreaterThan(19.5);
      expect(sample.racers).toBe(6);
      measurements.push({ trackId, quality, ...sample });
      if (quality === 'high') await page.screenshot({ path: `docs/screenshots/phase5-traffic-${trackId}.png` });
      console.log(JSON.stringify({ trackId, quality, fps: sample.fps }));
    }
    await page.close();
  }
  const report = { date: new Date().toISOString(), browser: browser.version(), viewport: '1920x1080', headless: true,
    note: 'Scripted driving and AI baselines; not independent human playtesting. Render samples use real time, 20 seconds each.',
    calibration, measurements, errors };
  await writeFile('docs/phase5-calibration.json', JSON.stringify(report, null, 2) + '\n');
  expect(errors).toEqual([]);
} catch (error) {
  await writeFile('test-results/traffic-partial.json', JSON.stringify({ calibration, measurements, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
