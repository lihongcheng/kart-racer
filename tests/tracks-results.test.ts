import { describe, expect, it } from 'vitest';
import { CHECKPOINTS, getTrack, TRACKS, wrap } from '../apps/web/src/game/track';
import { advanceProgress, newProgress } from '../apps/web/src/game/rules';
import { addResult, emptyResults, medalFor, nextMedal, parseResults, resultKey, type RecordEntry } from '../apps/web/src/game/results';

describe.each(TRACKS)('$name geometry', track => {
  it('projects centreline and both lanes consistently, including the start seam', () => {
    for (let n = 0; n < 200; n++) {
      const t = n / 200, frame = track.at(t);
      for (const lane of [-3, 0, 3]) {
        const p = frame.position.clone().addScaledVector(frame.right, lane), projection = track.project(p.x, p.z);
        const delta = Math.abs(projection.progress - t);
        expect(Math.min(delta, 1 - delta)).toBeLessThan(0.0003);
        expect(projection.offset).toBeCloseTo(lane, 1);
      }
      const map = track.mapPosition(frame.position.x, frame.position.z);
      expect(map.x).toBeGreaterThan(8); expect(map.x).toBeLessThan(212);
      expect(map.y).toBeGreaterThan(8); expect(map.y).toBeLessThan(172);
    }
    expect(track.at(0).position.distanceTo(track.at(1).position)).toBeLessThan(1e-8);
  });
  it('keeps separated road sections wider apart than the road surface', () => {
    // Two nonlocal segments cannot cross or overlap if their dense samples stay apart.
    const points = track.points, stepLength = track.length / points.length;
    let separation = Infinity;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const along = Math.min(j - i, points.length - (j - i)) * stepLength;
      if (along < 32) continue;
      separation = Math.min(separation, Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z));
    }
    expect(separation).toBeGreaterThan(track.width + 2 * stepLength);
  });
  it('visits every ordered gate and completes three projected laps', () => {
    const state = newProgress(0.99);
    for (let i = 0; i <= 3000; i++) {
      const p = track.at(wrap(i / 1000));
      advanceProgress(state, track.project(p.position.x, p.position.z).progress, i / 10, true);
    }
    expect(state.passed).toBe(CHECKPOINTS * 3);
    expect(state.lapTimes).toHaveLength(3);
    expect(state.finishedAt).toBeCloseTo(300, 0);
  });
});

const record = (changes: Partial<RecordEntry> = {}): RecordEntry => ({
  trackId: 'coastline', mode: 'race', date: '2026-10-01T12:00:00.000Z', time: 130, bestLap: 42, rank: 3, ...changes,
});
describe('medals and persistent results', () => {
  it.each(TRACKS)('uses inclusive time thresholds for $name and rank awards for races', track => {
    for (const medal of ['gold', 'silver', 'bronze'] as const) {
      expect(medalFor(track.id, 'time', record({ time: track.medals[medal] }))).toBe(medal);
      expect(medalFor(track.id, 'time', record({ time: track.medals[medal] + 0.001 }))).not.toBe(medal);
    }
    expect(medalFor(track.id, 'race', record({ rank: 1 }))).toBe('gold');
    expect(medalFor(track.id, 'race', record({ rank: 2 }))).toBe('silver');
    expect(medalFor(track.id, 'race', record({ rank: 3 }))).toBe('silver');
    expect(medalFor(track.id, 'race', record({ rank: 4 }))).toBe('bronze');
    expect(medalFor(track.id, 'race', record({ rank: 6 }))).toBe('bronze');
    expect(nextMedal(track.id, 'time', 'none')?.target).toBe(track.medals.bronze);
    expect(nextMedal(track.id, 'race', 'silver')?.target).toBe(1);
    expect(nextMedal(track.id, 'time', 'gold')).toBeNull();
  });
  it('migrates old records to coastline and keeps the old best even beyond history limit', () => {
    const old = Array.from({ length: 35 }, (_, i) => {
      const { trackId, ...entry } = record({ time: i === 34 ? 90 : 130, bestLap: i === 34 ? 28 : 42 });
      return entry;
    });
    const results = parseResults(null, JSON.stringify(old));
    expect(results.history).toHaveLength(30);
    expect(results.history.every(r => r.trackId === 'coastline')).toBe(true);
    expect(results.bests['coastline:race']?.time).toBe(90);
  });
  it('isolates all four competitions and retains best time, lap and medal after 30 slower races', () => {
    let results = emptyResults();
    for (const t of TRACKS) for (const mode of ['race', 'time'] as const) {
      results = addResult(results, record({ trackId: t.id, mode, time: t.medals.gold, bestLap: 30, rank: 1 }));
    }
    for (let n = 0; n < 35; n++) results = addResult(results, record({ time: 200, bestLap: 60, rank: 6 }));
    results = parseResults(JSON.stringify(results));
    expect(results.history).toHaveLength(30);
    expect(Object.keys(results.bests)).toHaveLength(4);
    for (const t of TRACKS) for (const mode of ['race', 'time'] as const) {
      const best = results.bests[resultKey(t.id, mode)]!;
      expect(best.time).toBe(t.medals.gold); expect(best.bestLap).toBe(30);
      expect(medalFor(t.id, mode, best)).toBe('gold');
    }
  });
  it('rejects malformed fields and prefers v2 instead of resurrecting a legacy backup', () => {
    const invalid = [
      record({ trackId: 'unknown' as never }), record({ date: 'bad' }), record({ time: -1 }),
      record({ bestLap: 0 }), record({ bestLap: 300 }), record({ rank: 0 }), record({ rank: 7 }),
      record({ mode: 'other' as never }), record({ mode: 'time', rank: 2 }), null,
    ];
    const results = parseResults(JSON.stringify({ version: 2, history: [...invalid, record()], bests: { 'canyon:time': { time: 0, bestLap: 0, rank: 1 } } }));
    expect(results.history).toEqual([record()]);
    expect(results.bests['canyon:time']).toBeUndefined();
    expect(parseResults(JSON.stringify(emptyResults()), JSON.stringify([record()]))).toEqual(emptyResults());
    for (const raw of ['null', '{', '{}', '{"version":3,"history":[]}']) expect(parseResults(raw)).toEqual(emptyResults());
    expect(getTrack('unknown').id).toBe('coastline');
  });
  it('does not mutate prior results and reconstructs missing bests from valid history', () => {
    const previous = addResult(emptyResults(), record({ bestLap: 39, rank: 1 }));
    const next = addResult(previous, record({ time: 120, bestLap: 40 }));
    expect(previous.history).toHaveLength(1);
    expect(next.bests['coastline:race']).toEqual({ time: 120, bestLap: 39, rank: 1 });
    expect(parseResults(JSON.stringify({ ...next, bests: null })).bests).toEqual(next.bests);
  });
});
