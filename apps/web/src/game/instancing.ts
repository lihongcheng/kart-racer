import * as THREE from 'three';

/** Batch a static template in spatial cells; placements are relative to the returned group. */
export function instanceInCells(template: THREE.Object3D, placements: THREE.Matrix4[], cellSize = 72) {
  const result = new THREE.Group();
  const cells = new Map<string, THREE.Matrix4[]>();
  for (const matrix of placements) {
    const key = `${Math.floor(matrix.elements[12] / cellSize)},${Math.floor(matrix.elements[14] / cellSize)}`;
    const cell = cells.get(key) ?? [];
    cell.push(matrix); cells.set(key, cell);
  }
  template.updateWorldMatrix(true, true);
  const parentInverse = template.parent?.matrixWorld.clone().invert() ?? new THREE.Matrix4();
  const combined = new THREE.Matrix4();
  template.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const local = new THREE.Matrix4().multiplyMatrices(parentInverse, object.matrixWorld);
    for (const [cell, matrices] of cells) {
      const batch = new THREE.InstancedMesh(object.geometry, object.material, matrices.length);
      batch.name = `${object.name || 'instances'}:${cell}`;
      batch.castShadow = object.castShadow; batch.receiveShadow = object.receiveShadow;
      matrices.forEach((placement, index) => batch.setMatrixAt(index, combined.multiplyMatrices(placement, local)));
      batch.computeBoundingSphere(); batch.computeBoundingBox();
      result.add(batch);
    }
  });
  return result;
}
