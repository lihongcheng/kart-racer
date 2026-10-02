import * as THREE from 'three';
import { TUNING, type DriveState } from './driving';

export const EFFECT_CAPACITY = { particles: 96, marks: 160 };
type Particle = { position: THREE.Vector3; velocity: THREE.Vector3; life: number; duration: number; size: number };

/** Reuses CPU slots and GPU instances for the entire race, including restarts. */
export class DriftEffects {
  readonly group = new THREE.Group();
  readonly particles: THREE.InstancedMesh;
  readonly marks: THREE.InstancedMesh;
  private slots: Particle[] = Array.from({ length: EFFECT_CAPACITY.particles }, () => ({
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), life: 0, duration: 0.8, size: 1,
  }));
  private opacity = new THREE.InstancedBufferAttribute(new Float32Array(EFFECT_CAPACITY.particles), 1);
  private dummy = new THREE.Object3D();
  private smokeColor = new THREE.Color('#e6e9df');
  private sparkColor = new THREE.Color('#effa86');
  private particleCursor = 0;
  private markCursor = 0;
  private markCount = 0;
  private timer = 0;

  constructor() {
    const geometry = new THREE.IcosahedronGeometry(0.23, 0);
    geometry.setAttribute('instanceOpacity', this.opacity);
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float instanceOpacity;\nvarying float particleOpacity;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nparticleOpacity = instanceOpacity;');
      shader.fragmentShader = 'varying float particleOpacity;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= particleOpacity;');
    };
    this.particles = new THREE.InstancedMesh(geometry, material, EFFECT_CAPACITY.particles);
    this.marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.18, 0.75),
      new THREE.MeshBasicMaterial({ color: '#28373b', transparent: true, opacity: 0.35, depthWrite: false }), EFFECT_CAPACITY.marks);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    // Instances travel around the circuit; avoid stale geometry bounds.
    this.particles.frustumCulled = false; this.marks.frustumCulled = false;
    this.group.add(this.marks, this.particles);
    for (let i = 0; i < EFFECT_CAPACITY.particles; i++) this.particles.setColorAt(i, this.smokeColor);
    this.clear();
  }

  clear() {
    this.slots.forEach(slot => { slot.life = 0; });
    this.opacity.array.fill(0); this.opacity.needsUpdate = true;
    this.particleCursor = 0; this.markCursor = 0; this.markCount = 0; this.timer = 0;
    this.dummy.scale.setScalar(0); this.dummy.updateMatrix();
    for (let i = 0; i < EFFECT_CAPACITY.particles; i++) this.particles.setMatrixAt(i, this.dummy.matrix);
    for (let i = 0; i < EFFECT_CAPACITY.marks; i++) this.marks.setMatrixAt(i, this.dummy.matrix);
    this.particles.instanceMatrix.needsUpdate = true; this.marks.instanceMatrix.needsUpdate = true;
    this.particles.visible = false; this.marks.visible = false;
  }

  update(dt: number, position: THREE.Vector3, drive: DriveState, lowQuality: boolean) {
    const interval = lowQuality ? 0.14 : 0.07;
    this.timer += dt;
    if (drive.drifting && this.timer >= interval) {
      this.timer %= interval;
      const sin = Math.sin(drive.yaw), cos = Math.cos(drive.yaw);
      for (const side of [-1, 1]) {
        const x = position.x + cos * side - sin * 0.8;
        const z = position.z - sin * side - cos * 0.8;
        this.emit(x, position.y + 0.35, z, drive, false);
        if (drive.driftTime >= TUNING.miniChargeTime) this.emit(x, position.y + 0.2, z, drive, true);
        this.dummy.position.set(x, position.y + 0.04, z);
        this.dummy.rotation.set(-Math.PI / 2, 0, -drive.yaw); this.dummy.scale.setScalar(1); this.dummy.updateMatrix();
        this.marks.setMatrixAt(this.markCursor, this.dummy.matrix);
        this.markCursor = (this.markCursor + 1) % EFFECT_CAPACITY.marks;
        this.markCount = Math.min(EFFECT_CAPACITY.marks, this.markCount + 1);
      }
      this.marks.visible = true; this.marks.instanceMatrix.needsUpdate = true;
      this.particles.instanceColor!.needsUpdate = true;
    } else if (!drive.drifting) this.timer = 0;
    let active = 0;
    this.dummy.rotation.set(0, 0, 0);
    this.slots.forEach((slot, index) => {
      if (slot.life <= 0) return;
      slot.life = Math.max(0, slot.life - dt);
      slot.position.addScaledVector(slot.velocity, dt);
      this.dummy.position.copy(slot.position);
      this.dummy.scale.setScalar(slot.life > 0 ? slot.size * (1 + (slot.duration - slot.life) * 1.8) : 0);
      this.dummy.updateMatrix(); this.particles.setMatrixAt(index, this.dummy.matrix);
      this.opacity.setX(index, slot.life / slot.duration * (slot.size < 0.5 ? 0.9 : 0.45));
      if (slot.life > 0) active++;
    });
    this.particles.visible = active > 0;
    this.particles.instanceMatrix.needsUpdate = true; this.opacity.needsUpdate = true;
  }

  private emit(x: number, y: number, z: number, drive: DriveState, spark: boolean) {
    const index = this.particleCursor, slot = this.slots[index];
    this.particleCursor = (index + 1) % EFFECT_CAPACITY.particles;
    slot.position.set(x, y, z);
    slot.velocity.set(-drive.vx * (spark ? 0.18 : 0.06), spark ? 1.2 : 0.7, -drive.vz * (spark ? 0.18 : 0.06));
    slot.duration = spark ? 0.35 : 0.8; slot.life = slot.duration; slot.size = spark ? 0.25 : 1;
    this.particles.setColorAt(index, spark ? this.sparkColor : this.smokeColor);
  }

  stats() {
    return { activeParticles: this.slots.filter(slot => slot.life > 0).length, marks: this.markCount, capacity: EFFECT_CAPACITY };
  }
}
