import { CHECKPOINTS, wrap } from './track';

export type ProgressState = {
  passed: number;
  previous: number;
  lapTimes: number[];
  lapStarted: number;
  finishedAt: number | null;
};

export function newProgress(start = 0): ProgressState {
  return { passed: 0, previous: start, lapTimes: [], lapStarted: 0, finishedAt: null };
}

/** Checkpoint zero is the start gate. A full lap requires all other gates in order. */
export function advanceProgress(state: ProgressState, progress: number, elapsed: number, onTrack: boolean) {
  const previous = state.previous;
  state.previous = progress;
  if (!onTrack || state.finishedAt !== null) return false;
  let delta = progress - previous;
  if (delta < -0.5) delta += 1;
  if (delta > 0.5) delta -= 1;
  if (delta <= 0 || delta > 0.04) return false;
  const next = wrap((state.passed + 1) / CHECKPOINTS);
  const distance = wrap(next - previous);
  if (distance > delta + 1e-7 || distance === 0) return false;
  state.passed++;
  if (state.passed % CHECKPOINTS === 0) {
    state.lapTimes.push(elapsed - state.lapStarted);
    state.lapStarted = elapsed;
    if (state.passed >= 3 * CHECKPOINTS) state.finishedAt = elapsed;
    return true;
  }
  return false;
}

export function raceProgress(state: ProgressState, progress: number) {
  const last = wrap(state.passed / CHECKPOINTS);
  const within = Math.min(wrap(progress - last) * CHECKPOINTS, 0.999);
  return state.passed + within;
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '—';
  const centis = Math.floor(Math.max(0, seconds) * 100);
  return `${Math.floor(centis / 6000).toString().padStart(2, '0')}:${Math.floor(centis / 100) % 60 < 10 ? '0' : ''}${Math.floor(centis / 100) % 60}.${(centis % 100).toString().padStart(2, '0')}`;
}

export class FixedClock {
  accumulator = 0;
  step = 1 / 60;
  consume(delta: number, tick: (dt: number) => void) {
    this.accumulator += Math.min(Math.max(delta, 0), 0.1);
    while (this.accumulator + 1e-10 >= this.step) {
      tick(this.step);
      this.accumulator -= this.step;
    }
    return Math.max(0, this.accumulator / this.step);
  }
  reset() { this.accumulator = 0; }
}
