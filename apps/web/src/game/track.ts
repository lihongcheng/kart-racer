import { CatmullRomCurve3, Vector3 } from 'three';

export const TRACK_SAMPLES = 640;
export const CHECKPOINTS = 24;
export const wrap = (n: number, max = 1) => ((n % max) + max) % max;
export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const angleDiff = (target: number, current: number) => Math.atan2(Math.sin(target - current), Math.cos(target - current));

export type TrackId = 'coastline' | 'canyon';
type TrackSpec = {
  id: TrackId; name: string; subtitle: string; theme: 'island' | 'desert';
  description: string; features: string; width: number;
  medals: Readonly<{ gold: number; silver: number; bronze: number }>;
};
function createTrack(spec: TrackSpec, nodes: number[][], height: number, elevation: number) {
  const curve = new CatmullRomCurve3(
    nodes.map(([x, z], i) => new Vector3(x, height + Math.sin(i / nodes.length * Math.PI * 2) * elevation, z)),
    true, 'catmullrom', 0.4,
  );
  const points = Object.freeze(curve.getSpacedPoints(TRACK_SAMPLES).slice(0, -1).map(p => Object.freeze(p)));
  const length = curve.getLength();
  function at(progress: number) {
    const t = wrap(progress), position = curve.getPointAt(t), tangent = curve.getTangentAt(t).normalize();
    return { position, tangent, right: new Vector3(tangent.z, 0, -tangent.x).normalize(), yaw: Math.atan2(tangent.x, tangent.z) };
  }
  function project(x: number, z: number) {
    let distanceSq = Infinity, index = 0, fraction = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const f = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const d = (x - a.x - f * dx) ** 2 + (z - a.z - f * dz) ** 2;
      if (d < distanceSq) { distanceSq = d; index = i; fraction = f; }
    }
    const a = points[index], b = points[(index + 1) % points.length];
    const tangent = b.clone().sub(a).normalize(), position = a.clone().lerp(b, fraction);
    const right = new Vector3(tangent.z, 0, -tangent.x).normalize();
    return { progress: (index + fraction) / TRACK_SAMPLES, position, tangent, right,
      offset: (x - position.x) * right.x + (z - position.z) * right.z, distance: Math.sqrt(distanceSq) };
  }
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
  const scale = Math.min(192 / (maxX - minX), 152 / (maxZ - minZ));
  const mapPosition = (x: number, z: number) => ({ x: 110 + (x - (minX + maxX) / 2) * scale, y: 90 + (z - (minZ + maxZ) / 2) * scale });
  const minimapPath = points.filter((_, i) => i % 4 === 0).map((p, i) => {
    const m = mapPosition(p.x, p.z);
    return `${i === 0 ? 'M' : 'L'}${m.x.toFixed(1)},${m.y.toFixed(1)}`;
  }).join(' ') + ' Z';
  return Object.freeze({ ...spec, medals: Object.freeze(spec.medals), points, length, at, project, minimapPath, mapPosition });
}

export const TRACKS = Object.freeze([
  createTrack({
    id: 'coastline', name: '海风环线', subtitle: 'COASTLINE CIRCUIT', theme: 'island', width: 15,
    description: '从海边拱门出发，穿过棕榈林、绕过灯塔，在海风里完成一圈。',
    features: '入门友好 · 海岸长弯', medals: { gold: 100, silver: 120, bronze: 150 },
  }, [[0, 108], [-76, 102], [-121, 49], [-112, -26], [-67, -76], [-22, -42],
    [16, -25], [47, -89], [111, -88], [140, -19], [116, 55], [57, 102]], 1.1, 1),
  createTrack({
    id: 'canyon', name: '落日峡谷', subtitle: 'SUNSET CANYON', theme: 'desert', width: 15,
    description: '沿砂岩台地驶入夕阳，在连续回头弯与起伏长坡之间，找准下一次出弯的时机。',
    features: '进阶挑战 · 连续回头弯', medals: { gold: 140, silver: 170, bronze: 210 },
  }, [[0, 114], [-83, 111], [-142, 71], [-149, 9], [-120, -46], [-150, -102],
    [-104, -141], [-45, -123], [-21, -57], [29, -53], [55, -122], [118, -120],
    [154, -67], [137, 0], [103, 38], [132, 88], [78, 126]], 3, 2),
]);
export type RaceTrack = typeof TRACKS[number];
export const isTrackId = (value: unknown): value is TrackId => TRACKS.some(t => t.id === value);
export const getTrack = (id: unknown): RaceTrack => TRACKS.find(t => t.id === id) ?? TRACKS[0];

// Default-track aliases for existing consumers; no mutable global selection.
export const { width: ROAD_WIDTH, points, length: trackLength, at: trackAt, project, minimapPath, mapPosition } = TRACKS[0];
