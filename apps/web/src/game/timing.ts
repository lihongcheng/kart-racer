import { CHECKPOINTS, TRACKS, type TrackId } from './track';
import { resultKey, type Results } from './results';

export const TIMING_KEY = 'coastline.timing.v1';
// Increment when track checkpoints or driving rules change.
export const REPLAY_REVISION = 1;
export const MAX_REPLAY_SECONDS = 900;
export const MAX_REPLAY_FRAMES = 10_000;
export type Pose = { x: number; y: number; z: number; yaw: number; steer: number; speed: number; flags: number };
export type Frame = [time: number, x: number, y: number, z: number, yaw: number, steer: number, speed: number, flags: number, cut: number];
export type TimeRun = { revision: number; trackId: TrackId; total: number; ends: number[]; frames: Frame[] | null };
export type TimingStore = { version: 1; bests: Partial<Record<TrackId, TimeRun>> };
export const emptyTiming = (): TimingStore => ({ version: 1, bests: {} });
const sameTime = (a: number, b: number) => Math.abs(a - b) < 0.0001;
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** Called after ordered checkpoint advancement; repeats cannot create extra splits. */
export function recordSector(ends: number[], passed: number, elapsed: number) {
  if (ends.length < 9 && passed === (ends.length + 1) * (CHECKPOINTS / 3) && elapsed > (ends.at(-1) ?? 0)) ends.push(elapsed);
}
export function compareSectors(ends: number[], reference?: number[]) {
  return ends.map((end, i) => {
    const duration = end - (ends[i - 1] ?? 0);
    const baseline = reference?.[i];
    return { lap: Math.floor(i / 3) + 1, sector: i % 3 + 1, duration,
      delta: baseline === undefined ? null : duration - (baseline - (reference?.[i - 1] ?? 0)),
      cumulative: baseline === undefined ? null : end - baseline };
  });
}
export function formatDelta(delta: number | null) {
  if (delta === null) return '—';
  return `${delta < -0.0005 ? '−' : '+'}${Math.abs(delta).toFixed(2)}s`;
}

export class ReplayRecorder {
  frames: Frame[] = [];
  limited = false;
  capture(time: number, pose: Pose, force = false, cut = false) {
    if (this.limited) return;
    if (time > MAX_REPLAY_SECONDS || this.frames.length >= MAX_REPLAY_FRAMES) {
      this.frames = []; this.limited = true; return;
    }
    const last = this.frames.at(-1);
    if (!force && last && time - last[0] < 0.1 - 0.0001) return;
    const frame: Frame = [round(time), round(pose.x), round(pose.y), round(pose.z), round(pose.yaw),
      round(pose.steer), round(pose.speed), pose.flags, +cut];
    if (last && sameTime(frame[0], last[0])) {
      frame[8] = Math.max(frame[8], last[8]);
      this.frames[this.frames.length - 1] = frame;
    } else this.frames.push(frame);
  }
}

/** Binary lookup and shortest-angle interpolation, entirely driven by race time. */
export function replayPose(frames: Frame[], time: number): Pose | null {
  if (!frames.length || !Number.isFinite(time) || time < 0 || time > frames.at(-1)![0] + 0.0001) return null;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid][0] <= time) lo = mid; else hi = mid - 1;
  }
  const a = frames[lo], b = frames[Math.min(lo + 1, frames.length - 1)];
  const f = b[8] || a === b ? 0 : Math.max(0, Math.min(1, (time - a[0]) / (b[0] - a[0])));
  const lerp = (i: number) => a[i] + (b[i] - a[i]) * f;
  const yaw = a[4] + Math.atan2(Math.sin(b[4] - a[4]), Math.cos(b[4] - a[4])) * f;
  return { x: lerp(1), y: lerp(2), z: lerp(3), yaw, steer: lerp(5), speed: lerp(6), flags: a[7] };
}
function validEnds(ends: unknown, total: number): ends is number[] {
  return Array.isArray(ends) && ends.length === 9 && ends.every((n, i) => Number.isFinite(n) && n > (ends[i - 1] ?? 0)) && sameTime(ends[8], total);
}
function validFrames(frames: unknown, total: number): frames is Frame[] {
  return total <= MAX_REPLAY_SECONDS && Array.isArray(frames) && frames.length >= 2 && frames.length <= MAX_REPLAY_FRAMES &&
    frames.every((f, i) => Array.isArray(f) && f.length === 9 && f.every(Number.isFinite) &&
      f[0] >= 0 && (i === 0 || f[0] > frames[i - 1][0]) && f[0] <= MAX_REPLAY_SECONDS &&
      f.slice(1, 5).every((n: number) => Math.abs(n) < 100_000) && Math.abs(f[5]) <= 1.001 && Math.abs(f[6]) <= 100 &&
      Number.isInteger(f[7]) && f[7] >= 0 && f[7] <= 7 && (f[8] === 0 || f[8] === 1)) &&
    frames[0][0] === 0 && sameTime(frames.at(-1)[0], total);
}
export function parseTiming(raw: string | null, results: Results): TimingStore {
  const store = emptyTiming();
  try {
    // Bound parsing cost as well as the number of accepted samples.
    if (!raw || raw.length > 3_000_000) return store;
    const data = JSON.parse(raw);
    if (data?.version !== 1) return store;
    for (const track of TRACKS) {
      const r = data.bests?.[track.id], best = results.bests[resultKey(track.id, 'time')];
      if (!r || !best || r.trackId !== track.id || r.revision !== REPLAY_REVISION ||
        !Number.isFinite(r.total) || !sameTime(r.total, best.time) || !validEnds(r.ends, r.total)) continue;
      store.bests[track.id] = { revision: REPLAY_REVISION, trackId: track.id, total: r.total, ends: r.ends,
        frames: validFrames(r.frames, r.total) ? r.frames : null };
    }
  } catch { /* Invalid optional data must never prevent a race. */ }
  return store;
}
export function saveTimeRun(store: TimingStore, run: TimeRun, previousBest?: number): TimingStore {
  if ((previousBest !== undefined && run.total >= previousBest) || !validEnds(run.ends, run.total)) return store;
  return { version: 1, bests: { ...store.bests, [run.trackId]: run } };
}
