import { TUNING, type Controls, type DriveState } from './driving';
import { clamp } from './track';

export const TRAINING_KEY = 'coastline.training.v1';
export const LESSONS = ['起步加速', '保持漂移', '出弯小喷', '释放氮气'] as const;
export type Training = { completed: number; progress: number; hint: string };
export function parseTraining(raw: string | null): number {
  try {
    const value = JSON.parse(raw || '{}');
    return value.version === 1 && Number.isInteger(value.completed) && value.completed >= 0 && value.completed <= 4 ? value.completed : 0;
  } catch { return 0; }
}
export function newTraining(completed = 0): Training {
  return { completed: Number.isInteger(completed) && completed >= 0 && completed < 4 ? completed : 0, progress: 0, hint: '按住 W / ↑ 加速，沿着道路前进' };
}
export type TrainingFrame = {
  drive: DriveState; input: Controls; offroad: boolean; collision: boolean;
  miniStarted: boolean; nitroStarted: boolean;
};
/** Only real driving events advance lessons. Called after the fixed physics step. */
export function advanceTraining(state: Training, frame: TrainingFrame) {
  if (state.completed === 4) return;
  const { drive: d, input, offroad, collision } = frame;
  state.progress = 0;
  if (offroad || collision) {
    state.hint = offroad ? '先回到柏油路；按 R 可回到赛道继续练习' : '碰撞打断了动作，稳住方向后再试一次';
    return;
  }
  let passed = false;
  if (state.completed === 0) {
    state.progress = clamp(d.speed / 15, 0, 1);
    state.hint = '按住 W / ↑，达到 54 km/h；A / D 调整方向';
    passed = input.throttle > 0 && d.speed >= 15;
  } else if (state.completed === 1 || state.completed === 2) {
    state.progress = clamp(d.driftTime / TUNING.miniChargeTime, 0, 1);
    state.hint = d.speed <= TUNING.minDriftSpeed ? '速度不足：先按 W 加速到 33 km/h 以上'
      : !input.drift ? '按住 Shift 并转向，保持 0.6 秒；过早松开不会触发小喷'
      : Math.abs(input.steer) <= 0.18 ? '还需要转向：按住 Shift，同时按 A 或 D'
      : state.completed === 2 && state.progress >= 1 ? '小喷已就绪！松开 Shift，继续踩住油门'
      : '保持 Shift + 转向，让小喷进度条充满';
    passed = state.completed === 1 ? d.drifting && d.driftTime >= TUNING.miniChargeTime : frame.miniStarted;
  } else {
    state.hint = '教学补给：已提供 1 罐氮气；在路面上按 Space 释放';
    passed = frame.nitroStarted;
  }
  if (passed) {
    state.completed++; state.progress = 0;
    state.hint = state.completed === 2 ? '漂移达标！现在松开 Shift，触发出弯小喷'
      : state.completed === 3 ? '小喷成功！已补给 1 罐教学氮气，按 Space 释放'
      : state.completed === 4 ? '四项实操全部完成，可以去赛道挑战了' : '加速达标！按住 Shift + A / D 练习漂移';
  }
}
