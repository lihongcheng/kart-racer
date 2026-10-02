import * as THREE from 'three';
import { makeKart, type KartVisual } from './kart-model';
import type { Pose } from './timing';

export function makeGhost(): KartVisual {
  const visual = makeKart('#9be8ed', 'low');
  const material = new THREE.MeshBasicMaterial({ color: '#93eced', transparent: true, opacity: 0.32, depthWrite: false });
  const old = new Set<THREE.Material>();
  visual.group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => old.add(m));
    object.material = material; object.castShadow = false; object.receiveShadow = false;
  });
  old.forEach(m => m.dispose());
  visual.group.name = 'Personal_best_ghost';
  visual.group.visible = false;
  return visual;
}
export function positionGhost(visual: KartVisual, pose: Pose) {
  visual.group.position.set(pose.x, pose.y, pose.z);
  visual.group.rotation.y = pose.yaw;
  visual.shell.rotation.z = -pose.steer * (pose.flags & 1 ? 0.09 : 0.035);
  visual.wheels.forEach(wheel => { wheel.rotation.y = wheel.position.z > 0 ? pose.steer * 0.35 : 0; });
  visual.flame.visible = !!(pose.flags & 6);
}
