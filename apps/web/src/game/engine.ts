import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CHECKPOINTS, getTrack, angleDiff, clamp, wrap, type RaceTrack, type TrackId } from './track';
import type { RaceMode } from './results';
export type { RaceMode } from './results';
import { FixedClock, advanceProgress, newProgress, raceProgress, type ProgressState } from './rules';
import { drive, newDrive, TUNING, type Controls, type DriveState } from './driving';
import { buildEnvironment, makeKart, loadModel, replaceScenery, disposeObject, PAINTS, type KartVisual, type Environment } from './visuals';
import { RaceAudio } from './audio';
import { DriftEffects } from './effects';
import { animateKart, selectKartDetail } from './kart-animation';
import { ReplayRecorder, REPLAY_REVISION, recordSector, replayPose, type Pose, type TimeRun } from './timing';
import { makeGhost, positionGhost } from './ghost';
import { assetUrl } from '../resources';

export type Phase = 'menu' | 'countdown' | 'racing' | 'paused' | 'finished';
export type Settings = { sound: boolean; quality: 'high' | 'low'; motion: boolean; difficulty: 'easy' | 'normal'; paint: number; trackId: TrackId; ghost: boolean };
export type Snapshot = {
  phase: Phase; countdown: number; elapsed: number; speed: number; lap: number; rank: number;
  charge: number; cans: number; boost: boolean; nitro: boolean; mini: boolean; miniProgress: number; drifting: boolean; driftTime: number;
  lapTimes: number[]; racers: { name: string; color: string; x: number; z: number; progress: number; finishedAt: number | null }[];
  wrongWay: boolean; offroad: boolean; hint: string; toast: string;
  ready: boolean; assets: number; fps: number; mode: RaceMode; trackId: TrackId;
  sectorEnds: number[]; referenceEnds: number[]; ghostAvailable: boolean; replayLimited: boolean;
};
type Racer = {
  name: string; visual: KartVisual; body: RAPIER.RigidBody; drive: DriveState; progress: ProgressState;
  x: number; z: number; prev: THREE.Vector3; previousYaw: number; t: number; offset: number;
  stuck: number; lastReset: number; lane: number; offroad: boolean; collision: boolean;
};
// React StrictMode mounts twice in development; initialize WASM only once.
// Concurrent init() calls can replace the module after a world already exists.
let physicsReady: Promise<void> | undefined;
export const initialSnapshot: Snapshot = {
  phase: 'menu', countdown: 3, elapsed: 0, speed: 0, lap: 1, rank: 1, charge: 0, cans: 0,
  boost: false, nitro: false, mini: false, miniProgress: 0, drifting: false, driftTime: 0, lapTimes: [], racers: [], wrongWay: false,
  offroad: false, hint: '准备出发', toast: '', ready: false, assets: 0, fps: 60, mode: 'race', trackId: 'coastline',
  sectorEnds: [], referenceEnds: [], ghostAvailable: false, replayLimited: false,
};

export class KartGame {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2200);
  renderer: THREE.WebGLRenderer;
  world!: RAPIER.World;
  environment!: Environment;
  racers: Racer[] = [];
  phase: Phase = 'menu';
  mode: RaceMode = 'race';
  elapsed = 0;
  countdown = 3.5;
  settings: Settings;
  readonly track: RaceTrack;
  audio = new RaceAudio();
  clock = new FixedClock();
  keys = new Set<string>();
  ready = false;
  assets = 0;
  disposed = false;
  private request = 0;
  private last = 0;
  private uiTimer = 0;
  private fps = 60;
  private menuTime = 0;
  private resumePhase: Phase = 'racing';
  private toast = '';
  private toastUntil = 0;
  private driftEffects = new DriftEffects();
  private observer: ResizeObserver;
  private cameraYaw = 0;
  private cameraLook = new THREE.Vector3();
  private autopilot = false;
  private finishedSent = false;
  private controls?: Controls;
  private garage = false;
  private ghost?: KartVisual;
  private availableRun?: TimeRun;
  private referenceRun?: TimeRun;
  private sectorEnds: number[] = [];
  private recorder = new ReplayRecorder();
  private error: (message: string) => void;
  onFinish?: (snapshot: Snapshot) => void;

  constructor(private host: HTMLElement, settings: Settings, private publish: (snapshot: Snapshot) => void, onError: (message: string) => void) {
    this.settings = settings; this.error = onError;
    this.track = getTrack(settings.trackId); this.audio.enabled = settings.sound;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = settings.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', `${this.track.name} 3D 赛车场景`);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host); this.resize();
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
  }
  async initialize() {
    await (physicsReady ??= RAPIER.init());
    if (this.disposed) return;
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.environment = buildEnvironment(this.scene, this.track);
    this.scene.add(this.driftEffects.group);
    this.createBarriers();
    this.createRacers();
    this.ghost = makeGhost(); this.scene.add(this.ghost.group);
    this.ready = true;
    this.camera.position.set(220, 260, 310); this.camera.lookAt(0, 0, 0);
    this.last = performance.now(); this.request = requestAnimationFrame(this.animate);
    await this.loadAssets();
  }
  private async loadAssets() {
    const specs = [
      { id: 'palm', url: '/models/palm.glb' },
      { id: 'rocks', url: '/models/rocks.glb' },
    ];
    // Asset errors remain visible in the library, while driving stays available.
    for (const spec of specs) {
      try {
        const source = await loadModel(assetUrl(spec.url));
        if (this.disposed) { disposeObject(source); return; }
        replaceScenery(spec.id === 'palm' ? this.environment.palms : this.environment.rocks, source, spec.id === 'palm' ? 9 : 4.8);
        this.assets++;
      } catch { this.notify('场景模型未加载，可在资产库检查'); }
    }
  }
  private createBarriers() {
    const geo = new THREE.BoxGeometry(0.5, 1, 4);
    const rail = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#f5eed6', roughness: 0.8 }), 180);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 90; i++) {
      const point = this.track.at(i / 90);
      for (let side = 0; side < 2; side++) {
        const p = point.position.clone().addScaledVector(point.right, (side ? 1 : -1) * (this.track.width / 2 + 1.8));
        p.y += 0.5;
        dummy.position.copy(p); dummy.rotation.set(0, point.yaw, 0); dummy.updateMatrix();
        rail.setMatrixAt(i * 2 + side, dummy.matrix);
        const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), point.yaw);
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 2, 2)
          .setTranslation(p.x, p.y, p.z).setRotation(rot).setRestitution(0.25).setFriction(0.05));
      }
    }
    rail.castShadow = true; rail.receiveShadow = true; this.scene.add(rail);
  }
  private createRacers() {
    const names = ['你', '椰子汽水', '橘子海', '追风少年', '薄荷冰', '晚风'];
    const colors = [PAINTS[this.settings.paint].hex, '#ffc36d', '#f98976', '#7797dc', '#b7d68a', '#dcaad9'];
    this.racers = names.map((name, i) => {
      const t = wrap(-(Math.floor(i / 2) * 4.5 + 4) / this.track.length);
      const spawn = this.track.at(t);
      const lane = (i % 2 ? -1 : 1) * 2;
      const p = spawn.position.clone().addScaledVector(spawn.right, lane);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y + 0.75, p.z).lockRotations().setLinearDamping(0).setCcdEnabled(true));
      this.world.createCollider(RAPIER.ColliderDesc.ball(1.02).setMass(150).setRestitution(0.3).setFriction(0), body);
      const visual = makeKart(colors[i]); visual.group.position.copy(p); visual.group.rotation.y = spawn.yaw; this.scene.add(visual.group);
      if (i > 0) {
        visual.low = makeKart(colors[i], 'low'); visual.low.group.visible = false;
        visual.group.add(visual.low.group);
      }
      return { name, body, visual, drive: newDrive(spawn.yaw), progress: newProgress(t),
        x: p.x, z: p.z, prev: p.clone(), previousYaw: spawn.yaw, t, offset: lane,
        stuck: 0, lastReset: -10, lane, offroad: false, collision: false };
    });
  }
  updateSettings(settings: Settings) {
    const paintChanged = settings.paint !== this.settings.paint;
    this.settings = settings; this.audio.enabled = settings.sound;
    this.renderer.shadowMap.enabled = settings.quality === 'high'; this.resize();
    if (paintChanged && this.racers[0]) {
      const racer = this.racers[0], old = racer.visual;
      const visual = makeKart(PAINTS[settings.paint].hex);
      visual.group.position.copy(old.group.position); visual.group.rotation.copy(old.group.rotation);
      this.scene.remove(old.group); disposeObject(old.group, false); this.scene.add(visual.group); racer.visual = visual;
    }
  }
  start(mode: RaceMode) {
    if (!this.ready || this.disposed) return;
    this.garage = false;
    this.mode = mode; this.elapsed = 0; this.countdown = 3.5; this.phase = 'countdown';
    this.finishedSent = false; this.keys.clear(); this.controls = undefined; this.autopilot = false; this.clock.reset();
    this.driftEffects.clear();
    this.referenceRun = mode === 'time' ? this.availableRun : undefined;
    this.sectorEnds = []; this.recorder = new ReplayRecorder();
    if (this.ghost) this.ghost.group.visible = false;
    this.racers.forEach((r, i) => {
      const t = wrap(-(Math.floor(i / 2) * 4.5 + 4) / this.track.length), p = this.track.at(t);
      const pos = p.position.clone().addScaledVector(p.right, (i % 2 ? -1 : 1) * 2);
      r.body.setTranslation({ x: pos.x, y: pos.y + 0.75, z: pos.z }, true);
      r.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      r.body.setEnabled(i === 0 || mode === 'race');
      r.x = pos.x; r.z = pos.z; r.prev.copy(pos); r.t = t; r.drive = newDrive(p.yaw);
      r.previousYaw = p.yaw; r.progress = newProgress(t); r.stuck = 0; r.lastReset = -10;
      r.offroad = false; r.collision = false;
      r.visual.group.visible = i === 0 || mode === 'race';
    });
    this.cameraYaw = this.racers[0].drive.yaw;
    if (mode === 'time') this.recorder.capture(0, this.playerPose(), true);
    void this.audio.unlock().catch(() => {});
    this.audio.beep(440); this.emit();
  }
  menu() {
    this.phase = 'menu'; this.keys.clear(); this.controls = undefined; this.autopilot = false; this.clock.reset();
    this.driftEffects.clear();
    this.racers.forEach(r => r.visual.group.visible = true); this.garage = false; this.emit();
  }
  setGarage(value: boolean) {
    this.garage = value;
    if (this.phase === 'menu') this.racers.forEach((r, i) => { r.visual.group.visible = i === 0 || !value; });
  }
  pause() {
    if (this.phase === 'paused') {
      // Clearing keys on pause is not an intentional Shift release.
      this.racers[0].drive.drifting = false; this.racers[0].drive.driftTime = 0;
      this.phase = this.resumePhase; this.clock.reset(); void this.audio.unlock().catch(() => {});
    } else if (this.phase === 'racing' || this.phase === 'countdown') {
      this.resumePhase = this.phase; this.phase = 'paused'; this.keys.clear(); this.controls = undefined;
    }
    this.emit();
  }
  private blur = () => { if (this.phase === 'racing' || this.phase === 'countdown') this.pause(); this.keys.clear(); };
  private visibility = () => { if (document.hidden) this.blur(); };
  private contextLost = (e: Event) => { e.preventDefault(); this.blur(); this.error('3D 渲染连接中断，请刷新页面重新进入。'); };
  private keyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement)?.matches('input,textarea,select')) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'Escape') this.pause();
    if (event.code === 'KeyR' && this.phase === 'racing') this.resetRacer(this.racers[0], true);
  };
  private keyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private playerInput(): Controls {
    if (this.autopilot) return this.aiInput(this.racers[0], 0);
    if (this.controls) return this.controls;
    const held = (...codes: string[]) => codes.some(c => this.keys.has(c));
    return { throttle: +held('KeyW', 'ArrowUp'), brake: held('KeyS', 'ArrowDown'),
      steer: +held('KeyA', 'ArrowLeft') - +held('KeyD', 'ArrowRight'),
      drift: held('ShiftLeft', 'ShiftRight'), boost: held('Space') };
  }
  private aiInput(r: Racer, i: number): Controls {
    const look = this.track.at(r.t + (7 + Math.abs(r.drive.speed) * 0.45) / this.track.length);
    const target = look.position.clone().addScaledVector(look.right, r.lane * 0.7);
    const desired = Math.atan2(target.x - r.x, target.z - r.z);
    const error = angleDiff(desired, r.drive.yaw);
    const curvature = Math.abs(angleDiff(this.track.at(r.t + 0.028).yaw, this.track.at(r.t).yaw));
    const base = this.settings.difficulty === 'easy' ? 24 : 30;
    const targetSpeed = Math.max(13, base - i * 0.35 - curvature * 15);
    return { throttle: r.drive.speed < targetSpeed ? 1 : 0, brake: r.drive.speed > targetSpeed + 2,
      steer: clamp(error * 2.4, -1, 1), drift: Math.abs(error) > 0.35 && r.drive.speed > 15,
      boost: curvature < 0.15 && r.drive.cans > 0 && this.elapsed % 5 < 0.1 };
  }
  private resetRacer(r: Racer, penalty: boolean) {
    if (this.elapsed - r.lastReset < 2) return;
    if (penalty && this.mode === 'time') this.recorder.capture(this.elapsed, this.playerPose(), true);
    const p = this.track.at(wrap(r.progress.passed / CHECKPOINTS + 0.003));
    const occupied = this.racers.filter(other => other !== r && other.body.isEnabled());
    const offsets = [0, -3.5, 3.5];
    const lane = offsets.find(l => occupied.every(o => Math.hypot(o.x - p.position.x - p.right.x * l, o.z - p.position.z - p.right.z * l) > 3)) ?? 0;
    p.position.addScaledVector(p.right, lane);
    r.body.setTranslation({ x: p.position.x, y: p.position.y + 0.75, z: p.position.z }, true);
    r.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    r.x = p.position.x; r.z = p.position.z; r.prev.copy(p.position);
    r.drive = { ...newDrive(p.yaw), cans: r.drive.cans, charge: r.drive.charge };
    r.previousYaw = p.yaw; r.t = wrap(r.progress.passed / CHECKPOINTS + 0.003);
    r.progress.previous = r.t; r.stuck = 0; r.lastReset = this.elapsed;
    if (penalty) {
      if (this.mode === 'time') this.recorder.capture(this.elapsed, this.playerPose(), true, true);
      this.elapsed += 2;
      if (this.mode === 'time') this.recorder.capture(this.elapsed, this.playerPose(), true);
      this.notify('已回到赛道 · 用时 +2 秒');
    }
  }
  private tick(dt: number) {
    if (this.phase === 'countdown') {
      const previous = Math.ceil(this.countdown);
      this.countdown -= dt;
      if (Math.ceil(this.countdown) !== previous) this.audio.beep(this.countdown <= 0 ? 880 : 440);
      if (this.countdown <= 0) { this.phase = 'racing'; this.notify(this.track.theme === 'desert' ? 'GO! 追着落日出发' : 'GO! 迎着海风出发'); }
      return;
    }
    if (this.phase !== 'racing') return;
    this.elapsed += dt;
    for (const [i, r] of this.racers.entries()) {
      if (!r.body.isEnabled()) continue;
      r.prev.copy(r.visual.group.position); r.prev.set(r.x, r.visual.group.position.y, r.z); r.previousYaw = r.drive.yaw;
      const projection = this.track.project(r.x, r.z); r.t = projection.progress; r.offset = projection.offset;
      r.offroad = projection.distance > this.track.width / 2;
      const velocity = r.body.linvel();
      r.collision = Math.hypot(velocity.x - r.drive.vx, velocity.z - r.drive.vz) > 5;
      r.drive.vx = velocity.x; r.drive.vz = velocity.z;
      const input = i === 0 ? this.playerInput() : this.aiInput(r, i);
      drive(r.drive, input, dt, r.offroad, r.collision);
      r.body.setLinvel({ x: r.drive.vx, y: 0, z: r.drive.vz }, true);
      r.body.setTranslation({ x: r.x, y: projection.position.y + 0.75, z: r.z }, true);
      r.stuck = Math.abs(r.drive.speed) < 2 && input.throttle ? r.stuck + dt : 0;
      if (projection.distance > 28 || r.stuck > (i ? 3 : 6)) this.resetRacer(r, i === 0);
    }
    this.world.timestep = dt; this.world.step();
    for (const [i, r] of this.racers.entries()) {
      if (!r.body.isEnabled()) continue;
      const position = r.body.translation(); r.x = position.x; r.z = position.z;
      const p = this.track.project(r.x, r.z); r.t = p.progress;
      const completedLap = advanceProgress(r.progress, p.progress, this.elapsed, p.distance <= this.track.width / 2 + 1);
      if (i === 0 && completedLap && !r.progress.finishedAt) {
        this.notify(`第 ${r.progress.lapTimes.length} 圈完成`); this.audio.beep(900, 0.2);
      }
    }
    const player = this.racers[0];
    if (this.mode === 'time') {
      recordSector(this.sectorEnds, player.progress.passed, this.elapsed);
      this.recorder.capture(this.elapsed, this.playerPose(), player.progress.finishedAt !== null);
    }
    if (player.progress.finishedAt !== null && !this.finishedSent) {
      this.finishedSent = true; this.phase = 'finished'; this.keys.clear();
      this.audio.beep(1000, 0.4); this.emit(); this.onFinish?.(this.snapshot());
    }
  }
  private animate = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min((now - this.last) / 1000, 0.1); this.last = now;
    this.fps += ((1 / Math.max(dt, 0.001)) - this.fps) * 0.035;
    const alpha = this.clock.consume(dt, step => this.tick(step));
    if (this.phase === 'menu') this.menuTime += dt;
    const racing = this.phase === 'racing';
    for (const r of this.racers) {
      if (this.phase !== 'paused') {
        const p = r.body.translation(), blend = racing ? alpha : 1;
        r.visual.group.position.set(THREE.MathUtils.lerp(r.prev.x, p.x, blend), p.y - 0.75, THREE.MathUtils.lerp(r.prev.z, p.z, blend));
        r.visual.group.rotation.y = r.previousYaw + angleDiff(r.drive.yaw, r.previousYaw) * blend;
      }
      const active = selectKartDetail(r.visual, r.visual.group.position.distanceTo(this.camera.position));
      animateKart(r.visual, active, r.drive, dt, racing, this.elapsed);
      if (this.phase === 'menu') active.flame.visible = false;
    }
    this.moveCamera(dt);
    this.renderGhost();
    const player = this.racers[0];
    if (racing) this.driftEffects.update(dt, player.visual.group.position, player.drive, this.settings.quality === 'low');
    this.audio.update(player.drive.speed, player.drive.drifting, player.drive.boostTime > 0, this.phase === 'racing');
    this.renderer.render(this.scene, this.camera);
    this.uiTimer += dt; if (this.uiTimer > 0.09) { this.emit(); this.uiTimer = 0; }
    this.request = requestAnimationFrame(this.animate);
  };
  private moveCamera(dt: number) {
    const player = this.racers[0];
    let target: THREE.Vector3, look: THREE.Vector3;
    if (this.phase === 'menu' && !this.garage) {
      target = new THREE.Vector3(240 + Math.sin(this.menuTime * 0.08) * 20, 275, 325);
      look = new THREE.Vector3(5, -12, 6);
      if (this.track.theme === 'desert') { target.multiplyScalar(1.18); look.set(0, -5, -5); }
    } else if (this.phase === 'menu' && this.garage) {
      const p = player.visual.group.position;
      const angle = this.menuTime * 0.3 + player.drive.yaw;
      target = p.clone().add(new THREE.Vector3(Math.sin(angle) * 7.2, 3.2, Math.cos(angle) * 7.2));
      look = p.clone().add(new THREE.Vector3(0, 0.7, 0));
    } else {
      const p = player.visual.group.position;
      this.cameraYaw += angleDiff(player.visual.group.rotation.y, this.cameraYaw) * (1 - Math.exp(-dt * 10));
      const forward = new THREE.Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw));
      target = p.clone().addScaledVector(forward, -8.7).add(new THREE.Vector3(0, 5.2, 0));
      look = p.clone().addScaledVector(forward, 8).add(new THREE.Vector3(0, 1.0, 0));
    }
    const rate = this.phase === 'menu' ? 2 : 8;
    this.camera.position.lerp(target, 1 - Math.exp(-dt * rate));
    this.cameraLook.lerp(look, 1 - Math.exp(-dt * (this.phase === 'menu' ? 3 : 14)));
    this.camera.lookAt(this.cameraLook);
    const fov = this.phase === 'menu' ? 45 : 62 + (player.drive.boostTime > 0 ? 9 : player.drive.miniTime > 0 ? 4 : 0);
    if (!this.settings.motion) this.camera.fov = this.phase === 'menu' ? 45 : 62;
    else this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 4));
    this.camera.updateProjectionMatrix();
  }
  notify(message: string) { this.toast = message; this.toastUntil = performance.now() + 3000; }
  setTimeReference(run?: TimeRun) {
    this.availableRun = run?.trackId === this.track.id ? run : undefined;
  }
  completedTimeRun(): TimeRun | undefined {
    if (this.phase !== 'finished' || this.mode !== 'time' || this.sectorEnds.length !== 9) return;
    return { revision: REPLAY_REVISION, trackId: this.track.id, total: this.elapsed,
      ends: [...this.sectorEnds], frames: this.recorder.limited ? null : this.recorder.frames };
  }
  private playerPose(): Pose {
    const r = this.racers[0], d = r.drive;
    return { x: r.x, y: r.body.translation().y - 0.75, z: r.z, yaw: d.yaw,
      steer: d.steerVisual, speed: d.speed, flags: +d.drifting | (d.boostTime > 0 ? 2 : 0) | (d.miniTime > 0 ? 4 : 0) };
  }
  private renderGhost() {
    if (!this.ghost) return;
    const frames = this.referenceRun?.frames;
    const pose = this.mode === 'time' && this.settings.ghost && this.phase !== 'menu' && frames ? replayPose(frames, this.elapsed) : null;
    this.ghost.group.visible = !!pose;
    if (pose) positionGhost(this.ghost, pose);
  }
  snapshot(): Snapshot {
    const p = this.racers[0]; if (!p || this.disposed) return { ...initialSnapshot, trackId: this.track.id, ready: this.ready && !this.disposed };
    const active = this.racers.filter(r => r.body.isEnabled());
    const sorted = [...active].sort((a, b) => {
      if (a.progress.finishedAt !== null && b.progress.finishedAt !== null) return a.progress.finishedAt - b.progress.finishedAt;
      if (a.progress.finishedAt !== null) return -1;
      if (b.progress.finishedAt !== null) return 1;
      return raceProgress(b.progress, b.t) - raceProgress(a.progress, a.t);
    });
    const ahead = angleDiff(this.track.at(p.t + 0.04).yaw, this.track.at(p.t).yaw);
    return {
      phase: this.phase, countdown: Math.ceil(this.countdown), elapsed: this.elapsed,
      speed: Math.round(Math.abs(p.drive.speed) * 3.6), lap: Math.min(3, 1 + p.progress.lapTimes.length),
      rank: sorted.indexOf(p) + 1, charge: p.drive.charge, cans: p.drive.cans,
      boost: p.drive.boostTime > 0 || p.drive.miniTime > 0, drifting: p.drive.drifting, driftTime: p.drive.driftTime,
      nitro: p.drive.boostTime > 0, mini: p.drive.miniTime > 0,
      miniProgress: clamp(p.drive.driftTime / TUNING.miniChargeTime, 0, 1),
      lapTimes: [...p.progress.lapTimes], racers: sorted.map(r => ({
        name: r.name, color: r.visual.paint, x: r.x, z: r.z,
        progress: raceProgress(r.progress, r.t), finishedAt: r.progress.finishedAt,
      })),
      wrongWay: Math.abs(angleDiff(this.track.at(p.t).yaw, p.drive.yaw)) > Math.PI * 0.6 && Math.abs(p.drive.speed) > 3,
      offroad: p.offroad, hint: Math.abs(ahead) < 0.3 ? '直道 · 全速前进' : `${ahead > 0 ? '左' : '右'}弯 · Shift 漂移`,
      toast: performance.now() < this.toastUntil ? this.toast : '', ready: this.ready, assets: this.assets,
      fps: Math.round(this.fps), mode: this.mode, trackId: this.track.id,
      sectorEnds: [...this.sectorEnds], referenceEnds: [...(this.referenceRun?.ends ?? [])],
      ghostAvailable: !!this.referenceRun?.frames, replayLimited: this.recorder.limited,
    };
  }
  private emit() { this.publish(this.snapshot()); }
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.settings.quality === 'high' ? 1.75 : 1));
    this.camera.aspect = Math.max(1, width) / Math.max(1, height); this.camera.updateProjectionMatrix();
  }
  /** Explicit development harness, only exposed by the app in Vite development mode. */
  debug() {
    return {
      snapshot: () => this.snapshot(),
      diagnostics: () => ({
        renderer: this.renderer.info.render, memory: this.renderer.info.memory,
        effects: this.driftEffects.stats(), fov: this.camera.fov,
        ghost: { visible: !!this.ghost?.group.visible, position: this.ghost?.group.position.toArray(),
          samples: this.recorder.frames.length, limited: this.recorder.limited,
          referenceTotal: this.referenceRun?.total, pose: this.referenceRun?.frames ? replayPose(this.referenceRun.frames, this.elapsed) : null },
        visuals: this.racers.map(r => ({
          position: r.visual.group.position.toArray(), yaw: r.visual.group.rotation.y,
          wheels: r.visual.wheels.map(w => w.children[0].quaternion.toArray()),
          flameScale: r.visual.flame.scale.z, low: !!r.visual.low?.group.visible,
        })),
        racers: this.racers.map(r => ({ name: r.name, passed: r.progress.passed, resets: r.lastReset, yaw: r.drive.yaw })),
      }),
      autopilot: (enabled: boolean) => { this.autopilot = enabled; },
      input: (input?: Controls) => { this.controls = input; },
      advance: (seconds: number, autopilot = false) => {
        for (let n = 0; n < seconds * 60; n++) {
          if (autopilot) this.controls = this.aiInput(this.racers[0], 0);
          this.tick(1 / 60);
        }
        this.controls = undefined; this.emit(); return this.snapshot();
      },
      start: (mode: RaceMode = 'race') => this.start(mode),
      pause: () => this.pause(),
      reset: () => this.resetRacer(this.racers[0], true),
    };
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.request); this.observer.disconnect();
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.audio.dispose(); this.world?.free();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        if (o instanceof THREE.InstancedMesh) o.dispose();
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          materials.add(m); Object.values(m).forEach(v => { if (v instanceof THREE.Texture) textures.add(v); });
        });
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
