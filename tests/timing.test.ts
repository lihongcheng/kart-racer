import { describe, expect, it } from 'vitest';
import { FixedClock } from '../apps/web/src/game/rules';
import { emptyResults } from '../apps/web/src/game/results';
import { compareSectors, emptyTiming, MAX_REPLAY_FRAMES, parseTiming, recordSector, ReplayRecorder, replayPose, saveTimeRun,
  type Frame, type Pose, type TimeRun } from '../apps/web/src/game/timing';

const pose: Pose = { x: 0, y: 1, z: 0, yaw: 0, steer: 0, speed: 20, flags: 0 };
const frame = (time: number, x = time, cut = 0): Frame => [time, x, 1, 0, 0, 0, 20, 0, cut];
const run = (): TimeRun => ({ revision: 1, trackId: 'coastline', total: 90,
  ends: Array.from({ length: 9 }, (_, i) => (i + 1) * 10), frames: [frame(0), frame(90)] });
const results = () => ({ ...emptyResults(), bests: { 'coastline:time': { time: 90, bestLap: 30, rank: 1 } } });
const raw = (r = run()) => JSON.stringify({ version: 1, bests: { coastline: r } });

describe('timing and deterministic replay', () => {
  it('records exactly nine ordered gates and split durations sum to the finish', () => {
    const ends: number[] = [];
    for (let passed = 0; passed <= 72; passed++) {
      recordSector(ends, passed, passed * 1.1);
      recordSector(ends, passed, passed * 1.1 + 0.1);
    }
    expect(ends).toHaveLength(9);
    const rows = compareSectors(ends, ends.map(t => t + 2));
    expect(rows.reduce((sum, r) => sum + r.duration, 0)).toBeCloseTo(79.2);
    expect(rows[0].delta).toBe(-2); expect(rows[1].delta).toBe(0);
    expect(rows.at(-1)?.cumulative).toBe(-2);
    expect(compareSectors(ends)[0].delta).toBeNull();
  });
  it('30/60/120 Hz rendering produces identical samples at fixed physics time', () => {
    const frames = [30, 60, 120].map(fps => {
      const clock = new FixedClock(), recorder = new ReplayRecorder();
      let elapsed = 0;
      recorder.capture(0, pose, true);
      for (let i = 0; i < fps * 4; i++) clock.consume(1 / fps, dt => {
        elapsed += dt; recorder.capture(elapsed, { ...pose, x: elapsed * 20 });
      });
      return recorder.frames;
    });
    expect(frames[0]).toEqual(frames[1]); expect(frames[1]).toEqual(frames[2]);
    expect(replayPose(frames[0], 1.125)?.x).toBeCloseTo(22.5);
  });
  it('takes the shortest path across ±pi', () => {
    const a = frame(0), b = frame(1); a[4] = Math.PI - 0.1; b[4] = -Math.PI + 0.1;
    expect(replayPose([a, b], 0.5)?.yaw).toBeCloseTo(Math.PI);
  });
  it('cuts at reset without crossing the track, then holds for the two-second penalty', () => {
    const recorder = new ReplayRecorder();
    recorder.capture(0, pose, true);
    recorder.capture(1, { ...pose, x: 20 }, true);
    recorder.capture(1, { ...pose, x: 200, speed: 0 }, true, true);
    recorder.capture(3, { ...pose, x: 200, speed: 0 }, true);
    recorder.capture(4, { ...pose, x: 210 }, true);
    expect(replayPose(recorder.frames, 0.9)?.x).toBe(0);
    expect(replayPose(recorder.frames, 1)?.x).toBe(200);
    expect(replayPose(recorder.frames, 2)?.x).toBe(200);
    expect(replayPose(recorder.frames, 3.5)?.x).toBe(205);
    expect(recorder.frames.filter(f => f[0] === 1)).toHaveLength(1);
  });
  it('pause, restart, and boundary lookup do not depend on wall clock', () => {
    const frames = [frame(0), frame(10)];
    expect(replayPose(frames, 3)).toEqual(replayPose(frames, 3));
    expect(replayPose(frames, 0)?.x).toBe(0);
    expect(replayPose(frames, 10)?.x).toBe(10);
    for (const t of [-1, 11, NaN, Infinity]) expect(replayPose(frames, t)).toBeNull();
    expect(replayPose([], 0)).toBeNull();
  });
  it('drops incomplete replay on duration or sample overflow', () => {
    const recorder = new ReplayRecorder(); recorder.capture(0, pose);
    recorder.capture(901, pose); expect(recorder.limited).toBe(true); expect(recorder.frames).toEqual([]);
    recorder.capture(902, pose); expect(recorder.frames).toEqual([]);
    const dense = new ReplayRecorder();
    for (let i = 0; i <= MAX_REPLAY_FRAMES; i++) dense.capture(i / 100, pose, true);
    expect(dense.limited).toBe(true); expect(dense.frames).toEqual([]);
    const long = { ...run(), total: 990, ends: run().ends.map(n => n * 11), frames: null };
    expect(saveTimeRun(emptyTiming(), long).bests.coastline?.ends).toHaveLength(9);
  });
});
describe('best-run storage', () => {
  it('round-trips a matching personal best', () => {
    expect(parseTiming(raw(), results()).bests.coastline).toEqual(run());
  });
  it('keeps legacy bests without inventing a replay', () => {
    expect(parseTiming(null, results())).toEqual(emptyTiming());
    expect(saveTimeRun(emptyTiming(), run(), 80)).toEqual(emptyTiming());
  });
  it('ignores slower or tied runs and preserves the frozen previous reference', () => {
    const previous = run(), store = saveTimeRun(emptyTiming(), previous);
    expect(saveTimeRun(store, run(), 90)).toBe(store);
    const faster = { ...run(), total: 81, ends: run().ends.map(t => t * 0.9), frames: null };
    const next = saveTimeRun(store, faster, 90);
    expect(next.bests.coastline?.total).toBe(81); expect(previous.total).toBe(90);
  });
  it('isolates tracks, revision and independently persisted result times', () => {
    for (const r of [{ ...run(), trackId: 'canyon' as const }, { ...run(), revision: 2 }, { ...run(), total: 89 }]) {
      expect(parseTiming(raw(r), results())).toEqual(emptyTiming());
    }
    expect(parseTiming(raw(), emptyResults())).toEqual(emptyTiming());
  });
  it('rejects corrupt sectors or top-level data without throwing', () => {
    for (const data of ['broken', 'null', '{"version":2}', raw({ ...run(), ends: [10] }),
      raw({ ...run(), ends: [10, 20, 20, 40, 50, 60, 70, 80, 90] })]) {
      expect(parseTiming(data, results())).toEqual(emptyTiming());
    }
  });
  it('retains valid splits while discarding malformed replay', () => {
    const bad: Frame[][] = [[frame(1), frame(90)], [frame(0), frame(89)], [frame(0), frame(0), frame(90)],
      [frame(0), [...frame(90).slice(0, 8), 2] as Frame], [frame(0), [90, NaN, 1, 0, 0, 0, 20, 0, 0]],
      Array.from({ length: MAX_REPLAY_FRAMES + 1 }, (_, i) => frame(i / 200))];
    for (const frames of bad) {
      const stored = parseTiming(raw({ ...run(), frames }), results()).bests.coastline;
      expect(stored?.ends).toHaveLength(9); expect(stored?.frames).toBeNull();
    }
  });
});
