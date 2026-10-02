import { clamp, wrap } from './track';

export const AI_DIFFICULTIES = {
  easy: { cruise: 24, headway: 0.7, detect: 26, hold: 3 },
  normal: { cruise: 30, headway: 0.55, detect: 32, hold: 2.5 },
} as const;
export const AI_TUNING = { clearance: 2.9, passRadius: 2.6, standstillGap: 8, laneRate: 2.3, decisionInterval: 0.2, rearHorizon: 1.2 };
export type TrafficCar = { id: number; t: number; offset: number; speed: number };
export type AIState = {
  lane: number; targetLane: number; holdUntil: number; nextDecision: number;
  action: 'cruise' | 'follow' | 'pass'; targetSpeed: number; boostSafe: boolean;
  laneChanges: number; overtakes: number; passTarget: number | null;
};
export function newAI(lane: number): AIState {
  return { lane, targetLane: lane, holdUntil: 0, nextDecision: 0, action: 'cruise',
    targetSpeed: 0, boostSafe: true, laneChanges: 0, overtakes: 0, passTarget: null };
}
/** Signed local longitudinal distance, continuous across the finish line. */
export function trafficGap(from: number, to: number, length: number) {
  return (wrap(to - from + 0.5) - 0.5) * length;
}
export function planAI(state: AIState, self: TrafficCar, traffic: TrafficCar[], options: {
  length: number; width: number; curvature: number; difficulty: keyof typeof AI_DIFFICULTIES; now: number; dt: number;
}) {
  const { length, width, curvature, difficulty, now, dt } = options;
  const tune = AI_DIFFICULTIES[difficulty], safe = AI_TUNING;
  const cruise = Math.max(13, tune.cruise - self.id * 0.35 - curvature * 15);
  const cars = traffic.filter(c => c.id !== self.id).map(c => ({ ...c, gap: trafficGap(self.t, c.t, length) }));
  const laneLimit = Math.max(0, width / 2 - 2.8);
  const laneSafe = (lane: number) => cars.every(c => {
    const rearGap = 5 + Math.max(0, c.speed - self.speed) * safe.rearHorizon;
    const frontGap = 7 + Math.max(0, self.speed - c.speed) * 0.6;
    if (Math.abs(c.offset - lane) < safe.clearance && c.gap > -rearGap && c.gap < frontGap) return false;
    // A lane change sweeps a corridor; never cut through an alongside car.
    // The car being passed is behind the outward sweep, not inside it.
    const departing = c.gap > 0 && Math.abs(self.offset - c.offset) < safe.clearance &&
      Math.abs(lane - c.offset) > Math.abs(self.offset - c.offset);
    return !(c.offset > Math.min(self.offset, lane) - safe.clearance &&
      c.offset < Math.max(self.offset, lane) + safe.clearance && Math.abs(c.gap) < 4.5 && !departing);
  });
  const lead = cars.filter(c => c.gap > 0 && c.gap < tune.detect &&
    (Math.abs(c.offset - self.offset) < safe.clearance || Math.abs(c.offset - state.lane) < safe.clearance))
    .sort((a, b) => a.gap - b.gap)[0];
  if (state.passTarget !== null) {
    const passed = cars.find(c => c.id === state.passTarget);
    if (passed && passed.gap < -5 && Math.abs(passed.offset - self.offset) >= safe.clearance) {
      state.overtakes++; state.passTarget = null;
    }
  }
  if (now >= state.nextDecision) {
    state.nextDecision = now + safe.decisionInterval;
    // Re-check a committed change if a fast car enters its corridor.
    if (Math.abs(state.targetLane - self.offset) > 1 && !laneSafe(state.targetLane)) {
      state.targetLane = clamp(self.offset, -laneLimit, laneLimit); state.holdUntil = now + 0.6; state.passTarget = null;
    }
    if (lead && lead.speed < cruise - 1 && now >= state.holdUntil) {
      const candidates = [lead.offset - 3.4, lead.offset + 3.4, -3.6, 0, 3.6].map(l => clamp(l, -laneLimit, laneLimit))
        .filter(l => Math.abs(l - lead.offset) >= safe.clearance && laneSafe(l))
        .sort((a, b) => Math.abs(a - self.offset) - Math.abs(b - self.offset));
      if (candidates.length && Math.abs(candidates[0] - state.targetLane) > 0.2) {
        state.targetLane = candidates[0]; state.holdUntil = now + tune.hold;
        state.laneChanges++; state.passTarget = lead.id;
      }
    }
  }
  state.lane += clamp(state.targetLane - state.lane, -safe.laneRate * dt, safe.laneRate * dt);
  state.lane = clamp(state.lane, -laneLimit, laneLimit);
  state.targetSpeed = cruise;
  state.action = state.passTarget !== null ? 'pass' : 'cruise';
  // Respect both the current physical path and the intended lane until separated.
  const blockers = cars.filter(c => c.gap > 0 && c.gap < tune.detect &&
    (Math.abs(c.offset - self.offset) < safe.clearance || Math.abs(c.offset - state.lane) < safe.clearance));
  for (const c of blockers) {
    const changing = state.passTarget === c.id && Math.abs(state.targetLane - c.offset) >= safe.clearance && laneSafe(state.targetLane);
    const lateralGap = Math.abs(self.offset - c.offset);
    const desiredGap = changing ? Math.sqrt(Math.max(0, safe.passRadius ** 2 - lateralGap * lateralGap)) + Math.max(0, self.speed) * 0.2
      : safe.standstillGap + Math.max(0, self.speed) * tune.headway;
    const followSpeed = Math.max(0, c.speed + (c.gap - desiredGap) * 0.85);
    if (followSpeed < state.targetSpeed) { state.targetSpeed = followSpeed; if (state.passTarget === null) state.action = 'follow'; }
  }
  state.boostSafe = curvature < 0.15 && state.action === 'cruise' && cars.every(c =>
    Math.abs(c.gap) > 6 && !(c.gap > 0 && c.gap < 40 &&
      (Math.abs(c.offset - self.offset) < 3.5 || Math.abs(c.offset - state.targetLane) < 3.5)));
  return state;
}
