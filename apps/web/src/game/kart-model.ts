import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

type XYZ = [number, number, number];
export const KART_WHEEL_RADIUS = 0.4;
export type KartVisual = {
  group: THREE.Group; shell: THREE.Group; wheels: THREE.Group[];
  flame: THREE.Group; paint: string; low?: KartVisual;
};

/** Original early-arcade proportions. Local +Z is forward, +X is driver-left. */
export function makeKart(paint: string, detail: 'high' | 'low' = 'high'): KartVisual {
  const low = detail === 'low';
  const group = new THREE.Group(); group.name = 'Coastline_Classic';
  const shell = new THREE.Group(); shell.name = 'body'; group.add(shell);
  const coated = (color: string, roughness = 0.32) => new THREE.MeshPhysicalMaterial({
    color, roughness, metalness: 0.04, clearcoat: 0.55, clearcoatRoughness: 0.27,
  });
  const bodyPaint = coated(paint); bodyPaint.name = 'body_paint';
  const darkPaint = coated(new THREE.Color(paint).multiplyScalar(0.55).getStyle());
  const cream = coated('#fff4da', 0.46);
  const ink = new THREE.MeshStandardMaterial({ color: '#172b41', roughness: 0.75 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#202b35', roughness: 0.95 });
  const silver = new THREE.MeshStandardMaterial({ color: '#a6b7bc', roughness: 0.35, metalness: 0.6 });
  const face = new THREE.MeshStandardMaterial({ color: '#ffdeb1', roughness: 0.9 });
  const eye = new THREE.MeshBasicMaterial({ color: '#23364c' });
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff3c3', emissive: '#ffe6a1', emissiveIntensity: 0.28, roughness: 0.3 });
  const tailLamp = new THREE.MeshStandardMaterial({ color: '#f25f4c', emissive: '#d93228', emissiveIntensity: 0.25 });
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, position: XYZ, parent: THREE.Object3D = shell, name = '') {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(...position); item.castShadow = true; item.receiveShadow = true; item.name = name;
    parent.add(item); return item;
  }
  function rounded(size: XYZ, position: XYZ, material: THREE.Material, radius = 0.08, parent: THREE.Object3D = shell, name = '') {
    const segments = low || Math.max(...size) < 0.4 ? 1 : 3;
    return mesh(new RoundedBoxGeometry(...size, segments, Math.min(radius, ...size.map(n => n / 2))), material, position, parent, name);
  }
  function sphere(radius: number, position: XYZ, material: THREE.Material, scale: XYZ = [1, 1, 1], parent: THREE.Object3D = shell) {
    const item = mesh(new THREE.SphereGeometry(radius, low ? 12 : 24, low ? 8 : 16), material, position, parent);
    item.scale.set(...scale); return item;
  }
  function link(a: XYZ, b: XYZ, radius: number, material: THREE.Material, parent: THREE.Object3D = shell) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    const item = mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, direction.length() - radius * 2), low ? 2 : 4, low ? 6 : 10), material,
      from.add(to).multiplyScalar(0.5).toArray() as XYZ, parent);
    item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); return item;
  }
  function tube(points: XYZ[], radius: number, material: THREE.Material, parent: THREE.Object3D = shell) {
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), low ? 12 : 24, radius, low ? 5 : 8, false),
      material, [0, 0, 0], parent);
  }

  // Low tray and a broad bumper give the car a planted, toy-like silhouette.
  rounded([1.93, 0.2, 2.8], [0, 0.27, -0.02], ink, 0.09, shell, 'chassis');
  rounded([2.12, 0.22, 0.49], [0, 0.39, 1.33], cream, 0.105);
  rounded([1.94, 0.19, 0.43], [0, 0.51, 1.34], bodyPaint, 0.085);
  rounded([1.65, 0.1, 0.04], [0, 0.37, 1.584], darkPaint, 0.025);
  const hoodSections = [
    [0.28, 0.34, 0.41, 0.81],
    [0.45, 0.48, 0.35, 0.82],
    [0.88, 0.72, 0.33, 0.73],
    [1.18, 0.84, 0.33, 0.65],
    [1.40, 0.80, 0.35, 0.60],
    [1.49, 0.65, 0.38, 0.54],
  ];
  mesh(hoodGeometry(hoodSections, low ? 16 : 32), bodyPaint, [0, 0, 0], shell, 'rounded_nose');
  // Stripe follows the hood surface instead of intersecting the body.
  const stripeVertices: number[] = [], stripeIndices: number[] = [];
  hoodSections.forEach(([z, width, , top], i) => {
    for (const side of [-1, 1]) stripeVertices.push(side * width * 0.19, top + 0.009, z);
    if (i) { const k = i * 2; stripeIndices.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  });
  const stripeGeo = new THREE.BufferGeometry();
  stripeGeo.setAttribute('position', new THREE.Float32BufferAttribute(stripeVertices, 3));
  stripeGeo.setIndex(stripeIndices); stripeGeo.computeVertexNormals();
  mesh(stripeGeo, cream, [0, 0, 0]);
  for (const side of [-1, 1]) {
    const headlight = rounded([0.34, 0.14, 0.08], [side * 0.61, 0.55, 1.49], lamp, 0.06);
    headlight.rotation.z = -side * 0.14;
    rounded([0.42, 0.42, 1.62], [side * 0.77, 0.55, -0.19], bodyPaint, 0.16);
    rounded([0.035, 0.10, 1.10], [side * 0.986, 0.45, -0.15], cream, 0.016);
    for (let i = 0; i < 3; i++) rounded([0.038, 0.12, 0.12], [side * 0.983, 0.65, -0.35 - i * 0.18], ink, 0.026);
  }

  // An actual open cockpit, with a seat well below the helmet.
  rounded([0.94, 0.14, 1.23], [0, 0.44, -0.12], ink, 0.065);
  rounded([0.75, 0.15, 0.63], [0, 0.60, -0.26], darkPaint, 0.07);
  const seat = rounded([0.82, 0.68, 0.20], [0, 0.90, -0.56], ink, 0.09);
  seat.rotation.x = -0.14;
  const cushion = rounded([0.65, 0.53, 0.055], [0, 0.93, -0.437], darkPaint, 0.025);
  cushion.rotation.x = -0.14;
  rounded([1.52, 0.37, 0.73], [0, 0.59, -1.02], bodyPaint, 0.14);
  for (let i = 0; i < 4; i++) rounded([0.73, 0.025, 0.04], [0, 0.783, -0.86 - i * 0.10], ink, 0.012);
  for (const side of [-1, 1]) {
    rounded([0.11, 0.35, 0.13], [side * 0.57, 0.91, -1.16], silver, 0.035);
    rounded([0.12, 0.30, 0.50], [side * 0.97, 1.10, -1.26], cream, 0.05);
    rounded([0.31, 0.11, 0.075], [side * 0.57, 0.63, -1.402], tailLamp, 0.04);
  }
  rounded([1.91, 0.16, 0.43], [0, 1.09, -1.26], bodyPaint, 0.07, shell, 'rear_wing');
  rounded([1.72, 0.035, 0.10], [0, 1.18, -1.32], cream, 0.017);
  rounded([0.44, 0.20, 0.045], [0, 0.61, -1.413], cream, 0.02);
  // Pair of recessed exhausts, mirrored around the rear number plate.
  for (const side of [-1, 1]) {
    const exhaust = mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.22, 20), silver, [side * 0.44, 0.39, -1.46]);
    exhaust.rotation.x = Math.PI / 2;
    const hole = mesh(new THREE.CircleGeometry(0.108, 20), ink, [side * 0.44, 0.39, -1.575]);
    hole.rotation.y = Math.PI;
    const ring = mesh(new THREE.TorusGeometry(0.123, 0.026, 8, 20), silver, [side * 0.44, 0.39, -1.583]);
    ring.rotation.y = Math.PI;
  }

  // Four separate steering pivots, each with a single rotating axle assembly.
  const wheels: THREE.Group[] = [];
  const tireProfile = [
    [0, -0.20], [0.28, -0.20], [0.36, -0.185], [0.395, -0.13],
    [0.40, 0], [0.395, 0.13], [0.36, 0.185], [0.28, 0.20], [0, 0.20],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  for (const x of [-1.02, 1.02]) for (const z of [-0.89, 0.94]) {
    const wheel = new THREE.Group(); wheel.name = `wheel_${x < 0 ? 'right' : 'left'}_${z > 0 ? 'front' : 'rear'}`;
    wheel.position.set(x, KART_WHEEL_RADIUS, z); group.add(wheel); wheels.push(wheel);
    const rotor = new THREE.Group(); rotor.name = 'rotor'; rotor.rotation.z = Math.PI / 2; wheel.add(rotor);
    mesh(new THREE.LatheGeometry(tireProfile, low ? 16 : 32), rubber, [0, 0, 0], rotor);
    for (const side of [-1, 1]) {
      mesh(new THREE.CylinderGeometry(0.247, 0.247, 0.028, low ? 12 : 24), silver, [0, side * 0.201, 0], rotor);
      mesh(new THREE.CylinderGeometry(0.196, 0.196, 0.032, low ? 12 : 24), ink, [0, side * 0.218, 0], rotor);
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5;
        const spoke = rounded([0.066, 0.025, 0.22], [Math.sin(angle) * 0.09, side * 0.24, Math.cos(angle) * 0.09], cream, 0.012, rotor);
        spoke.rotation.y = angle;
      }
      mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.04, 20), bodyPaint, [0, side * 0.25, 0], rotor);
      mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.042, 12), silver, [0, side * 0.265, 0], rotor);
    }
  }
  for (const z of [-0.89, 0.94]) link([-1.02, 0.4, z], [1.02, 0.4, z], 0.05, silver);

  const driver = new THREE.Group(); driver.name = 'driver'; shell.add(driver);
  const torso = rounded([0.53, 0.50, 0.42], [0, 0.98, -0.20], bodyPaint, 0.15, driver);
  torso.rotation.x = -0.15;
  rounded([0.25, 0.31, 0.05], [0, 1.00, 0.023], cream, 0.04, driver);
  for (const side of [-1, 1]) {
    link([side * 0.16, 0.79, -0.22], [side * 0.22, 0.65, 0.19], 0.13, bodyPaint, driver);
    link([side * 0.22, 0.65, 0.19], [side * 0.22, 0.52, 0.46], 0.11, bodyPaint, driver);
    rounded([0.25, 0.20, 0.38], [side * 0.22, 0.49, 0.50], ink, 0.085, driver);
    rounded([0.24, 0.04, 0.32], [side * 0.22, 0.39, 0.50], cream, 0.018, driver);
    link([side * 0.255, 1.14, -0.20], [side * 0.39, 0.98, 0.08], 0.11, bodyPaint, driver);
    link([side * 0.39, 0.98, 0.08], [side * 0.26, 1.025, 0.35], 0.10, bodyPaint, driver);
    sphere(0.115, [side * 0.26, 1.025, 0.35], cream, [1, 0.95, 1], driver);
  }
  link([0, 0.70, 0.41], [0, 1.00, 0.34], 0.045, silver);
  const steering = new THREE.Group(); steering.name = 'steering_wheel';
  steering.position.set(0, 1.025, 0.36); steering.rotation.x = -0.45; shell.add(steering);
  mesh(new THREE.TorusGeometry(0.25, 0.034, 10, 24), ink, [0, 0, 0], steering);
  for (let i = 0; i < 3; i++) {
    const angle = Math.PI / 2 + i * Math.PI * 2 / 3;
    link([0, 0, 0], [Math.cos(angle) * 0.22, Math.sin(angle) * 0.22, 0], 0.018, silver, steering);
  }
  sphere(0.065, [0, 0, 0], bodyPaint, [1, 1, 0.45], steering);

  // A large rounded helmet frames a small expressive face, with no exposed neck.
  const head = new THREE.Group(); head.name = 'helmet'; head.position.set(0, 1.62, -0.22); driver.add(head);
  sphere(0.55, [0, 0, 0], bodyPaint, [1, 0.92, 0.88], head);
  mesh(roundedPanel(0.90, 0.53, 0.15, 0.08), ink, [0, -0.02, 0.405], head);
  mesh(roundedPanel(0.78, 0.41, 0.11, 0.065), face, [0, -0.035, 0.495], head);
  for (const side of [-1, 1]) {
    rounded([0.058, 0.16, 0.035], [side * 0.17, -0.005, 0.581], eye, 0.025, head);
    sphere(0.015, [side * 0.17 - 0.008, 0.040, 0.602], cream, [1, 1, 0.5], head);
    const brow = rounded([0.125, 0.025, 0.025], [side * 0.17, 0.12, 0.578], eye, 0.01, head);
    brow.rotation.z = side * 0.13;
    const fastener = mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.025, 20), cream, [side * 0.55, -0.04, 0], head);
    fastener.rotation.z = Math.PI / 2;
  }
  tube([[-0.060, -0.12, 0.579], [0, -0.135, 0.586], [0.060, -0.12, 0.579]], 0.012, eye, head);
  rounded([0.52, 0.12, 0.15], [0, -0.34, 0.399], cream, 0.055, head);
  const helmetStripe = new THREE.BufferGeometry(), stripePositions: number[] = [], helmetIndices: number[] = [];
  for (let i = 0; i <= 36; i++) {
    const angle = -2.10 + i / 36 * 3.0;
    for (const side of [-1, 1]) {
      const radius = Math.sqrt(0.55 ** 2 - 0.046 ** 2) + 0.008;
      stripePositions.push(side * 0.046, Math.cos(angle) * radius * 0.92, Math.sin(angle) * radius * 0.88);
    }
    if (i) { const k = i * 2; helmetIndices.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  helmetStripe.setAttribute('position', new THREE.Float32BufferAttribute(stripePositions, 3));
  helmetStripe.setIndex(helmetIndices); helmetStripe.computeVertexNormals();
  mesh(helmetStripe, cream, [0, 0, 0], head);

  // Small geometric 01 markings are part of the mesh, so exports need no fonts.
  function numberPlate(position: XYZ, rotation: XYZ, scale: number) {
    const badge = new THREE.Group(); badge.position.set(...position); badge.rotation.set(...rotation); badge.scale.setScalar(scale); shell.add(badge);
    rounded([0.44, 0.26, 0.035], [0, 0, 0], cream, 0.05, badge);
    const zero = mesh(new THREE.TorusGeometry(0.058, 0.016, 6, 16), ink, [-0.065, 0, 0.027], badge); zero.scale.y = 1.3;
    rounded([0.032, 0.163, 0.025], [0.069, 0, 0.029], ink, 0.01, badge);
    rounded([0.065, 0.024, 0.025], [0.052, 0.071, 0.029], ink, 0.009, badge);
  }
  numberPlate([0, 0.753, 0.90], [-Math.PI / 2 + 0.25, 0, 0], 0.75);
  numberPlate([0, 0.61, -1.445], [0, Math.PI, 0], 0.65);

  const flame = new THREE.Group(); flame.name = 'boost_flames'; flame.visible = false;
  flame.position.set(0, 0.39, -1.583); group.add(flame);
  const outerFlame = new THREE.MeshBasicMaterial({ color: '#3ddcff', transparent: true, opacity: 0.65, depthWrite: false });
  const innerFlame = new THREE.MeshBasicMaterial({ color: '#e4ffff', transparent: true, opacity: 0.95, depthWrite: false });
  for (const side of [-1, 1]) {
    const outer = mesh(new THREE.ConeGeometry(0.17, 1.1, 12), outerFlame, [side * 0.44, 0, -0.53], flame);
    outer.rotation.x = -Math.PI / 2; outer.castShadow = false; outer.receiveShadow = false;
    const inner = mesh(new THREE.ConeGeometry(0.09, 0.75, 12), innerFlame, [side * 0.44, 0, -0.35], flame);
    inner.rotation.x = -Math.PI / 2; inner.castShadow = false; inner.receiveShadow = false;
  }
  mergeStaticParts(shell);
  wheels.forEach(wheel => mergeStaticParts(wheel.children[0] as THREE.Group));
  return { group, shell, wheels, flame, paint };
}

/** Rounded mask outline whose corner radius is independent of its thin depth. */
function roundedPanel(width: number, height: number, radius: number, depth: number) {
  const x = -width / 2, y = -height / 2, w = width, h = height, r = radius;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y); shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r); shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h); shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r); shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, steps: 1, curveSegments: 6 });
}

/** Batch rigid parts by material while preserving the four steering/axle pivots. */
function mergeStaticParts(root: THREE.Group) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.geometry as THREE.BufferGeometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    // All kart surfaces use solid colors: only position and normal are needed.
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    const parts = batches.get(object.material) ?? [];
    parts.push(geometry); batches.set(object.material, parts);
    source.dispose();
  });
  root.clear();
  for (const [material, parts] of batches) {
    const merged = mergeGeometries(parts)!;
    const item = new THREE.Mesh(mergeVertices(merged), material);
    item.name = material.name || `${root.name}_surface`;
    item.castShadow = true; item.receiveShadow = true; root.add(item);
    merged.dispose(); parts.forEach(part => part.dispose());
  }
}

/** Smooth, closed rounded-rectangle cross sections form a short tapered nose. */
function hoodGeometry(sections: number[][], segments: number) {
  const vertices: number[] = [], indices: number[] = [];
  for (const [z, halfWidth, bottom, top] of sections) {
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      vertices.push(Math.sign(c) * Math.abs(c) ** 0.55 * halfWidth,
        (top + bottom) / 2 + Math.sign(s) * Math.abs(s) ** 0.55 * (top - bottom) / 2, z);
    }
  }
  for (let ring = 0; ring < sections.length - 1; ring++) for (let i = 0; i < segments; i++) {
    const a = ring * segments + i, b = ring * segments + (i + 1) % segments;
    indices.push(a, b, a + segments, b, b + segments, a + segments);
  }
  for (const end of [0, sections.length - 1]) {
    const [z, , bottom, top] = sections[end], center = vertices.length / 3;
    vertices.push(0, (bottom + top) / 2, z);
    for (let i = 0; i < segments; i++) {
      const a = end * segments + i, b = end * segments + (i + 1) % segments;
      indices.push(center, end === 0 ? b : a, end === 0 ? a : b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
