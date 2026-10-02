import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { instanceInCells } from '../apps/web/src/game/instancing';
import { DriftEffects, EFFECT_CAPACITY } from '../apps/web/src/game/effects';
import { makeKart } from '../apps/web/src/game/kart-model';
import { selectKartDetail, animateKart } from '../apps/web/src/game/kart-animation';
import { newDrive } from '../apps/web/src/game/driving';

describe('rendering resources', () => {
  it('preserves nested mesh transforms and shared resources across spatial batches', () => {
    const template = new THREE.Group(), child = new THREE.Group();
    template.scale.setScalar(2); template.position.set(-2, 1, 3);
    child.position.set(1, 3, -2); child.rotation.set(0.2, 0.5, 0.1); template.add(child);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial());
    mesh.position.set(2, 1, -1); mesh.scale.set(1, 2, 0.5); child.add(mesh);
    const placements = [0, 5, 100].map(x => new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1),
      new THREE.Vector3(0.8, 0.8, 0.8)));
    const batches = instanceInCells(template, placements);
    expect(batches.children).toHaveLength(2);
    const actual: THREE.Matrix4[] = [];
    for (const batch of batches.children as THREE.InstancedMesh[]) {
      expect(batch.geometry).toBe(mesh.geometry); expect(batch.material).toBe(mesh.material);
      expect(batch.boundingSphere!.radius).toBeGreaterThan(0);
      for (let i = 0; i < batch.count; i++) {
        const matrix = new THREE.Matrix4(); batch.getMatrixAt(i, matrix); actual.push(matrix);
      }
    }
    expect(actual).toHaveLength(placements.length);
    placements.forEach((placement, i) => {
      const expected = placement.clone().multiply(mesh.matrixWorld);
      actual[i].elements.forEach((value, j) => expect(value).toBeCloseTo(expected.elements[j], 5));
    });
  });

  it('keeps drift geometry, material and buffers fixed during prolonged drifting and restart', () => {
    const effects = new DriftEffects(), drive = newDrive(0), position = new THREE.Vector3();
    drive.drifting = true; drive.driftTime = 1; drive.vz = 25;
    const mesh = effects.particles, geometry = mesh.geometry, material = mesh.material, buffer = mesh.instanceMatrix.array;
    for (let frame = 0; frame < 3600; frame++) {
      position.z += 25 / 60; effects.update(1 / 60, position, drive, false);
    }
    expect(effects.group.children).toHaveLength(2);
    expect(effects.particles.geometry).toBe(geometry); expect(effects.particles.material).toBe(material);
    expect(effects.particles.instanceMatrix.array).toBe(buffer);
    expect(effects.stats().marks).toBe(EFFECT_CAPACITY.marks);
    expect(effects.stats().activeParticles).toBeGreaterThan(0);
    expect(effects.stats().activeParticles).toBeLessThanOrEqual(EFFECT_CAPACITY.particles);
    drive.drifting = false;
    for (let i = 0; i < 61; i++) effects.update(1 / 60, position, drive, false);
    expect(effects.stats().activeParticles).toBe(0);
    effects.clear();
    expect(effects.stats().marks).toBe(0);
    expect(effects.particles.visible).toBe(false); expect(effects.marks.visible).toBe(false);
    expect(effects.particles.geometry).toBe(geometry);
  });

  it('reduces distant kart triangles, preserves bounds and switches with hysteresis', () => {
    const high = makeKart('#219cde'), low = makeKart('#219cde', 'low');
    const triangles = (root: THREE.Object3D) => {
      let count = 0;
      root.traverse(o => { if (o instanceof THREE.Mesh) count += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; });
      return count;
    };
    expect(triangles(low.group)).toBeLessThan(triangles(high.group) * 0.6);
    const highBounds = new THREE.Box3().setFromObject(high.group), lowBounds = new THREE.Box3().setFromObject(low.group);
    expect(highBounds.min.distanceTo(lowBounds.min)).toBeLessThan(0.05);
    expect(highBounds.max.distanceTo(lowBounds.max)).toBeLessThan(0.05);
    high.low = low; low.group.visible = false; high.group.add(low.group);
    expect(selectKartDetail(high, 30)).toBe(high);
    expect(selectKartDetail(high, 36)).toBe(low);
    expect(selectKartDetail(high, 33)).toBe(low);
    expect(high.shell.visible).toBe(false);
    expect(selectKartDetail(high, 30)).toBe(high);
    expect(high.wheels.every(w => w.visible)).toBe(true);
    const drive = newDrive(0); drive.speed = 30; drive.boostTime = 1;
    animateKart(high, high, drive, 1 / 60, true, 1);
    const rotation = high.wheels[0].children[0].quaternion.clone(), flameScale = high.flame.scale.z;
    animateKart(high, high, drive, 1, false, 2);
    expect(high.wheels[0].children[0].quaternion.equals(rotation)).toBe(true);
    expect(high.flame.scale.z).toBe(flameScale);
    expect(low.wheels[0].children[0].quaternion.equals(rotation)).toBe(true);
  });
});
