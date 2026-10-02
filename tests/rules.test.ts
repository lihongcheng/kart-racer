import { describe, expect, it } from 'vitest';
import { advanceProgress, FixedClock, newProgress, raceProgress } from '../apps/web/src/game/rules';
import { CHECKPOINTS, wrap } from '../apps/web/src/game/track';
import { drive, idleInput, newDrive, TUNING } from '../apps/web/src/game/driving';
import { PerspectiveCamera, Vector3 } from 'three';

describe('race rules', () => {
  it('requires 24 ordered gates per lap and finishes only after three laps', () => {
    const state = newProgress(0.99);
    advanceProgress(state, 0.001, 1, true);
    expect(state.passed).toBe(0);
    for (let step = 2; step <= 3000; step++) advanceProgress(state, wrap(step / 1000), step / 10, true);
    expect(state.passed).toBe(CHECKPOINTS * 3);
    expect(state.lapTimes).toHaveLength(3);
    expect(state.finishedAt).toBe(300);
    advanceProgress(state, 0.02, 305, true);
    expect(state.finishedAt).toBe(300);
  });
  it('rejects reverse crossings, teleports, missed gates and offroad crossings', () => {
    const gate = 1 / CHECKPOINTS;
    const state = newProgress(gate + 0.001);
    advanceProgress(state, gate - 0.001, 1, true);
    expect(state.passed).toBe(0);
    advanceProgress(state, 0.25, 2, true);
    advanceProgress(state, 0.251, 3, true);
    expect(state.passed).toBe(0);
    state.previous = gate - 0.001;
    advanceProgress(state, gate + 0.001, 4, false);
    expect(state.passed).toBe(0);
  });
  it('resetting just beyond the last valid gate cannot award progress twice', () => {
    const state = newProgress(0.04);
    advanceProgress(state, 0.043, 1, true);
    expect(state.passed).toBe(1);
    state.previous = 1 / CHECKPOINTS + 0.003;
    advanceProgress(state, 1 / CHECKPOINTS + 0.005, 3, true);
    expect(state.passed).toBe(1);
    expect(raceProgress(state, 0.2)).toBeLessThan(2);
  });
});

describe('fixed step driving', () => {
  it('ramps steering progressively, recentres and softens high-speed yaw', () => {
    const slow = newDrive(0), fast = newDrive(0);
    slow.vz = 18; fast.vz = 47; fast.boostTime = 1;
    drive(slow, { ...idleInput(), throttle: 1, steer: 1 }, 1 / 60, false, false);
    drive(fast, { ...idleInput(), throttle: 1, steer: 1 }, 1 / 60, false, false);
    expect(slow.steerVisual).toBeGreaterThan(0);
    expect(slow.steerVisual).toBeLessThan(0.3);
    expect(fast.yaw).toBeGreaterThan(0);
    expect(fast.yaw).toBeLessThan(slow.yaw * 0.85);
    const firstSteer = slow.steerVisual;
    for (let n = 0; n < 30; n++) drive(slow, { ...idleInput(), throttle: 1, steer: 1 }, 1 / 60, false, false);
    expect(slow.steerVisual).toBeGreaterThan(0.99);
    for (let n = 0; n < 30; n++) drive(slow, { ...idleInput(), throttle: 1 }, 1 / 60, false, false);
    expect(slow.steerVisual).toBeLessThan(firstSteer * 0.01);
  });
  it.each(['short', 'steeringOnly', 'lowSpeed', 'offroad', 'collision', 'release'] as const)(
    'only awards mini boost for a charged, valid Shift release: %s', reason => {
      const d = newDrive(0); d.vz = reason === 'lowSpeed' ? 8 : 20;
      d.drifting = true; d.driftTime = reason === 'short' ? 0.3 : TUNING.miniChargeTime;
      drive(d, { ...idleInput(), drift: reason === 'steeringOnly' }, 1 / 60, reason === 'offroad', reason === 'collision');
      expect(d.miniTime > 0).toBe(reason === 'release');
      if (reason === 'steeringOnly') {
        drive(d, idleInput(), 1 / 60, false, false);
        expect(d.miniTime).toBe(0);
      }
    });
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('steers left/right in the chase-camera frame at heading %s', yaw => {
    const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const camera = new PerspectiveCamera();
    camera.position.copy(forward).multiplyScalar(-9); camera.position.y = 5;
    camera.lookAt(forward.clone().multiplyScalar(8)); camera.updateMatrixWorld();
    const screenRight = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    for (const drift of [false, true]) for (const steer of [-1, 1]) {
      const d = newDrive(yaw); d.vx = forward.x * 20; d.vz = forward.z * 20;
      const displacement = new Vector3();
      for (let n = 0; n < 24; n++) {
        drive(d, { ...idleInput(), throttle: 1, steer, drift }, 1 / 60, false, false);
        displacement.addScaledVector(new Vector3(d.vx, 0, d.vz), 1 / 60);
      }
      const heading = new Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw));
      // Positive input means left: both the nose and travel move screen-left.
      expect(heading.dot(screenRight) * steer).toBeLessThan(0);
      expect(displacement.dot(screenRight) * steer).toBeLessThan(0);
    }
  });
  function simulate(fps: number) {
    const clock = new FixedClock(), state = newDrive(0);
    let x = 0, z = 0, elapsed = 0;
    for (let frame = 0; frame < fps * 12; frame++) {
      clock.consume(1 / fps, dt => {
        drive(state, { throttle: 1, steer: elapsed > 4 && elapsed < 8 ? 0.5 : 0, drift: elapsed > 4 && elapsed < 8, boost: elapsed > 9, brake: false }, dt, false, false);
        x += state.vx * dt; z += state.vz * dt; elapsed += dt;
      });
    }
    return { x, z, state };
  }
  it('produces the same trajectory at 30, 60 and 120 rendered FPS', () => {
    expect(simulate(30)).toEqual(simulate(60));
    expect(simulate(120)).toEqual(simulate(60));
  });
  it('caps catch-up and does not charge drift while stationary, offroad or colliding', () => {
    const clock = new FixedClock(); let ticks = 0;
    clock.consume(100, () => ticks++);
    expect(ticks).toBe(6);
    for (const [speed, offroad, collision] of [[0, false, false], [20, true, false], [20, false, true]] as const) {
      const d = newDrive(0); d.vz = speed;
      drive(d, { ...idleInput(), drift: true, steer: 1 }, 1 / 60, offroad, collision);
      expect(d.charge).toBe(0); expect(d.drifting).toBe(false);
    }
  });
  it('charges by valid drifting, gives a release boost and consumes nitro once per press', () => {
    const d = newDrive(0);
    for (let n = 0; n < 60 * 12; n++) drive(d, { ...idleInput(), throttle: 1, steer: 0.5, drift: true }, 1 / 60, false, false);
    expect(d.cans).toBe(2);
    drive(d, { ...idleInput(), throttle: 1 }, 1 / 60, false, false);
    expect(d.miniTime).toBeGreaterThan(0);
    for (let n = 0; n < 240; n++) drive(d, { ...idleInput(), throttle: 1, boost: true }, 1 / 60, false, false);
    expect(d.cans).toBe(1);
    drive(d, idleInput(), 1 / 60, false, false);
    drive(d, { ...idleInput(), boost: true }, 1 / 60, false, false);
    expect(d.cans).toBe(0);
  });
});
