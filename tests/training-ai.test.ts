import { describe, expect, it } from 'vitest';
import { advanceTraining, newTraining, parseTraining, type TrainingFrame } from '../apps/web/src/game/training';
import { drive, idleInput, newDrive } from '../apps/web/src/game/driving';
import { AI_DIFFICULTIES, newAI, planAI, trafficGap, type TrafficCar } from '../apps/web/src/game/ai';

describe('driving school', () => {
  it('requires real acceleration, held drift, release boost and nitro consumption in order', () => {
    const state = newTraining(), d = newDrive(0);
    const frame: TrainingFrame = { drive: d, input: { ...idleInput(), throttle: 1 }, offroad: false, collision: false, miniStarted: false, nitroStarted: false };
    const step = () => {
      const mini = d.miniTime, nitro = d.boostTime;
      drive(d, frame.input, 1 / 60, false, false);
      frame.miniStarted = d.miniTime > mini; frame.nitroStarted = d.boostTime > nitro;
      advanceTraining(state, frame);
    };
    for (let i = 0; i < 60; i++) step();
    expect(state.completed).toBe(1);
    frame.input.drift = true; frame.input.steer = 0.5;
    for (let i = 0; i < 40; i++) step();
    expect(state.completed).toBe(2);
    frame.input.drift = false; step();
    expect(state.completed).toBe(3);
    frame.input.boost = true; step(); // Empty tank cannot complete the lesson.
    expect(state.completed).toBe(3);
    d.cans = 1; frame.input.boost = false; step(); frame.input.boost = true; step();
    expect(state.completed).toBe(4); expect(d.cans).toBe(0);
    for (let i = 0; i < 20; i++) step();
    expect(state.completed).toBe(4);
  });
  it.each(['offroad', 'collision', 'slow', 'noSteer', 'earlyRelease'] as const)('rejects invalid drift: %s', reason => {
    const state = newTraining(1), d = newDrive(0); d.vz = reason === 'slow' ? 3 : 20;
    const input = { ...idleInput(), throttle: 1, drift: reason !== 'earlyRelease', steer: reason === 'noSteer' ? 0 : 0.5 };
    drive(d, input, 1 / 60, reason === 'offroad', reason === 'collision');
    advanceTraining(state, { drive: d, input, offroad: reason === 'offroad', collision: reason === 'collision', miniStarted: false, nitroStarted: false });
    expect(state.completed).toBe(1);
    expect(state.hint.length).toBeGreaterThan(10);
  });
  it('ignores raw boost button presses, coasting acceleration and unsafe events', () => {
    const frame: TrainingFrame = { drive: { ...newDrive(0), speed: 20 }, input: { ...idleInput(), boost: true }, offroad: false, collision: false, miniStarted: false, nitroStarted: false };
    for (const completed of [0, 2, 3]) {
      const state = newTraining(completed); advanceTraining(state, frame); expect(state.completed).toBe(completed);
    }
    const state = newTraining(3);
    advanceTraining(state, { ...frame, offroad: true, nitroStarted: true });
    expect(state.completed).toBe(3);
  });
  it('loads only a valid versioned completed prefix; a completed course can be replayed', () => {
    for (const completed of [0, 1, 2, 3, 4]) expect(parseTraining(JSON.stringify({ version: 1, completed }))).toBe(completed);
    for (const raw of [null, '{', 'null', '{}', '{"version":2,"completed":3}', '{"version":1,"completed":8}', '{"version":1,"completed":1.5}']) expect(parseTraining(raw)).toBe(0);
    expect(newTraining(4).completed).toBe(0);
    expect(newTraining(2).completed).toBe(2);
  });
});

describe('AI traffic planning', () => {
  const self: TrafficCar = { id: 1, t: 0.2, offset: 0, speed: 24 };
  const car = (id: number, gap: number, offset: number, speed = 10): TrafficCar => ({ id, t: self.t + gap / 1000, offset, speed });
  const options = { length: 1000, width: 15, curvature: 0, difficulty: 'normal' as const, now: 1, dt: 1 / 60 };
  it('chooses a safe passing line, moves gradually and counts a completed pass once', () => {
    const state = newAI(0);
    planAI(state, self, [self, car(0, 18, 0)], options);
    expect(Math.abs(state.targetLane)).toBe(3.4); expect(Math.abs(state.lane)).toBeLessThan(0.1);
    expect(state.action).toBe('pass'); expect(state.boostSafe).toBe(false);
    const selected = state.targetLane;
    planAI(state, self, [car(0, 20, 0)], { ...options, now: 1.3 });
    expect(state.targetLane).toBe(selected); expect(state.laneChanges).toBe(1);
    const ahead = { ...self, offset: selected };
    planAI(state, ahead, [car(0, -7, 0)], { ...options, now: 4 });
    planAI(state, ahead, [car(0, -9, 0)], { ...options, now: 4.2 });
    expect(state.overtakes).toBe(1);
  });
  it('rejects a fast rear car and passes on the other side', () => {
    const state = newAI(0);
    planAI(state, self, [car(0, 18, 0), car(2, -10, -3.6, 40)], options);
    expect(state.targetLane).toBe(3.4);
  });
  it('keeps moving outward as the passed car gets closer, without treating it as a crossing obstacle', () => {
    const state = newAI(0);
    planAI(state, self, [car(0, 18, 0)], options);
    const chosen = state.targetLane;
    planAI(state, { ...self, offset: -2, speed: 3 }, [car(0, 4, 0, 0)], { ...options, now: 2 });
    expect(state.targetLane).toBe(chosen);
    expect(state.targetSpeed).toBeGreaterThan(0);
    expect(state.action).toBe('pass');
  });
  it('adjusts a nearly clear target lane instead of deadlocking beside a stationary queue', () => {
    const state = newAI(-3.6);
    planAI(state, { ...self, offset: -3.7, speed: 0 }, [car(0, 1.4, -0.72, 0)], options);
    expect(state.targetLane).toBeLessThan(-4);
    expect(state.targetSpeed).toBeGreaterThan(0);
  });
  it('follows and brakes when both sides are occupied, without using nitro', () => {
    const state = newAI(0);
    planAI(state, self, [car(0, 9, 0, 0), car(2, 0, -3.6), car(3, 0, 3.6)], options);
    expect(state.action).toBe('follow'); expect(state.targetLane).toBe(0);
    expect(state.targetSpeed).toBe(0); expect(state.boostSafe).toBe(false);
  });
  it('does not cross an alongside car into an apparently free destination', () => {
    const state = newAI(-3.6);
    planAI(state, { ...self, offset: -3.6 }, [car(0, 15, -3.6), car(2, 0, 0)], options);
    expect(state.targetLane).toBe(-3.6);
  });
  it('detects traffic over the finish seam in both directions', () => {
    expect(trafficGap(0.995, 0.005, 1000)).toBeCloseTo(10);
    expect(trafficGap(0.005, 0.995, 1000)).toBeCloseTo(-10);
    const state = newAI(0);
    planAI(state, { ...self, t: 0.995 }, [{ ...car(0, 0, 0), t: 0.005 }], options);
    expect(state.action).toBe('pass'); expect(state.targetSpeed).toBeLessThan(24);
  });
  it('slows for curves, leaves more room in easy mode and stays within safe road margins', () => {
    const straight = planAI(newAI(0), self, [], options);
    const corner = planAI(newAI(0), self, [], { ...options, curvature: 0.8 });
    expect(corner.targetSpeed).toBeLessThan(straight.targetSpeed); expect(corner.boostSafe).toBe(false);
    expect(AI_DIFFICULTIES.easy.cruise).toBeLessThan(AI_DIFFICULTIES.normal.cruise);
    const queue = [car(0, 20, 0), car(2, 0, -3.6), car(3, 0, 3.6)];
    const easy = planAI(newAI(0), self, queue, { ...options, difficulty: 'easy' });
    const normal = planAI(newAI(0), self, queue, options);
    expect(easy.targetSpeed).toBeLessThan(normal.targetSpeed);
    const narrow = planAI(newAI(0), self, [car(0, 18, 0)], { ...options, width: 9 });
    expect(Math.abs(narrow.lane)).toBeLessThanOrEqual(1.7);
  });
});
