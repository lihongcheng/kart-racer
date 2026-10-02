import type { DriveState } from './driving';
import { KART_WHEEL_RADIUS, type KartVisual } from './kart-model';

export function selectKartDetail(visual: KartVisual, distance: number): KartVisual {
  const low = visual.low;
  if (!low) return visual;
  // A four-metre hysteresis band avoids flickering at the switch distance.
  const useLow = distance > (low.group.visible ? 31 : 35);
  low.group.visible = useLow;
  visual.shell.visible = !useLow;
  visual.wheels.forEach(wheel => { wheel.visible = !useLow; });
  if (useLow) visual.flame.visible = false;
  return useLow ? low : visual;
}

export function animateKart(visual: KartVisual, active: KartVisual, drive: DriveState, dt: number, racing: boolean, time: number) {
  for (const model of visual.low ? [visual, visual.low] : [visual]) {
    model.shell.rotation.z = -drive.steerVisual * (drive.drifting ? 0.09 : 0.035);
    for (const wheel of model.wheels) {
      wheel.rotation.y = wheel.position.z > 0 ? drive.steerVisual * 0.35 : 0;
      if (racing) for (const tire of wheel.children) tire.rotateY(drive.speed * dt / KART_WHEEL_RADIUS);
    }
    model.flame.visible = model === active && (drive.boostTime > 0 || drive.miniTime > 0);
    if (racing) model.flame.scale.z = 0.8 + Math.sin(time * 45) * 0.2;
  }
}
