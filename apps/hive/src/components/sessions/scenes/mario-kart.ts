/**
 * Mario Kart — a 3D kart race through winding green countryside.
 *
 * A WebGL scene (three.js) with a chase camera behind the player's kart:
 *   - A curving, rolling paved circuit with red/white curbs + a dashed line
 *   - Green rolling-hill terrain, trees, and warp pipes scrolling past
 *   - A full pack of rival karts in different colors, jockeying for position
 *   - Floating item boxes + spinning coins on the track
 *   - A blue sky with a sun and drifting low-poly clouds
 *
 * Reactions:
 *   - Idle:      the pack weaves along the course; karts hop now and then
 *   - Streaming: the whole field rushes faster, the player leans in, speed
 *                lines streak past, the FOV widens
 *   - Tool call: the player kart power-drifts — sparks charge blue → orange
 *                → pink, then release into a boost flare. Every 3rd one is a
 *                "star dash" (the kart flashes the rainbow). The pack hops.
 *   - Item box:  collecting one pops a small mushroom boost.
 *
 * The host applies the global dimmer, so this renders at full strength.
 */

import * as THREE from 'three';
import type { SceneBuilder } from './types';
import { computeBoosts } from './activity';

const TERRAIN_W = 116;
const TERRAIN_D = 210;
const TERR_SEG_W = 46;
const TERR_SEG_D = 76;
const TERR_BASE_Y = -2.2;
const TRACK_LEN = 210;
const TRACK_SEGS = 92;
const TRACK_SEG_W = 8;        // cols: 0/8 curb, 4 centerline, rest road
const TRACK_W = 11;
const CORRIDOR = 8.5;         // flat half-width carved around the track
const RIDE_HEIGHT = 0.12;
const KART_Z = -1;            // the player sits just ahead of the camera

const RIVAL_COUNT = 6;
const TREE_COUNT = 12;
const PIPE_COUNT = 6;
const CLOUD_COUNT = 5;
const COIN_COUNT = 14;
const ITEMBOX_COUNT = 5;
const SPARK_COUNT = 110;
const SPEEDLINE_COUNT = 14;
const DRIFT_DUR = 1.05;
const STARDASH_DUR = 1.15;
const HOP_DUR = 0.5;
const IDLE_HOP_GAP = 6000;    // ms

const SPARK_BLUE = new THREE.Color('#39a9ff');
const SPARK_ORANGE = new THREE.Color('#ff9b2e');
const SPARK_PINK = new THREE.Color('#ff5ed0');
const COIN_GOLD = '#ffd23f';
// Rival kart palettes: [body, trim, driver].
const RIVAL_COLORS: [string, string, string][] = [
  ['#e23b3b', '#ffffff', '#4a2f1c'],
  ['#3b74e2', '#ffe14d', '#1c2c44'],
  ['#39bf4d', '#ffffff', '#7a3a1a'],
  ['#f2c029', '#333333', '#3a3a3a'],
  ['#a23be2', '#ffffff', '#2c1c44'],
  ['#ff8a2b', '#333333', '#42301c'],
];

/** Track centerline X as a function of sample Z — a winding circuit. */
function trackCurve(z: number): number {
  return Math.sin(z * 0.016) * 7.5 + Math.sin(z * 0.0059 + 1.3) * 4.6;
}
/** Track / corridor elevation as a function of sample Z — rolling hills. */
function trackElevation(z: number): number {
  return Math.sin(z * 0.012 + 0.6) * 1.8 + Math.sin(z * 0.026) * 0.7;
}
/** Off-track hill height. */
function hills(x: number, z: number): number {
  return Math.sin(x * 0.075) * Math.cos(z * 0.06) * 3.2 +
    Math.sin(x * 0.12 + z * 0.05) * 1.8 +
    Math.cos(x * 0.04 - z * 0.03) * 1.2;
}
/** Full terrain height: flat in the track corridor, hills rising beyond it. */
function terrainHeight(x: number, z: number): number {
  const base = trackElevation(z);
  const d = Math.abs(x - trackCurve(z));
  if (d < CORRIDOR) return base;
  const ramp = Math.min(1, (d - CORRIDOR) / 16);
  return base + hills(x, z) * ramp * ramp + ramp * 1.6;
}

export const buildMarioKartScene: SceneBuilder = (ctx) => {
  const mount = ctx.mount;
  const reduced = ctx.reducedMotion;

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
    if (x instanceof THREE.BufferGeometry) geos.push(x);
    else mats.push(x);
    return x;
  };

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const el = renderer.domElement;
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.pointerEvents = 'none';
  mount.appendChild(el);

  const theme0 = ctx.getTheme();
  let appliedPrimary = theme0.backdrop.primary;
  let appliedSecondary = theme0.backdrop.secondary;
  let appliedParticle = theme0.backdrop.particle;
  const mix = (a: string, b: string, t: number) =>
    new THREE.Color(a).lerp(new THREE.Color(b), t);

  const scene = new THREE.Scene();
  // Pale daytime haze — distant hills fade into it, not into black.
  scene.fog = new THREE.Fog(new THREE.Color('#c4dcea'), 48, 205);

  const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 600);
  camera.position.set(0, 2.8, 7.4);

  scene.add(new THREE.HemisphereLight(0xbce0ff, 0x3a7d2a, 1.0));
  const sunLight = new THREE.DirectionalLight(0xfff6e0, 0.95);
  sunLight.position.set(-6, 11, 5);
  scene.add(sunLight);

  // --- Sky dome -----------------------------------------------------------
  const skyGeo = track(new THREE.SphereGeometry(340, 24, 16));
  const skyColors = new Float32Array(skyGeo.attributes.position.count * 3);
  const skyTop = new THREE.Color('#4aa8e8');
  const skyHorizon = new THREE.Color('#d4ecf6');
  const skyPos = skyGeo.attributes.position;
  const tmpC = new THREE.Color();
  for (let i = 0; i < skyPos.count; i++) {
    const t = THREE.MathUtils.clamp((skyPos.getY(i) / 340) * 0.5 + 0.5, 0, 1);
    tmpC.copy(skyHorizon).lerp(skyTop, t);
    skyColors[i * 3] = tmpC.r; skyColors[i * 3 + 1] = tmpC.g; skyColors[i * 3 + 2] = tmpC.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));
  const skyMat = track(new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -2;
  scene.add(sky);

  const sunGeo = track(new THREE.SphereGeometry(13, 16, 12));
  const sunMat = track(new THREE.MeshBasicMaterial({ color: 0xfff1bf, fog: false }));
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(64, 88, -210);
  scene.add(sun);

  // --- Clouds -------------------------------------------------------------
  const puffGeo = track(new THREE.IcosahedronGeometry(1, 0));
  const cloudMat = track(new THREE.MeshLambertMaterial({
    color: 0xf6fbff, emissive: 0xdfeef7, emissiveIntensity: 0.5, flatShading: true, fog: false,
  }));
  interface Cloud { group: THREE.Group; drift: number; }
  const clouds: Cloud[] = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const g = new THREE.Group();
    const puffs = 3 + ((Math.random() * 3) | 0);
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(puffGeo, cloudMat);
      puff.position.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 3);
      puff.scale.setScalar(1.4 + Math.random() * 1.8);
      g.add(puff);
    }
    g.scale.y = 0.62;
    g.position.set((Math.random() * 2 - 1) * 120, 32 + Math.random() * 34, -40 - Math.random() * 180);
    scene.add(g);
    clouds.push({ group: g, drift: (Math.random() * 2 - 1) * 2.2 });
  }

  // --- Terrain (green rolling hills, flat corridor for the track) ---------
  const terrainGeo = track(new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_D, TERR_SEG_W, TERR_SEG_D));
  terrainGeo.rotateX(-Math.PI / 2);
  const terrainMat = track(new THREE.MeshLambertMaterial({
    color: 0x49ad3c, emissive: 0x2f7d2a, emissiveIntensity: 0.45, flatShading: true,
  }));
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.position.set(0, TERR_BASE_Y, -TERRAIN_D / 2 + 20);
  scene.add(terrain);
  const terrainPos = terrainGeo.attributes.position as THREE.BufferAttribute;

  let scroll = 0;
  const curveX = (worldZ: number) => trackCurve(worldZ - scroll);
  const corridorY = (worldZ: number) => TERR_BASE_Y + trackElevation(worldZ - scroll);
  const groundY = (x: number, worldZ: number) => TERR_BASE_Y + terrainHeight(x, worldZ - scroll);

  // --- Track ribbon -------------------------------------------------------
  const trackGeo = track(new THREE.PlaneGeometry(TRACK_W, TRACK_LEN, TRACK_SEG_W, TRACK_SEGS));
  trackGeo.rotateX(-Math.PI / 2);
  const trackColors = new Float32Array((TRACK_SEG_W + 1) * (TRACK_SEGS + 1) * 3);
  trackGeo.setAttribute('color', new THREE.BufferAttribute(trackColors, 3));
  const trackMat = track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const trackMesh = new THREE.Mesh(trackGeo, trackMat);
  trackMesh.position.set(0, TERR_BASE_Y, -TRACK_LEN / 2 + 20);
  trackMesh.renderOrder = 1;
  scene.add(trackMesh);
  const trackPos = trackGeo.attributes.position as THREE.BufferAttribute;
  const trackCol = trackGeo.attributes.color as THREE.BufferAttribute;
  const trackRowZ: number[] = [];
  for (let r = 0; r <= TRACK_SEGS; r++) trackRowZ.push(trackPos.getZ(r * (TRACK_SEG_W + 1)));

  // --- Trees + warp pipes (roadside scenery) ------------------------------
  const trunkGeo = track(new THREE.CylinderGeometry(0.26, 0.38, 2.0, 7));
  const trunkMat = track(new THREE.MeshLambertMaterial({ color: 0x7a4a22, emissive: 0x3a2410, emissiveIntensity: 0.4, flatShading: true }));
  const leafGeo = track(new THREE.IcosahedronGeometry(1.5, 0));
  const leafMat = track(new THREE.MeshLambertMaterial({ color: 0x3fa83a, emissive: 0x276e25, emissiveIntensity: 0.5, flatShading: true }));
  interface Scenery { group: THREE.Group; z: number; side: number; off: number; }
  const trees: Scenery[] = [];
  function placeTree(t: Scenery, fresh: boolean) {
    t.z = fresh ? 14 - Math.random() * TERRAIN_D : -TERRAIN_D + 20 - Math.random() * 40;
    t.side = Math.random() < 0.5 ? -1 : 1;
    t.off = CORRIDOR + 2.5 + Math.random() * 24;
  }
  for (let i = 0; i < TREE_COUNT; i++) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.0;
    g.add(trunk);
    const leafLow = new THREE.Mesh(leafGeo, leafMat);
    leafLow.position.y = 2.5;
    g.add(leafLow);
    const leafTop = new THREE.Mesh(leafGeo, leafMat);
    leafTop.position.y = 3.5;
    leafTop.scale.setScalar(0.66);
    g.add(leafTop);
    g.scale.setScalar(0.9 + Math.random() * 0.7);
    const t: Scenery = { group: g, z: 0, side: 1, off: 0 };
    placeTree(t, true);
    scene.add(g);
    trees.push(t);
  }

  const pipeBodyGeo = track(new THREE.CylinderGeometry(0.72, 0.72, 2.3, 12));
  const pipeRimGeo = track(new THREE.CylinderGeometry(0.95, 0.95, 0.55, 12));
  const pipeMat = track(new THREE.MeshLambertMaterial({ color: 0x2fae3a, emissive: 0x1c7a26, emissiveIntensity: 0.5, flatShading: true }));
  const pipeRimMat = track(new THREE.MeshLambertMaterial({ color: 0x37c945, emissive: 0x239130, emissiveIntensity: 0.5, flatShading: true }));
  const pipes: Scenery[] = [];
  function placePipe(p: Scenery, fresh: boolean) {
    p.z = fresh ? 14 - Math.random() * TERRAIN_D : -TERRAIN_D + 20 - Math.random() * 70;
    p.side = Math.random() < 0.5 ? -1 : 1;
    p.off = CORRIDOR + 1.5 + Math.random() * 12;
  }
  for (let i = 0; i < PIPE_COUNT; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(pipeBodyGeo, pipeMat);
    body.position.y = 1.15;
    g.add(body);
    const rim = new THREE.Mesh(pipeRimGeo, pipeRimMat);
    rim.position.y = 2.35;
    g.add(rim);
    const p: Scenery = { group: g, z: 0, side: 1, off: 0 };
    placePipe(p, true);
    scene.add(g);
    pipes.push(p);
  }

  // --- Coins --------------------------------------------------------------
  const coinGeo = track(new THREE.CylinderGeometry(0.4, 0.4, 0.09, 16));
  coinGeo.rotateX(Math.PI / 2);
  const coinMat = track(new THREE.MeshLambertMaterial({
    color: new THREE.Color(COIN_GOLD), emissive: new THREE.Color(COIN_GOLD), emissiveIntensity: 0.75, flatShading: true,
  }));
  interface Coin { mesh: THREE.Mesh; z: number; lat: number; phase: number; collected: boolean; collectT: number; }
  const coins: Coin[] = [];
  function placeCoin(c: Coin, fresh: boolean) {
    c.z = fresh ? 12 - Math.random() * TRACK_LEN : -TRACK_LEN + 20 - Math.random() * 30;
    c.lat = (Math.random() * 2 - 1) * 3.4;
    c.phase = Math.random() * 6.28;
    c.collected = false; c.collectT = 0;
    c.mesh.visible = true; c.mesh.scale.setScalar(1);
  }
  for (let i = 0; i < COIN_COUNT; i++) {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    const c: Coin = { mesh, z: 0, lat: 0, phase: 0, collected: false, collectT: 0 };
    placeCoin(c, true);
    scene.add(mesh);
    coins.push(c);
  }

  // --- Item boxes ---------------------------------------------------------
  const itemGeo = track(new THREE.BoxGeometry(0.95, 0.95, 0.95));
  const itemEdgeGeo = track(new THREE.EdgesGeometry(itemGeo));
  const itemEdgeMat = track(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
  interface ItemBox { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; z: number; lat: number; phase: number; collected: boolean; collectT: number; }
  const itemBoxes: ItemBox[] = [];
  function placeItemBox(b: ItemBox, fresh: boolean) {
    b.z = fresh ? 12 - Math.random() * TRACK_LEN : -TRACK_LEN + 20 - Math.random() * 60;
    b.lat = (Math.random() * 2 - 1) * 3.0;
    b.phase = Math.random() * 6.28;
    b.collected = false; b.collectT = 0;
    b.mesh.visible = true; b.mesh.scale.setScalar(1);
  }
  for (let i = 0; i < ITEMBOX_COUNT; i++) {
    const mat = track(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(itemGeo, mat);
    mesh.add(new THREE.LineSegments(itemEdgeGeo, itemEdgeMat));
    const b: ItemBox = { mesh, mat, z: 0, lat: 0, phase: 0, collected: false, collectT: 0 };
    placeItemBox(b, true);
    scene.add(mesh);
    itemBoxes.push(b);
  }

  // --- Speed lines --------------------------------------------------------
  const speedGeo = track(new THREE.BoxGeometry(0.07, 0.07, 5));
  const speedMat = track(new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const speedLines: THREE.Mesh[] = [];
  for (let i = 0; i < SPEEDLINE_COUNT; i++) {
    const m = new THREE.Mesh(speedGeo, speedMat);
    m.position.set((Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 13), 0 + Math.random() * 13, 14 - Math.random() * 90);
    scene.add(m);
    speedLines.push(m);
  }

  // --- Shared kart geometry + materials -----------------------------------
  const kChassisGeo = track(new THREE.BoxGeometry(1.55, 0.46, 2.3));
  const kNoseGeo = track(new THREE.BoxGeometry(1.3, 0.34, 0.8));
  const kPodGeo = track(new THREE.BoxGeometry(0.34, 0.42, 1.5));
  const kSpoilerGeo = track(new THREE.BoxGeometry(1.5, 0.1, 0.34));
  const kSpoilerLegGeo = track(new THREE.BoxGeometry(0.12, 0.4, 0.12));
  const kTorsoGeo = track(new THREE.CylinderGeometry(0.34, 0.42, 0.78, 10));
  const kHeadGeo = track(new THREE.SphereGeometry(0.31, 12, 9));
  const kCapGeo = track(new THREE.BoxGeometry(0.56, 0.2, 0.56));
  const kBrimGeo = track(new THREE.BoxGeometry(0.56, 0.08, 0.28));
  const kSteerGeo = track(new THREE.TorusGeometry(0.2, 0.05, 6, 12));
  const kWheelGeo = track(new THREE.CylinderGeometry(0.44, 0.44, 0.4, 14));
  kWheelGeo.rotateZ(Math.PI / 2);
  const kHubGeo = track(new THREE.BoxGeometry(0.46, 0.66, 0.14));
  const kFlameGeo = track(new THREE.ConeGeometry(0.24, 1.5, 10));
  const kChassisEdges = track(new THREE.EdgesGeometry(kChassisGeo));
  const kCapEdges = track(new THREE.EdgesGeometry(kCapGeo));
  const kTyreMat = track(new THREE.MeshLambertMaterial({ color: 0x18181f, flatShading: true }));
  const kHubMat = track(new THREE.MeshBasicMaterial({ color: 0xdfe3e8 }));
  const kHeadMat = track(new THREE.MeshLambertMaterial({ color: 0xf0c49a, emissive: 0x6a4a30, emissiveIntensity: 0.35, flatShading: true }));
  const kEdgeMat = track(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
  const kFlameMat = track(new THREE.MeshBasicMaterial({
    color: new THREE.Color(appliedParticle), transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const WHEEL_SPOTS: [number, number, number, boolean][] = [
    [-0.92, 0.44, -0.86, true], [0.92, 0.44, -0.86, true],
    [-0.95, 0.44, 0.95, false], [0.95, 0.44, 0.95, false],
  ];

  interface KartKit {
    group: THREE.Group;
    wheels: THREE.Mesh[];
    frontWheels: THREE.Mesh[];
    flames: THREE.Mesh[];
    bodyMat: THREE.MeshLambertMaterial;
    trimMat: THREE.MeshLambertMaterial;
    driverMat: THREE.MeshLambertMaterial;
  }
  function buildKart(main: string, trimC: string, driverC: string, detailed: boolean): KartKit {
    const bodyMat = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(main), emissive: new THREE.Color(main), emissiveIntensity: 0.5, flatShading: true }));
    const trimMat = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(trimC), emissive: new THREE.Color(trimC), emissiveIntensity: 0.4, flatShading: true }));
    const driverMat = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(driverC), emissive: new THREE.Color(driverC), emissiveIntensity: 0.4, flatShading: true }));
    const g = new THREE.Group();

    const chassis = new THREE.Mesh(kChassisGeo, bodyMat);
    chassis.position.set(0, 0.42, 0);
    if (detailed) chassis.add(new THREE.LineSegments(kChassisEdges, kEdgeMat));
    g.add(chassis);
    const nose = new THREE.Mesh(kNoseGeo, bodyMat);
    nose.position.set(0, 0.38, -1.3);
    g.add(nose);

    const wheels: THREE.Mesh[] = [];
    const frontWheels: THREE.Mesh[] = [];
    for (const [x, y, z, front] of WHEEL_SPOTS) {
      const w = new THREE.Mesh(kWheelGeo, kTyreMat);
      w.position.set(x, y, z);
      w.add(new THREE.Mesh(kHubGeo, kHubMat));
      g.add(w);
      wheels.push(w);
      if (front) frontWheels.push(w);
    }

    const torso = new THREE.Mesh(kTorsoGeo, driverMat);
    torso.position.set(0, 1.0, 0.34);
    g.add(torso);
    const head = new THREE.Mesh(kHeadGeo, kHeadMat);
    head.position.set(0, 1.55, 0.3);
    g.add(head);
    const cap = new THREE.Mesh(kCapGeo, trimMat);
    cap.position.set(0, 1.78, 0.32);
    if (detailed) cap.add(new THREE.LineSegments(kCapEdges, kEdgeMat));
    g.add(cap);
    const brim = new THREE.Mesh(kBrimGeo, trimMat);
    brim.position.set(0, 1.71, 0.06);
    g.add(brim);

    const flames: THREE.Mesh[] = [];
    if (detailed) {
      for (const s of [-1, 1]) {
        const pod = new THREE.Mesh(kPodGeo, trimMat);
        pod.position.set(s * 0.98, 0.4, 0.1);
        g.add(pod);
      }
      const spoiler = new THREE.Mesh(kSpoilerGeo, trimMat);
      spoiler.position.set(0, 0.86, 1.18);
      g.add(spoiler);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(kSpoilerLegGeo, trimMat);
        leg.position.set(s * 0.55, 0.66, 1.18);
        g.add(leg);
      }
      const steer = new THREE.Mesh(kSteerGeo, kTyreMat);
      steer.position.set(0, 1.04, -0.2);
      steer.rotation.x = 1.2;
      g.add(steer);
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(kFlameGeo, kFlameMat);
        f.rotation.x = Math.PI / 2;
        f.position.set(s * 0.5, 0.42, 1.9);
        f.visible = false;
        g.add(f);
        flames.push(f);
      }
    }
    g.scale.setScalar(0.82);
    return { group: g, wheels, frontWheels, flames, bodyMat, trimMat, driverMat };
  }

  // --- Player kart --------------------------------------------------------
  const player = buildKart(appliedPrimary, mix(appliedSecondary, appliedParticle, 0.2).getStyle(), appliedSecondary, true);
  scene.add(player.group);

  // --- Rival karts: a full colored pack jockeying for position ------------
  interface Rival { kit: KartKit; z: number; lane: number; phase: number; bias: number; hopT: number; hopAt: number; }
  const rivals: Rival[] = [];
  for (let i = 0; i < RIVAL_COUNT; i++) {
    const [b, t, d] = RIVAL_COLORS[i % RIVAL_COLORS.length];
    const kit = buildKart(b, t, d, false);
    scene.add(kit.group);
    rivals.push({
      kit,
      z: -8 - (i / RIVAL_COUNT) * 58 - Math.random() * 6,
      lane: (i - (RIVAL_COUNT - 1) / 2) * 1.7 + (Math.random() - 0.5),
      phase: Math.random() * 6.28,
      bias: (Math.random() - 0.5) * 1.6,
      hopT: -1,
      hopAt: performance.now() + 1500 + Math.random() * 6000,
    });
  }

  // --- Drift / star-dash spark system -------------------------------------
  const sparkGeo = track(new THREE.BufferGeometry());
  const sparkPos = new Float32Array(SPARK_COUNT * 3).fill(99999);
  const sparkCol = new Float32Array(SPARK_COUNT * 3);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = track(new THREE.PointsMaterial({
    size: 0.5, vertexColors: true, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  scene.add(sparks);
  const sparkPosAttr = sparkGeo.attributes.position as THREE.BufferAttribute;
  const sparkColAttr = sparkGeo.attributes.color as THREE.BufferAttribute;
  function emitSpark(x: number, y: number, z: number, color: THREE.Color, spread: number) {
    for (let i = 0; i < SPARK_COUNT; i++) {
      if (sparkLife[i] > 0) continue;
      sparkLife[i] = 0.36 + Math.random() * 0.32;
      sparkPos[i * 3] = x; sparkPos[i * 3 + 1] = y; sparkPos[i * 3 + 2] = z;
      sparkVel[i * 3] = (Math.random() * 2 - 1) * spread;
      sparkVel[i * 3 + 1] = 2 + Math.random() * 3;
      sparkVel[i * 3 + 2] = 1.4 + Math.random() * 3.4;
      sparkCol[i * 3] = color.r; sparkCol[i * 3 + 1] = color.g; sparkCol[i * 3 + 2] = color.b;
      return;
    }
  }
  const tmpVec = new THREE.Vector3();
  function emitFromRearWheels(color: THREE.Color, count: number, spread: number) {
    for (const s of [-1, 1]) {
      tmpVec.set(s * 0.62, 0.16, 1.0);
      player.group.localToWorld(tmpVec);
      for (let k = 0; k < count; k++) emitSpark(tmpVec.x, tmpVec.y, tmpVec.z, color, spread);
    }
  }

  // --- Animation state ----------------------------------------------------
  let raf = 0;
  let last = performance.now();
  let sway = 0;
  let driftT = -1;
  let driftDir = 1;
  let starDashT = -1;
  let boost = 0;
  let hopT = -1;
  let wheelSpin = 0;
  let fov = 64;
  let camRoll = 0;
  let seenToolAt = ctx.activityRef.current.lastToolAt;
  let lastEventAt = performance.now() - 3000;
  let toolEventCount = 0;
  const tmpColor = new THREE.Color();
  const ROAD_RGB: [number, number, number] = [0.66, 0.55, 0.4];
  const CURB_RED: [number, number, number] = [0.86, 0.22, 0.2];

  function sizeRenderer() {
    const w = Math.max(1, mount.clientWidth);
    const h = Math.max(1, mount.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function applyColors() {
    if (starDashT < 0) player.bodyMat.color.set(appliedPrimary);
    player.bodyMat.emissive.set(appliedPrimary);
    player.trimMat.color.copy(mix(appliedSecondary, appliedParticle, 0.2));
    player.trimMat.emissive.set(appliedSecondary);
    player.driverMat.color.set(appliedSecondary);
    player.driverMat.emissive.set(appliedSecondary);
    if (boost < 0.05) kFlameMat.color.set(appliedParticle);
  }
  applyColors();

  function syncTheme() {
    const { primary, secondary, particle } = ctx.getTheme().backdrop;
    if (primary === appliedPrimary && secondary === appliedSecondary && particle === appliedParticle) return;
    appliedPrimary = primary; appliedSecondary = secondary; appliedParticle = particle;
    applyColors();
  }

  function renderFrame(now: number) {
    const dt = Math.min(80, now - last) / 1000;
    last = now;

    const { outputBoost } = computeBoosts(ctx.activityRef.current, now);
    syncTheme();

    // --- Event triggers ---------------------------------------------------
    const toolAt = ctx.activityRef.current.lastToolAt;
    const newTool = toolAt !== seenToolAt;
    if (newTool) seenToolAt = toolAt;
    const busy = driftT >= 0 || starDashT >= 0;
    if (newTool && !busy) {
      lastEventAt = now;
      toolEventCount++;
      if (toolEventCount % 3 === 0) starDashT = 0;
      else { driftT = 0; driftDir = -driftDir; }
      // The whole pack hops in reaction.
      for (const r of rivals) if (r.hopT < 0) r.hopT = Math.random() * 0.2;
    } else if (!newTool && !busy && hopT < 0 && now - lastEventAt > IDLE_HOP_GAP) {
      lastEventAt = now;
      hopT = 0;
    }

    // --- Speed ------------------------------------------------------------
    boost = Math.max(0, boost - dt * 1.35);
    const speed = 23 + outputBoost * 34 + boost * 42;
    scroll += speed * dt;
    wheelSpin += speed * dt * 0.5;

    // --- Terrain displacement --------------------------------------------
    for (let i = 0; i < terrainPos.count; i++) {
      const x = terrainPos.getX(i);
      const worldZ = terrainPos.getZ(i) + terrain.position.z;
      terrainPos.setY(i, terrainHeight(x, worldZ - scroll));
    }
    terrainPos.needsUpdate = true;

    // --- Track ribbon: follow the curve + scroll the curb/line pattern ----
    for (let r = 0; r <= TRACK_SEGS; r++) {
      const worldZ = trackRowZ[r] + trackMesh.position.z;
      const sampleZ = worldZ - scroll;
      const cx = trackCurve(sampleZ);
      const cy = trackElevation(sampleZ) + 0.07;
      const curbWhite = (Math.floor(sampleZ * 0.55) & 1) === 0;
      const dashOn = (Math.floor(sampleZ * 0.4) & 1) === 0;
      for (let col = 0; col <= TRACK_SEG_W; col++) {
        const i = r * (TRACK_SEG_W + 1) + col;
        const baseX = -TRACK_W / 2 + col * (TRACK_W / TRACK_SEG_W);
        trackPos.setX(i, baseX + cx);
        trackPos.setY(i, cy);
        if (col === 0 || col === TRACK_SEG_W) {
          if (curbWhite) trackCol.setXYZ(i, 0.95, 0.95, 0.96);
          else trackCol.setXYZ(i, CURB_RED[0], CURB_RED[1], CURB_RED[2]);
        } else if (col === TRACK_SEG_W / 2 && dashOn) {
          trackCol.setXYZ(i, 0.96, 0.94, 0.86);
        } else {
          trackCol.setXYZ(i, ROAD_RGB[0], ROAD_RGB[1], ROAD_RGB[2]);
        }
      }
    }
    trackPos.needsUpdate = true;
    trackCol.needsUpdate = true;

    // --- Scenery: trees + pipes ride the terrain --------------------------
    for (const t of trees) {
      t.z += speed * dt;
      if (t.z > 16) placeTree(t, false);
      const x = curveX(t.z) + t.side * t.off;
      t.group.position.set(x, groundY(x, t.z), t.z);
    }
    for (const p of pipes) {
      p.z += speed * dt;
      if (p.z > 16) placePipe(p, false);
      const x = curveX(p.z) + p.side * p.off;
      p.group.position.set(x, groundY(x, p.z), p.z);
    }

    // --- Clouds + sky idle ------------------------------------------------
    for (const c of clouds) {
      c.group.position.x += c.drift * dt;
      if (c.group.position.x > 135) c.group.position.x = -135;
      else if (c.group.position.x < -135) c.group.position.x = 135;
    }

    // --- Coins ------------------------------------------------------------
    for (const c of coins) {
      if (c.collected) {
        c.collectT += dt / 0.32;
        c.mesh.position.y += dt * 6;
        c.mesh.scale.setScalar(Math.max(0, 1 - c.collectT));
        c.mesh.rotation.y += dt * 22;
        if (c.collectT >= 1) placeCoin(c, false);
        continue;
      }
      c.z += speed * dt;
      const x = curveX(c.z) + c.lat;
      c.mesh.position.set(x, corridorY(c.z) + 0.6 + Math.sin(now * 0.004 + c.phase) * 0.12, c.z);
      c.mesh.rotation.y += dt * 4;
      if (c.z > KART_Z - 0.4 && c.z < KART_Z + 1.2 && Math.abs(x - player.group.position.x) < 1.6) {
        c.collected = true; c.collectT = 0;
        emitSpark(x, c.mesh.position.y, c.z, tmpColor.set(COIN_GOLD), 1.4);
      } else if (c.z > 13) {
        placeCoin(c, false);
      }
    }

    // --- Item boxes -------------------------------------------------------
    for (const b of itemBoxes) {
      if (b.collected) {
        b.collectT += dt / 0.3;
        const e = b.collectT * b.collectT * (3 - 2 * Math.min(1, b.collectT));
        b.mesh.scale.setScalar(1 + e * 1.4);
        b.mat.opacity = Math.max(0, 0.5 - b.collectT * 0.5);
        if (b.collectT >= 1) placeItemBox(b, false);
        continue;
      }
      b.z += speed * dt;
      const x = curveX(b.z) + b.lat;
      b.mesh.position.set(x, corridorY(b.z) + 0.95 + Math.sin(now * 0.0035 + b.phase) * 0.16, b.z);
      b.mesh.rotation.x += dt * 1.4;
      b.mesh.rotation.y += dt * 1.8;
      b.mat.color.setHSL((now * 0.0004 + b.phase * 0.16) % 1, 0.9, 0.62);
      if (b.z > KART_Z - 0.4 && b.z < KART_Z + 1.4 && Math.abs(x - player.group.position.x) < 1.8) {
        b.collected = true; b.collectT = 0;
        boost = Math.max(boost, 0.62);
        for (let k = 0; k < 10; k++) emitSpark(x, b.mesh.position.y, b.z, tmpColor.set('#ffffff'), 2.4);
      } else if (b.z > 13) {
        placeItemBox(b, false);
      }
    }

    // --- Speed lines ------------------------------------------------------
    speedMat.opacity = Math.min(0.7, outputBoost * 0.8 + boost * 0.45);
    for (const m of speedLines) {
      m.position.z += speed * 1.7 * dt;
      if (m.position.z > 16) {
        m.position.z = 14 - 90 - Math.random() * 20;
        m.position.x = (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 13);
        m.position.y = Math.random() * 13;
      }
    }

    // --- Rival karts: jockey, weave, bank, hop ----------------------------
    for (const r of rivals) {
      const rel = Math.sin(now * 0.00055 + r.phase) * 5.2 + r.bias;
      r.z -= rel * dt;
      if (r.z > 8) {
        r.z = -64 - Math.random() * 12;
        r.lane = (Math.random() * 2 - 1) * 3.6;
      } else if (r.z < -82) {
        r.z = -6 - Math.random() * 18;
      }
      let hopY = 0;
      if (r.hopT >= 0) {
        r.hopT += dt / HOP_DUR;
        hopY = Math.sin(Math.min(1, r.hopT) * Math.PI) * 0.5;
        if (r.hopT >= 1) { r.hopT = -1; r.hopAt = now + 3000 + Math.random() * 5500; }
      } else if (now > r.hopAt) {
        r.hopT = 0;
      }
      const weave = Math.sin(now * 0.0016 + r.phase * 1.7) * 0.5;
      const rx = curveX(r.z) + r.lane + weave;
      r.kit.group.position.set(rx, corridorY(r.z) + RIDE_HEIGHT + hopY, r.z);
      const turn = trackCurve((r.z - scroll) - 5) - trackCurve((r.z - scroll) + 5);
      r.kit.group.rotation.z = THREE.MathUtils.clamp(turn * 0.05, -0.5, 0.5) - weave * 0.22;
      r.kit.group.rotation.y = turn * 0.02;
      r.kit.group.rotation.x = -0.02 + Math.sin(now * 0.005 + r.phase) * 0.02;
      for (const w of r.kit.wheels) w.rotation.x = wheelSpin;
      for (const fw of r.kit.frontWheels) fw.rotation.y = turn * 0.04;
    }

    // --- Player kart ------------------------------------------------------
    sway += dt * (0.7 + outputBoost * 0.4);
    const weave = Math.sin(sway) * 0.7 + Math.sin(sway * 0.43) * 0.4;
    const turnRate = trackCurve((KART_Z - scroll) - 5) - trackCurve((KART_Z - scroll) + 5);

    let driftYaw = 0;
    let driftSlide = 0;
    if (driftT >= 0) {
      const prevT = driftT;
      driftT += dt / DRIFT_DUR;
      const shape = Math.min(1, driftT / 0.12) * Math.min(1, Math.max(0, (1 - driftT) / 0.16));
      driftYaw = driftDir * 0.46 * shape;
      driftSlide = driftDir * 1.7 * shape;
      camRoll += (driftDir * 0.08 * shape - camRoll) * Math.min(1, dt * 8);
      if (driftT < 0.62) {
        const charge = driftT < 0.24 ? SPARK_BLUE : driftT < 0.44 ? SPARK_ORANGE : SPARK_PINK;
        emitFromRearWheels(charge, 2, 1.6);
      }
      if (driftT >= 0.62 && prevT < 0.62) {
        boost = 1;
        emitFromRearWheels(SPARK_PINK, 7, 3.2);
      }
      if (driftT >= 1) driftT = -1;
    } else {
      camRoll += (0 - camRoll) * Math.min(1, dt * 5);
    }

    if (starDashT >= 0) {
      starDashT += dt / STARDASH_DUR;
      boost = Math.max(boost, 0.85);
      player.bodyMat.color.setHSL((now * 0.002) % 1, 0.95, 0.62);
      tmpColor.setHSL((now * 0.0021 + 0.3) % 1, 0.95, 0.65);
      emitFromRearWheels(tmpColor, 3, 2.6);
      if (starDashT >= 1) { starDashT = -1; player.bodyMat.color.set(appliedPrimary); }
    }

    let hopY = 0;
    if (hopT >= 0) {
      hopT += dt / HOP_DUR;
      hopY = Math.sin(Math.min(1, hopT) * Math.PI) * 0.6;
      if (hopT >= 1) hopT = -1;
    }

    const px = curveX(KART_Z) + weave + driftSlide;
    player.group.position.set(px, corridorY(KART_Z) + RIDE_HEIGHT + hopY, KART_Z);
    player.group.rotation.y = driftYaw + turnRate * 0.02;
    player.group.rotation.z = THREE.MathUtils.clamp(turnRate * 0.05, -0.5, 0.5) - weave * 0.12 +
      (driftT >= 0 ? -driftDir * 0.1 : 0);
    player.group.rotation.x = -0.02 - outputBoost * 0.04 + Math.sin(sway * 1.6) * 0.015;
    for (const w of player.wheels) w.rotation.x = wheelSpin;
    for (const fw of player.frontWheels) fw.rotation.y = turnRate * 0.04 + driftYaw * 0.5;

    for (const f of player.flames) {
      f.visible = boost > 0.05;
      f.scale.set(0.7 + boost * 0.5, 0.7 + boost * 0.5, 0.4 + boost * 2.4);
    }
    kFlameMat.opacity = 0.55 + boost * 0.4;
    if (boost > 0.05) {
      tmpColor.copy(SPARK_ORANGE).lerp(tmpC.set(0xffffff), boost * 0.5);
      kFlameMat.color.copy(tmpColor);
    }

    // --- Sparks integrate -------------------------------------------------
    let sparksLive = false;
    for (let i = 0; i < SPARK_COUNT; i++) {
      if (sparkLife[i] <= 0) continue;
      sparksLive = true;
      sparkLife[i] -= dt;
      if (sparkLife[i] <= 0) {
        sparkPos[i * 3] = 99999; sparkPos[i * 3 + 1] = 99999; sparkPos[i * 3 + 2] = 99999;
        continue;
      }
      sparkVel[i * 3 + 1] -= 9 * dt;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    }
    if (sparksLive) { sparkPosAttr.needsUpdate = true; sparkColAttr.needsUpdate = true; }

    // --- Chase camera -----------------------------------------------------
    const aheadX = curveX(KART_Z - 14);
    camera.position.x += (px * 0.7 - camera.position.x) * Math.min(1, dt * 3);
    camera.position.y += (player.group.position.y + 2.7 - camera.position.y) * Math.min(1, dt * 3);
    const targetFov = 64 + outputBoost * 7 + boost * 6;
    fov += (targetFov - fov) * Math.min(1, dt * 4);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(px * 0.5 + aheadX * 0.5, player.group.position.y + 0.7, KART_Z - 13);
    camera.rotation.z = camRoll;

    renderer.render(scene, camera);
  }

  function loop(now: number) {
    if (document.visibilityState === 'hidden') {
      last = now;
      raf = requestAnimationFrame(loop);
      return;
    }
    renderFrame(now);
    raf = requestAnimationFrame(loop);
  }

  sizeRenderer();
  const ro = new ResizeObserver(() => {
    sizeRenderer();
    if (reduced) renderFrame(performance.now());
  });
  ro.observe(mount);

  if (reduced) {
    renderFrame(performance.now());
  } else {
    raf = requestAnimationFrame(loop);
  }

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try { mount.removeChild(el); } catch { /* ignore */ }
      renderer.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
};
