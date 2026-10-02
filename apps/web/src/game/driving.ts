import { clamp } from './track';

/** steer: +1 = left, -1 = right, from the driver's forward-facing view. */
export type Controls = { throttle: number; steer: number; brake: boolean; drift: boolean; boost: boolean };
export const idleInput = (): Controls => ({ throttle: 0, steer: 0, brake: false, drift: false, boost: false });
export const TUNING = {
  topSpeed: 34, boostSpeed: 47, acceleration: 16, braking: 29,
  reverseSpeed: 7, drag: 1.1, grip: 10, driftGrip: 2.6,
  minDriftSpeed: 9, driftChargePerSecond: 0.3, nitroDuration: 2.2,
  miniChargeTime: 0.6, miniDuration: 0.7, steerResponse: 14,
};
export type DriveState = {
  yaw: number; vx: number; vz: number; speed: number;
  driftTime: number; drifting: boolean; charge: number; cans: number;
  boostTime: number; miniTime: number; boostHeld: boolean; steerVisual: number;
};
export function newDrive(yaw: number): DriveState {
  return { yaw, vx: 0, vz: 0, speed: 0, driftTime: 0, drifting: false, charge: 0,
    cans: 0, boostTime: 0, miniTime: 0, boostHeld: false, steerVisual: 0 };
}

export function drive(d: DriveState, input: Controls, dt: number, offroad: boolean, collision: boolean) {
  const fX = Math.sin(d.yaw), fZ = Math.cos(d.yaw);
  let forward = d.vx * fX + d.vz * fZ;
  let lateral = d.vx * fZ - d.vz * fX;
  if (input.boost && !d.boostHeld && d.cans > 0 && d.boostTime <= 0) {
    d.cans--; d.boostTime = TUNING.nitroDuration;
  }
  d.boostHeld = input.boost;
  d.boostTime = Math.max(0, d.boostTime - dt);
  d.miniTime = Math.max(0, d.miniTime - dt);
  const drifting = input.drift && Math.abs(input.steer) > 0.18 &&
    forward > TUNING.minDriftSpeed && !offroad && !collision;
  if (drifting) {
    d.driftTime += dt;
    if (d.cans < 2) d.charge += TUNING.driftChargePerSecond * dt * Math.min(Math.abs(lateral) / 2.5, 1);
    if (d.charge >= 1) { d.cans = Math.min(2, d.cans + 1); d.charge -= 1; }
  } else {
    if (d.drifting && d.driftTime >= TUNING.miniChargeTime && !input.drift &&
      forward > TUNING.minDriftSpeed && !collision && !offroad) d.miniTime = TUNING.miniDuration;
    d.driftTime = 0;
  }
  d.drifting = drifting;
  const accelerating = d.boostTime > 0 || d.miniTime > 0;
  const maxSpeed = offroad ? 14 : accelerating ? TUNING.boostSpeed : TUNING.topSpeed;
  if (input.throttle > 0) forward += (TUNING.acceleration + (accelerating ? 16 : 0)) * dt;
  if (input.brake) forward -= (forward > 0 ? TUNING.braking : 6) * dt;
  if (!input.throttle && !input.brake) forward *= Math.exp(-TUNING.drag * dt);
  forward = clamp(forward, -TUNING.reverseSpeed, maxSpeed);
  // Smooth the physical steering at the fixed timestep, not just the wheels.
  d.steerVisual += (input.steer - d.steerVisual) * (1 - Math.exp(-TUNING.steerResponse * dt));
  const highSpeedControl = 1 - clamp((Math.abs(forward) - 18) / 29, 0, 1) * 0.24;
  const steerRate = (drifting ? 1.8 : 1.35) * clamp(Math.abs(forward) / 12, 0, 1) * highSpeedControl;
  // With +Z forward, positive Y rotation turns toward the driver's left (+X).
  const turn = d.steerVisual * steerRate * dt * (forward < 0 ? -1 : 1);
  d.yaw += turn;
  // Rotate world momentum into the new vehicle frame before applying grip.
  lateral -= forward * turn;
  lateral *= Math.exp(-(drifting ? TUNING.driftGrip : TUNING.grip) * dt);
  if (collision) { forward *= Math.exp(-7 * dt); d.boostTime = 0; d.miniTime = 0; }
  d.vx = Math.sin(d.yaw) * forward + Math.cos(d.yaw) * lateral;
  d.vz = Math.cos(d.yaw) * forward - Math.sin(d.yaw) * lateral;
  d.speed = Math.hypot(d.vx, d.vz) * (forward < 0 ? -1 : 1);
}
