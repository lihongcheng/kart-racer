import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { getTrack, type RaceTrack } from './track';
import { instanceInCells } from './instancing';
export { makeKart, KART_WHEEL_RADIUS, type KartVisual } from './kart-model';

export const PAINTS = [
  { name: '海湾蓝', hex: '#219cde', accent: '#17384b' },
  { name: '日落橘子', hex: '#ff8057', accent: '#653427' },
  { name: '奶油柠檬', hex: '#e5f26b', accent: '#424925' },
];
const mat = (color: THREE.ColorRepresentation, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
export function box(w: number, h: number, d: number, color: THREE.ColorRepresentation) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = true; m.receiveShadow = true; return m;
}
function cylinder(top: number, bottom: number, height: number, color: THREE.ColorRepresentation, segments = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), mat(color));
  m.castShadow = true; m.receiveShadow = true; return m;
}

function ribbon(points: RaceTrack['points'], inner: number, outer: number, color: THREE.ColorRepresentation, height = 0) {
  const vertices: number[] = [], indices: number[] = [];
  for (let i = 0; i <= points.length; i++) {
    const a = points[i % points.length], b = points[(i + 1) % points.length];
    const normal = new THREE.Vector3(b.z - a.z, 0, -(b.x - a.x)).normalize();
    for (const offset of [inner, outer]) vertices.push(a.x + normal.x * offset, a.y + height, a.z + normal.z * offset);
    if (i < points.length) {
      const k = i * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.95 }));
  mesh.receiveShadow = true; return mesh;
}

export function makePalm() {
  const group = new THREE.Group();
  const trunk = cylinder(0.35, 0.65, 7, '#ac8055');
  trunk.position.y = 3.5; trunk.rotation.z = 0.1; group.add(trunk);
  const material = mat('#329975');
  for (let j = 0; j < 7; j++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.2, 5.6, 4), material);
    leaf.position.set(Math.sin(j * 0.9) * 1.8, 6.8, Math.cos(j * 0.9) * 1.8);
    leaf.rotation.set(Math.cos(j * 0.9) * 1.4, j * 0.9, -Math.sin(j * 0.9) * 1.4);
    leaf.castShadow = true; group.add(leaf);
  }
  return group;
}

export type Environment = { palms: THREE.Group; rocks: THREE.Group; ocean: THREE.Mesh; decorations: THREE.Group };
export function buildEnvironment(scene: THREE.Scene, track = getTrack('coastline')): Environment {
  const { at: trackAt, length: trackLength, width: ROAD_WIDTH, points } = track;
  const desert = track.theme === 'desert';
  scene.background = new THREE.Color(desert ? '#edb791' : '#9edee1');
  scene.fog = new THREE.Fog(desert ? '#ecc2a2' : '#b0e4e3', 450, 1100);
  scene.add(new THREE.HemisphereLight(desert ? '#fff1db' : '#eefcf4', desert ? '#b47d62' : '#6caaa0', 2.1));
  const sun = new THREE.DirectionalLight(desert ? '#ffcea0' : '#fff4d2', 2.6);
  sun.position.set(-80, 170, 80); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowSize = desert ? 220 : 175;
  Object.assign(sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 10, far: 500 });
  sun.shadow.normalBias = 0.07; scene.add(sun);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 1, 1), new THREE.MeshStandardMaterial({ color: desert ? '#cc9670' : '#53bec6', roughness: desert ? 1 : 0.42, metalness: desert ? 0 : 0.15 }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -3.4; scene.add(ocean);
  const island = new THREE.Mesh(new THREE.CylinderGeometry(desert ? 214 : 172, desert ? 230 : 186, 6, 64), mat(desert ? '#d09a76' : '#e5d3a3'));
  island.scale.z = desert ? 1 : 0.85; island.position.set(6, -3.5, 9); island.receiveShadow = true; scene.add(island);
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(desert ? 205 : 153, desert ? 211 : 160, 1.2, 64), mat(desert ? '#dcaf83' : '#9fc484'));
  grass.scale.z = desert ? 1 : 0.89; grass.position.set(6, -0.55, 9); grass.receiveShadow = true; scene.add(grass);
  scene.add(ribbon(points, -ROAD_WIDTH / 2 - 1, ROAD_WIDTH / 2 + 1, desert ? '#e9c69a' : '#f8edca', -0.1));
  scene.add(ribbon(points, -ROAD_WIDTH / 2, ROAD_WIDTH / 2, desert ? '#675d5b' : '#505c60'));
  scene.add(ribbon(points, -ROAD_WIDTH / 2 + 0.3, -ROAD_WIDTH / 2 + 0.48, '#f4f0d7', 0.025));
  scene.add(ribbon(points, ROAD_WIDTH / 2 - 0.48, ROAD_WIDTH / 2 - 0.3, '#f4f0d7', 0.025));
  const decorations = new THREE.Group(); scene.add(decorations);
  const kerbGeo = new THREE.BoxGeometry(0.7, 0.12, trackLength / 320 + 0.05);
  const kerbs = new THREE.InstancedMesh(kerbGeo, mat('#fff7df'), 640);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 320; i++) {
    const p = trackAt(i / 320);
    for (let side = 0; side < 2; side++) {
      dummy.position.copy(p.position).addScaledVector(p.right, (side ? 1 : -1) * (ROAD_WIDTH / 2 + 0.2));
      dummy.rotation.set(0, p.yaw, 0); dummy.updateMatrix();
      kerbs.setMatrixAt(i * 2 + side, dummy.matrix);
      kerbs.setColorAt(i * 2 + side, new THREE.Color(i % 2 ? '#f3eacb' : '#ed795e'));
    }
  }
  kerbs.receiveShadow = true; decorations.add(kerbs);
  const dash = box(0.14, 0.03, 2.2, '#d1cdb7');
  dash.castShadow = false;
  const dashPlacements: THREE.Matrix4[] = [];
  for (let i = 0; i < 120; i++) {
    const p = trackAt(i / 120);
    dummy.position.copy(p.position); dummy.position.y += 0.035; dummy.rotation.set(0, p.yaw, 0); dummy.updateMatrix();
    dashPlacements.push(dummy.matrix.clone());
  }
  decorations.add(instanceInCells(dash, dashPlacements));
  const start = trackAt(0);
  const gate = new THREE.Group();
  for (const side of [-1, 1]) {
    const post = box(0.7, 9, 0.7, '#f3eee0'); post.position.set(side * 9, 4.5, 0); gate.add(post);
    const stripe = box(0.8, 2.4, 0.8, '#ed7657'); stripe.position.set(side * 9, 1.2, 0); gate.add(stripe);
  }
  const gateColor = desert ? '#804732' : '#194c43';
  const banner = box(19, 2.2, 0.6, gateColor); banner.position.y = 9; gate.add(banner);
  const letters = makeText(desert ? 'SUNSET CANYON / START' : 'COASTLINE  /  START', '#f4f5d9', gateColor, 1024, 128);
  letters.scale.set(17.5, 1.65, 1); letters.position.set(0, 9, -0.34); letters.rotation.y = Math.PI; gate.add(letters);
  gate.position.copy(start.position); gate.rotation.y = start.yaw; decorations.add(gate);
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.025, 1), mat('#ffffff'), 30);
  tiles.receiveShadow = true;
  for (let x = 0; x < 10; x++) for (let z = 0; z < 3; z++) {
    const pos = start.position.clone().addScaledVector(start.right, x * 1.5 - 6.75).addScaledVector(start.tangent, z - 1);
    dummy.position.copy(pos); dummy.position.y += 0.035; dummy.rotation.set(0, start.yaw, 0); dummy.updateMatrix();
    tiles.setMatrixAt(x * 3 + z, dummy.matrix);
    tiles.setColorAt(x * 3 + z, new THREE.Color((x + z) % 2 ? '#fff6dd' : '#293f3d'));
  }
  decorations.add(tiles);
  const palms = new THREE.Group(), rocks = new THREE.Group(); scene.add(palms, rocks);
  const treeCount = desert ? 15 : 44;
  for (let i = 0; i < treeCount; i++) {
    const t = (i + 0.45) / treeCount, p = trackAt(t);
    const side = i % 3 === 0 ? -1 : 1;
    const position = p.position.clone().addScaledVector(p.right, side * (14 + (i % 4) * 3));
    if (track.project(position.x, position.z).distance < ROAD_WIDTH / 2 + 5) continue;
    const tree = makePalm();
    tree.position.copy(position);
    tree.position.y = -0.15; tree.scale.setScalar(0.8 + (i % 5) * 0.13);
    tree.rotation.y = i * 1.7; palms.add(tree);
  }
  for (let i = 0; i < 24; i++) {
    const p = trackAt((i + 0.7) / 24);
    const position = p.position.clone().addScaledVector(p.right, (i % 2 ? 1 : -1) * 19);
    if (track.project(position.x, position.z).distance < ROAD_WIDTH / 2 + 6) continue;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4, 0), mat('#d5bba0'));
    rock.position.copy(position);
    rock.position.y = 0.7; rock.scale.set(1.5, 0.8, 1); rock.rotation.y = i;
    rock.castShadow = true; rocks.add(rock);
  }
  // Trackside architecture and markers are hand-built game geometry.
  for (let i = 0; i < 8; i++) {
    const p = trackAt((i + 0.3) / 8);
    const sign = new THREE.Group();
    const pole = cylinder(0.1, 0.1, 3, '#f7ead0'); pole.position.y = 1.5; sign.add(pole);
    const plate = box(3.5, 1.8, 0.22, '#234b40'); plate.position.y = 3.3; sign.add(plate);
    const arrow = makeText('› › ›', '#e5f26b', '#234b40', 256, 128);
    arrow.position.set(0, 3.3, -0.14); arrow.rotation.y = Math.PI; arrow.scale.set(3.2, 1.4, 1); sign.add(arrow);
    sign.position.copy(p.position).addScaledVector(p.right, -10.5); sign.rotation.y = p.yaw;
    decorations.add(sign);
  }
  if (desert) {
    // Layered sandstone mesas. Exclude the whole footprint from every road segment.
    const sites = [[-76, -68, 13, 28], [81, -65, 14, 35], [9, 20, 19, 24],
      [-79, 43, 14, 32], [-196, -31, 18, 40], [-180, -166, 27, 53],
      [-54, -198, 28, 42], [123, -188, 24, 56], [209, -62, 22, 45],
      [205, 78, 22, 36], [-191, 140, 19, 34], [27, 198, 24, 28]];
    sites.forEach(([x, z, radius, height], i) => {
      if (track.project(x, z).distance < radius + ROAD_WIDTH / 2 + 4) return;
      const mesa = new THREE.Group();
      for (let layer = 0; layer < 4; layer++) {
        const r = radius * (1 - layer * 0.12), h = height / 4;
        const rock = cylinder(r * 0.88, r, h, ['#ac684a', '#c4865a', '#d9a16e', '#ecc08c'][layer], 7);
        rock.position.y = h * (layer + 0.5); mesa.add(rock);
      }
      mesa.position.set(x, 0, z); mesa.rotation.y = i * 0.8; decorations.add(mesa);
    });
    const disk = new THREE.Mesh(new THREE.SphereGeometry(27, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffe3a6', fog: false }));
    disk.position.set(-310, 145, -520); decorations.add(disk);
  } else {
  // Lighthouse beyond the north bend.
  const lighthouse = new THREE.Group();
  const tower = cylinder(2, 3, 15, '#f2eddf', 16); tower.position.y = 7.5; lighthouse.add(tower);
  const band = cylinder(2.3, 2.6, 3, '#e97c60', 16); band.position.y = 7; lighthouse.add(band);
  const top = cylinder(3, 3, 2.2, '#234b40', 12); top.position.y = 16; lighthouse.add(top);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4, 3, 12), mat('#e97c60'));
  roof.position.y = 18.5; lighthouse.add(roof); lighthouse.position.set(100, 0, -120); decorations.add(lighthouse);
  for (let i = 0; i < 3; i++) {
    const hut = new THREE.Group();
    const body = box(9, 5, 7, ['#e59271', '#e3cf84', '#f0e6ca'][i]); body.position.y = 2.5; hut.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.5, 3.8, 4), mat('#397e6c'));
    roof.rotation.y = Math.PI / 4; roof.position.y = 6.6; hut.add(roof);
    hut.position.set(-58 + i * 16, 0, 24); decorations.add(hut);
  }
  }
  return { palms, rocks, ocean, decorations };
}

function makeText(text: string, color: string, background: string, w: number, h: number) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); ctx.fillStyle = color;
  ctx.font = `900 ${h * 0.6}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2, w * 0.93);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
export async function loadModel(url: string) {
  const gltf = await loader.loadAsync(url);
  gltf.scene.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true; o.receiveShadow = true;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      materials.forEach(m => { if (m instanceof THREE.MeshStandardMaterial) m.roughness = Math.max(m.roughness, 0.5); });
    }
  });
  return gltf.scene;
}
export function normalizeModel(model: THREE.Object3D, size: number) {
  const bounds = new THREE.Box3().setFromObject(model), dimensions = bounds.getSize(new THREE.Vector3());
  const scale = size / Math.max(dimensions.x, dimensions.y, dimensions.z);
  const center = bounds.getCenter(new THREE.Vector3());
  const wrapper = new THREE.Group(); wrapper.add(model);
  model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  wrapper.scale.setScalar(scale);
  return wrapper;
}
export function replaceScenery(group: THREE.Group, source: THREE.Object3D, size: number) {
  const previousItems = [...group.children];
  const placements = previousItems.map(previous => { previous.updateMatrix(); return previous.matrix.clone(); });
  const batches = instanceInCells(normalizeModel(source, size), placements);
  for (const previous of previousItems) {
    group.remove(previous);
    disposeObject(previous);
  }
  group.add(batches);
}

export function disposeObject(object: THREE.Object3D, textures = true) {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child instanceof THREE.InstancedMesh) child.dispose();
    if (!child.userData.sharedGeometry) child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (textures) Object.values(material).forEach(value => { if (value instanceof THREE.Texture) value.dispose(); });
      material.dispose();
    }
  });
}
