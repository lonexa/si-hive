/**
 * Doom — a first-person blast down an endless demon-infested corridor.
 *
 * A WebGL scene (three.js) where the camera IS the player:
 *   - An endless tech-base corridor scrolls past — panelled walls, glowing
 *     lava channels, flickering wall torches, ceiling lights, ribs
 *   - A double-barrel shotgun sits in the foreground, bobbing as you walk
 *   - Floating cacodemons and lurching imps approach down the hall and lob
 *     fireballs; gib bursts when they die
 *
 * Reactions:
 *   - Idle:      you stride forward (view bob), demons close in, torches
 *                flicker — the gun fires on a steady cadence so it stays loud
 *   - Streaming: you run faster, the corridor + demons rush by, FOV widens
 *   - Tool call: the shotgun FIRES — muzzle flash, recoil, the corridor lights
 *                up, and the nearest demon ahead gets gibbed. Every 5th shot
 *                is a big blast that clears the three closest demons.
 *   - Fireball:  a demon's shot reaching you triggers a red pain flash.
 *
 * The host applies the global dimmer, so this renders at full strength.
 */

import * as THREE from 'three';
import type { SceneBuilder } from './types';
import { computeBoosts } from './activity';

const SEG_DEPTH = 9;
const SEG_COUNT = 12;
const CORRIDOR_W = 11;
const CORRIDOR_H = 5.4;
const TORCH_COUNT = 8;
const BARREL_COUNT = 6;
const FIREBALL_COUNT = 8;
const GIB_COUNT = 150;
const FIRE_COOLDOWN = 0.26;     // min seconds between shots
const IDLE_FIRE_GAP = 4600;     // ms — fire at least this often
const CAM_Z = 3.6;
const EYE_Y = 2.3;
const DEATH_DUR = 0.7;

const LAVA = '#ff6a14';
const FIRE_ORANGE = new THREE.Color('#ff7a1e');
const BLOOD = new THREE.Color('#c9202a');

export const buildDoomScene: SceneBuilder = (ctx) => {
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
  let appliedParticle = theme0.backdrop.particle;
  let appliedBg = theme0.backdrop.bg;
  const mix = (a: string, b: string, t: number) =>
    new THREE.Color(a).lerp(new THREE.Color(b), t);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(mix('#180a0a', appliedBg, 0.4), 12, 86);

  const camera = new THREE.PerspectiveCamera(74, 1, 0.1, 300);
  camera.position.set(0, EYE_Y, CAM_Z);
  scene.add(camera);                 // so the camera-locked weapon renders

  const BASE_AMBIENT = 0.5;
  const ambient = new THREE.AmbientLight(0xff8855, BASE_AMBIENT);
  scene.add(ambient);
  const fillLight = new THREE.DirectionalLight(0xffd0b0, 0.3);
  fillLight.position.set(2, 8, 4);
  scene.add(fillLight);
  const muzzleLight = new THREE.PointLight(0xffe6b0, 0, 60, 1.6);
  muzzleLight.position.set(0, EYE_Y - 0.3, CAM_Z - 1.5);
  scene.add(muzzleLight);
  const torchLightA = new THREE.PointLight(0xff7a22, 1.4, 20, 2);
  const torchLightB = new THREE.PointLight(0xff7a22, 1.4, 20, 2);
  scene.add(torchLightA, torchLightB);

  // --- Corridor segments --------------------------------------------------
  const wallGeo = track(new THREE.BoxGeometry(0.34, CORRIDOR_H, SEG_DEPTH));
  const floorGeo = track(new THREE.BoxGeometry(CORRIDOR_W, 0.3, SEG_DEPTH));
  const ceilGeo = track(new THREE.BoxGeometry(CORRIDOR_W, 0.3, SEG_DEPTH));
  const lavaGeo = track(new THREE.BoxGeometry(0.85, 0.1, SEG_DEPTH));
  const accentGeo = track(new THREE.BoxGeometry(0.16, 0.34, SEG_DEPTH));
  const ribGeo = track(new THREE.BoxGeometry(0.55, CORRIDOR_H, 0.55));
  const ceilLightGeo = track(new THREE.BoxGeometry(2.4, 0.18, 1.7));

  const wallMat = track(new THREE.MeshLambertMaterial({ color: 0x6b5742, emissive: 0x241b12, emissiveIntensity: 0.55, flatShading: true }));
  const floorMat = track(new THREE.MeshLambertMaterial({ color: 0x423a31, emissive: 0x15110d, emissiveIntensity: 0.5, flatShading: true }));
  const ceilMat = track(new THREE.MeshLambertMaterial({ color: 0x2e2722, emissive: 0x0e0b08, emissiveIntensity: 0.5, flatShading: true }));
  const ribMat = track(new THREE.MeshLambertMaterial({ color: 0x55473a, emissive: 0x1d160f, emissiveIntensity: 0.5, flatShading: true }));
  const lavaMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(LAVA) }));
  const accentMat = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(appliedPrimary), emissive: new THREE.Color(appliedPrimary), emissiveIntensity: 0.9, flatShading: true }));
  const ceilLightMat = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(appliedParticle), emissive: new THREE.Color(appliedParticle), emissiveIntensity: 0.8, flatShading: true }));

  const segments: THREE.Group[] = [];
  for (let i = 0; i < SEG_COUNT; i++) {
    const g = new THREE.Group();
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.15;
    g.add(floor);
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.position.y = CORRIDOR_H + 0.15;
    g.add(ceil);
    const ceilLight = new THREE.Mesh(ceilLightGeo, ceilLightMat);
    ceilLight.position.y = CORRIDOR_H - 0.02;
    g.add(ceilLight);
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(s * (CORRIDOR_W / 2), CORRIDOR_H / 2, 0);
      g.add(wall);
      const accent = new THREE.Mesh(accentGeo, accentMat);
      accent.position.set(s * (CORRIDOR_W / 2 - 0.18), CORRIDOR_H * 0.62, 0);
      g.add(accent);
      const lava = new THREE.Mesh(lavaGeo, lavaMat);
      lava.position.set(s * (CORRIDOR_W / 2 - 0.7), 0.04, 0);
      g.add(lava);
      const rib = new THREE.Mesh(ribGeo, ribMat);
      rib.position.set(s * (CORRIDOR_W / 2 - 0.1), CORRIDOR_H / 2, SEG_DEPTH / 2);
      g.add(rib);
    }
    g.position.z = CAM_Z - SEG_DEPTH / 2 - i * SEG_DEPTH;
    scene.add(g);
    segments.push(g);
  }

  // --- Wall torches -------------------------------------------------------
  const bracketGeo = track(new THREE.BoxGeometry(0.3, 0.3, 0.3));
  const flameGeo = track(new THREE.IcosahedronGeometry(0.42, 0));
  const bracketMat = track(new THREE.MeshLambertMaterial({ color: 0x3a3027, flatShading: true }));
  const flameMat = track(new THREE.MeshBasicMaterial({ color: 0xff8a1e }));
  interface Torch { group: THREE.Group; flame: THREE.Mesh; z: number; side: number; seed: number; }
  const torches: Torch[] = [];
  for (let i = 0; i < TORCH_COUNT; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(bracketGeo, bracketMat));
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 0.45;
    g.add(flame);
    const side = i % 2 === 0 ? -1 : 1;
    const t: Torch = { group: g, flame, z: CAM_Z - 6 - i * (SEG_DEPTH * 2), side, seed: Math.random() * 6.28 };
    g.position.set(side * (CORRIDOR_W / 2 - 0.5), 3.1, t.z);
    scene.add(g);
    torches.push(t);
  }

  // --- Explosive barrels --------------------------------------------------
  const barrelGeo = track(new THREE.CylinderGeometry(0.55, 0.6, 1.5, 12));
  const barrelRimGeo = track(new THREE.TorusGeometry(0.56, 0.08, 6, 12));
  const barrelMat = track(new THREE.MeshLambertMaterial({ color: 0x4f7d2a, emissive: 0x213a10, emissiveIntensity: 0.5, flatShading: true }));
  const barrelRimMat = track(new THREE.MeshLambertMaterial({ color: 0xc7b021, emissive: 0x5a4f0c, emissiveIntensity: 0.6, flatShading: true }));
  interface Barrel { group: THREE.Group; z: number; side: number; }
  const barrels: Barrel[] = [];
  for (let i = 0; i < BARREL_COUNT; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(barrelGeo, barrelMat));
    for (const ry of [0.35, -0.35]) {
      const rim = new THREE.Mesh(barrelRimGeo, barrelRimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = ry;
      g.add(rim);
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    const b: Barrel = { group: g, z: CAM_Z - 12 - i * 17 - Math.random() * 8, side };
    g.position.set(side * (CORRIDOR_W / 2 - 1.3), 0.75, b.z);
    scene.add(g);
    barrels.push(b);
  }

  // --- Demons -------------------------------------------------------------
  // Cacodemon parts (shared geometry, per-enemy body material for hit flash).
  const cacoBodyGeo = track(new THREE.IcosahedronGeometry(1.15, 1));
  const cacoEyeGeo = track(new THREE.SphereGeometry(0.4, 12, 10));
  const cacoPupilGeo = track(new THREE.SphereGeometry(0.18, 8, 8));
  const cacoMouthGeo = track(new THREE.BoxGeometry(1.1, 0.34, 0.4));
  const cacoToothGeo = track(new THREE.ConeGeometry(0.09, 0.26, 5));
  const cacoHornGeo = track(new THREE.ConeGeometry(0.16, 0.5, 6));
  const cacoEyeMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const cacoPupilMat = track(new THREE.MeshBasicMaterial({ color: 0x2a1c0c }));
  const cacoMouthMat = track(new THREE.MeshLambertMaterial({ color: 0x2a0c0c, flatShading: true }));
  const cacoToothMat = track(new THREE.MeshBasicMaterial({ color: 0xf2ead0 }));
  const cacoHornMat = track(new THREE.MeshLambertMaterial({ color: 0xd8c9a8, emissive: 0x4a4234, emissiveIntensity: 0.4, flatShading: true }));
  // Imp parts.
  const impTorsoGeo = track(new THREE.BoxGeometry(0.85, 1.05, 0.55));
  const impHeadGeo = track(new THREE.BoxGeometry(0.5, 0.5, 0.5));
  const impLimbGeo = track(new THREE.BoxGeometry(0.24, 0.85, 0.24));
  const impEyeGeo = track(new THREE.BoxGeometry(0.42, 0.1, 0.08));

  interface Enemy {
    group: THREE.Group; type: 'caco' | 'imp'; bodyMat: THREE.MeshLambertMaterial;
    z: number; lat: number; approach: number; seed: number;
    state: 'alive' | 'dying'; dieT: number; fireAt: number;
  }
  const enemies: Enemy[] = [];

  function buildCaco(): { group: THREE.Group; bodyMat: THREE.MeshLambertMaterial } {
    const bodyMat = track(new THREE.MeshLambertMaterial({ color: 0xb83026, emissive: 0x3a0c08, emissiveIntensity: 0.55, flatShading: true }));
    const g = new THREE.Group();
    g.add(new THREE.Mesh(cacoBodyGeo, bodyMat));
    const mouth = new THREE.Mesh(cacoMouthGeo, cacoMouthMat);
    mouth.position.set(0, -0.5, -1.0);
    g.add(mouth);
    for (let i = -1; i <= 1; i++) {
      const tooth = new THREE.Mesh(cacoToothGeo, cacoToothMat);
      tooth.position.set(i * 0.32, -0.42, -1.15);
      g.add(tooth);
    }
    const eye = new THREE.Mesh(cacoEyeGeo, cacoEyeMat);
    eye.position.set(0, 0.15, -1.0);
    g.add(eye);
    const pupil = new THREE.Mesh(cacoPupilGeo, cacoPupilMat);
    pupil.position.set(0, 0.15, -1.35);
    g.add(pupil);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(cacoHornGeo, cacoHornMat);
      horn.position.set(s * 0.5, 0.95, 0.1);
      horn.rotation.z = -s * 0.5;
      g.add(horn);
    }
    return { group: g, bodyMat };
  }

  function buildImp(): { group: THREE.Group; bodyMat: THREE.MeshLambertMaterial } {
    const bodyMat = track(new THREE.MeshLambertMaterial({ color: 0x8a5a30, emissive: 0x2e1c0c, emissiveIntensity: 0.55, flatShading: true }));
    const g = new THREE.Group();
    const torso = new THREE.Mesh(impTorsoGeo, bodyMat);
    torso.position.y = 1.5;
    g.add(torso);
    const head = new THREE.Mesh(impHeadGeo, bodyMat);
    head.position.y = 2.28;
    g.add(head);
    const eyes = new THREE.Mesh(impEyeGeo, flameMat);
    eyes.position.set(0, 2.32, -0.27);
    g.add(eyes);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(impLimbGeo, bodyMat);
      arm.position.set(s * 0.62, 1.5, 0);
      arm.rotation.z = s * 0.25;
      g.add(arm);
      const leg = new THREE.Mesh(impLimbGeo, bodyMat);
      leg.position.set(s * 0.24, 0.55, 0);
      g.add(leg);
    }
    return { group: g, bodyMat };
  }

  function spawnEnemy(e: Enemy) {
    e.z = -64 - Math.random() * 40;
    e.lat = (Math.random() * 2 - 1) * (CORRIDOR_W / 2 - 2.2);
    e.approach = 1.6 + Math.random() * 2.6;
    e.seed = Math.random() * 6.28;
    e.state = 'alive';
    e.dieT = 0;
    e.fireAt = performance.now() + 1800 + Math.random() * 4200;
    e.group.visible = true;
    e.group.scale.setScalar(1);
    e.bodyMat.emissive.set(e.type === 'caco' ? 0x3a0c08 : 0x2e1c0c);
  }
  for (let i = 0; i < 5; i++) {
    const type: 'caco' | 'imp' = i < 3 ? 'caco' : 'imp';
    const built = type === 'caco' ? buildCaco() : buildImp();
    const e: Enemy = {
      group: built.group, type, bodyMat: built.bodyMat,
      z: 0, lat: 0, approach: 2, seed: 0, state: 'alive', dieT: 0, fireAt: 0,
    };
    spawnEnemy(e);
    e.z = -16 - i * 12;            // stagger the opening line-up
    scene.add(built.group);
    enemies.push(e);
  }

  // --- Fireballs ----------------------------------------------------------
  const fireballGeo = track(new THREE.IcosahedronGeometry(0.32, 0));
  const fireballMat = track(new THREE.MeshBasicMaterial({
    color: 0xff8a1e, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
  }));
  interface Fireball { mesh: THREE.Mesh; vel: THREE.Vector3; active: boolean; }
  const fireballs: Fireball[] = [];
  for (let i = 0; i < FIREBALL_COUNT; i++) {
    const mesh = new THREE.Mesh(fireballGeo, fireballMat);
    mesh.visible = false;
    scene.add(mesh);
    fireballs.push({ mesh, vel: new THREE.Vector3(), active: false });
  }
  function launchFireball(from: THREE.Vector3) {
    const fb = fireballs.find((f) => !f.active);
    if (!fb) return;
    fb.mesh.position.copy(from);
    fb.mesh.visible = true;
    fb.active = true;
    fb.vel.set(camera.position.x - from.x, camera.position.y - from.y, camera.position.z - from.z)
      .normalize().multiplyScalar(26 + Math.random() * 8);
  }

  // --- The shotgun (locked to the camera) ---------------------------------
  const gun = new THREE.Group();
  const gunMetal = track(new THREE.MeshLambertMaterial({ color: 0x2c2c30, emissive: 0x0e0e10, emissiveIntensity: 0.5, flatShading: true }));
  const gunWood = track(new THREE.MeshLambertMaterial({ color: 0x6b3f1d, emissive: 0x261408, emissiveIntensity: 0.5, flatShading: true }));
  const gunHand = track(new THREE.MeshLambertMaterial({ color: 0x8a9bb0, emissive: 0x20262e, emissiveIntensity: 0.5, flatShading: true }));
  const receiverGeo = track(new THREE.BoxGeometry(0.52, 0.4, 1.0));
  const receiver = new THREE.Mesh(receiverGeo, gunMetal);
  receiver.position.set(0, 0, 0.25);
  gun.add(receiver);
  const barrelGeo2 = track(new THREE.CylinderGeometry(0.1, 0.1, 2.1, 10));
  barrelGeo2.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const barrel = new THREE.Mesh(barrelGeo2, gunMetal);
    barrel.position.set(s * 0.13, 0.04, -0.95);
    gun.add(barrel);
  }
  const foreGeo = track(new THREE.BoxGeometry(0.4, 0.3, 0.66));
  const foregrip = new THREE.Mesh(foreGeo, gunWood);
  foregrip.position.set(0, -0.27, -0.42);
  gun.add(foregrip);
  const stockGeo = track(new THREE.BoxGeometry(0.4, 0.46, 0.8));
  const stock = new THREE.Mesh(stockGeo, gunWood);
  stock.position.set(0, -0.12, 0.92);
  stock.rotation.x = 0.22;
  gun.add(stock);
  const handGeo = track(new THREE.BoxGeometry(0.26, 0.3, 0.3));
  const handFore = new THREE.Mesh(handGeo, gunHand);
  handFore.position.set(0.05, -0.34, -0.42);
  gun.add(handFore);
  const handRear = new THREE.Mesh(handGeo, gunHand);
  handRear.position.set(0.04, -0.28, 0.45);
  gun.add(handRear);
  // Muzzle flash — a flattened spiky burst at the barrel tips.
  const flashGeo = track(new THREE.IcosahedronGeometry(0.6, 0));
  const muzzleFlashMat = track(new THREE.MeshBasicMaterial({
    color: 0xfff0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const muzzleFlash = new THREE.Mesh(flashGeo, muzzleFlashMat);
  muzzleFlash.position.set(0, 0.04, -2.05);
  muzzleFlash.visible = false;
  gun.add(muzzleFlash);
  gun.scale.setScalar(0.62);
  gun.position.set(0.12, -0.78, -1.25);
  camera.add(gun);

  // --- Red pain overlay (locked to the camera) ----------------------------
  const painGeo = track(new THREE.PlaneGeometry(4, 3));
  const painMat = track(new THREE.MeshBasicMaterial({
    color: 0xd21a1a, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
  }));
  const painOverlay = new THREE.Mesh(painGeo, painMat);
  painOverlay.position.set(0, 0, -0.6);
  painOverlay.renderOrder = 999;
  camera.add(painOverlay);

  // --- Gib / spark particles ----------------------------------------------
  const gibGeo = track(new THREE.BufferGeometry());
  const gibPos = new Float32Array(GIB_COUNT * 3).fill(99999);
  const gibCol = new Float32Array(GIB_COUNT * 3);
  const gibVel = new Float32Array(GIB_COUNT * 3);
  const gibLife = new Float32Array(GIB_COUNT);
  gibGeo.setAttribute('position', new THREE.BufferAttribute(gibPos, 3));
  gibGeo.setAttribute('color', new THREE.BufferAttribute(gibCol, 3));
  const gibMat = track(new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  const gibs = new THREE.Points(gibGeo, gibMat);
  scene.add(gibs);
  const gibPosAttr = gibGeo.attributes.position as THREE.BufferAttribute;
  const gibColAttr = gibGeo.attributes.color as THREE.BufferAttribute;
  function emitGibs(x: number, y: number, z: number, color: THREE.Color, count: number, spread: number) {
    let placed = 0;
    for (let i = 0; i < GIB_COUNT && placed < count; i++) {
      if (gibLife[i] > 0) continue;
      placed++;
      gibLife[i] = 0.5 + Math.random() * 0.5;
      gibPos[i * 3] = x; gibPos[i * 3 + 1] = y; gibPos[i * 3 + 2] = z;
      gibVel[i * 3] = (Math.random() * 2 - 1) * spread;
      gibVel[i * 3 + 1] = 2 + Math.random() * 4;
      gibVel[i * 3 + 2] = (Math.random() * 2 - 1) * spread + 2.5;
      const c = color.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
      gibCol[i * 3] = c.r; gibCol[i * 3 + 1] = c.g; gibCol[i * 3 + 2] = c.b;
    }
  }

  // --- Animation state ----------------------------------------------------
  let raf = 0;
  let last = performance.now();
  let walk = 0;
  let lookSway = 0;
  let fireKick = 0;        // recoil amount, decays
  let flashT = 0;          // muzzle flash, decays fast
  let pumpT = -1;          // pump-action slide, 0..1
  let painT = 0;          // red pain flash, decays
  let cooldown = 0;
  let fov = 74;
  let shotCount = 0;
  let seenToolAt = ctx.activityRef.current.lastToolAt;
  let lastFireAt = performance.now() - 2000;
  const tmpVec = new THREE.Vector3();

  function sizeRenderer() {
    const w = Math.max(1, mount.clientWidth);
    const h = Math.max(1, mount.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function applyColors() {
    accentMat.color.set(appliedPrimary);
    accentMat.emissive.set(appliedPrimary);
    ceilLightMat.color.set(appliedParticle);
    ceilLightMat.emissive.set(appliedParticle);
    (scene.fog as THREE.Fog).color.copy(mix('#180a0a', appliedBg, 0.4));
  }
  applyColors();

  function syncTheme() {
    const { primary, particle, bg } = ctx.getTheme().backdrop;
    if (primary === appliedPrimary && particle === appliedParticle && bg === appliedBg) return;
    appliedPrimary = primary; appliedParticle = particle; appliedBg = bg;
    applyColors();
  }

  function fire() {
    cooldown = FIRE_COOLDOWN;
    lastFireAt = performance.now();
    shotCount++;
    fireKick = 1;
    flashT = 1;
    pumpT = 0;
    const big = shotCount % 5 === 0;

    // Target the live demon(s) closest ahead of the player.
    const live = enemies
      .filter((e) => e.state === 'alive' && e.z < CAM_Z - 1)
      .sort((a, b) => b.z - a.z);
    const kills = big ? 3 : 1;
    for (let i = 0; i < kills && i < live.length; i++) {
      const e = live[i];
      e.state = 'dying';
      e.dieT = 0;
      e.bodyMat.emissive.set(0xffffff);
      const ey = e.type === 'caco' ? e.group.position.y : e.group.position.y + 1.5;
      emitGibs(e.group.position.x, ey, e.z, BLOOD, big ? 20 : 14, 3.4);
    }
    // No demon hit — spark off a barrel or the floor ahead.
    if (live.length === 0) {
      const bz = CAM_Z - 10 - Math.random() * 18;
      emitGibs((Math.random() * 2 - 1) * 3, 0.4, bz, FIRE_ORANGE, 8, 2.2);
    }
  }

  function renderFrame(now: number) {
    const dt = Math.min(80, now - last) / 1000;
    last = now;

    const { outputBoost } = computeBoosts(ctx.activityRef.current, now);
    syncTheme();

    // --- Fire triggers: any tool call, plus a steady idle cadence ---------
    const toolAt = ctx.activityRef.current.lastToolAt;
    const newTool = toolAt !== seenToolAt;
    if (newTool) seenToolAt = toolAt;
    cooldown = Math.max(0, cooldown - dt);
    if (cooldown <= 0 && (newTool || now - lastFireAt > IDLE_FIRE_GAP)) fire();

    // --- Movement: walk speed scales with streaming -----------------------
    const speed = 9 + outputBoost * 24;
    walk += dt * (speed * 0.42);
    lookSway += dt * 0.6;

    // --- Corridor scroll --------------------------------------------------
    for (const g of segments) {
      g.position.z += speed * dt;
      if (g.position.z - SEG_DEPTH / 2 > CAM_Z + 3) {
        let minZ = Infinity;
        for (const s of segments) minZ = Math.min(minZ, s.position.z);
        g.position.z = minZ - SEG_DEPTH;
      }
    }

    // --- Torches: scroll, flicker, recycle --------------------------------
    for (const t of torches) {
      t.z += speed * dt;
      if (t.z > CAM_Z + 4) {
        let minZ = Infinity;
        for (const o of torches) minZ = Math.min(minZ, o.z);
        t.z = minZ - SEG_DEPTH * 2;
        t.side = -t.side;
        t.group.position.x = t.side * (CORRIDOR_W / 2 - 0.5);
      }
      t.group.position.z = t.z;
      const flick = 0.8 + 0.35 * Math.sin(now * 0.02 + t.seed) + Math.random() * 0.18;
      t.flame.scale.set(0.9 + flick * 0.2, 1.1 + flick * 0.35, 0.9 + flick * 0.2);
    }
    // Hand the two nearest torches their point lights.
    const sorted = [...torches].sort((a, b) => Math.abs(a.z - CAM_Z) - Math.abs(b.z - CAM_Z));
    for (const [light, t] of [[torchLightA, sorted[0]], [torchLightB, sorted[1]]] as [THREE.PointLight, Torch][]) {
      light.position.set(t.group.position.x, 3.2, t.z);
      light.intensity = 1.5 + Math.random() * 0.6;
    }

    // --- Barrels ----------------------------------------------------------
    for (const b of barrels) {
      b.z += speed * dt;
      if (b.z > CAM_Z + 3) {
        b.z -= SEG_DEPTH * (BARREL_COUNT + 2);
        b.side = Math.random() < 0.5 ? -1 : 1;
        b.group.position.x = b.side * (CORRIDOR_W / 2 - 1.3);
      }
      b.group.position.z = b.z;
    }

    // --- Demons -----------------------------------------------------------
    for (const e of enemies) {
      if (e.state === 'dying') {
        e.dieT += dt / DEATH_DUR;
        if (e.type === 'caco') {
          e.group.scale.setScalar(Math.max(0.01, 1 - e.dieT));
          e.group.position.y -= dt * 3.2;
          e.group.rotation.z += dt * 4;
        } else {
          e.group.scale.set(1 + e.dieT * 0.6, Math.max(0.02, 1 - e.dieT * 1.4), 1 + e.dieT * 0.6);
          e.group.rotation.y += dt * 9;
        }
        if (e.dieT >= 1) spawnEnemy(e);
        continue;
      }
      e.z += (speed + e.approach) * dt;
      // Reached the player — pain flash, then it's gone.
      if (e.z > CAM_Z - 0.5) {
        painT = 1;
        spawnEnemy(e);
        continue;
      }
      const bob = Math.sin(now * 0.004 + e.seed) * (e.type === 'caco' ? 0.35 : 0.12);
      const baseY = e.type === 'caco' ? 2.5 : 0;
      e.group.position.set(e.lat, baseY + bob, e.z);
      e.group.rotation.y = Math.sin(now * 0.0016 + e.seed) * 0.25;
      if (e.type === 'imp') {
        e.group.rotation.z = Math.sin(now * 0.012 + e.seed) * 0.08;   // lurch
      }
      // Lob a fireball now and then once it's in view.
      if (now > e.fireAt && e.z > -52 && e.z < CAM_Z - 6) {
        e.fireAt = now + 2600 + Math.random() * 4200;
        tmpVec.set(e.lat, baseY + bob, e.z + 1);
        launchFireball(tmpVec);
      }
    }

    // --- Fireballs --------------------------------------------------------
    for (const fb of fireballs) {
      if (!fb.active) continue;
      fb.mesh.position.addScaledVector(fb.vel, dt);
      fb.mesh.rotation.x += dt * 9;
      fb.mesh.rotation.y += dt * 7;
      const dz = fb.mesh.position.z - camera.position.z;
      if (dz > -1.4) {
        if (fb.mesh.position.distanceToSquared(camera.position) < 4) painT = 1;
        fb.active = false;
        fb.mesh.visible = false;
      } else if (dz > 30) {
        fb.active = false;
        fb.mesh.visible = false;
      }
    }

    // --- Gibs integrate ---------------------------------------------------
    let gibsLive = false;
    for (let i = 0; i < GIB_COUNT; i++) {
      if (gibLife[i] <= 0) continue;
      gibsLive = true;
      gibLife[i] -= dt;
      if (gibLife[i] <= 0) {
        gibPos[i * 3] = 99999; gibPos[i * 3 + 1] = 99999; gibPos[i * 3 + 2] = 99999;
        continue;
      }
      gibVel[i * 3 + 1] -= 11 * dt;
      gibPos[i * 3] += gibVel[i * 3] * dt;
      gibPos[i * 3 + 1] += gibVel[i * 3 + 1] * dt;
      gibPos[i * 3 + 2] += (gibVel[i * 3 + 2] + speed) * dt;   // gibs drift back with the world
    }
    if (gibsLive) { gibPosAttr.needsUpdate = true; gibColAttr.needsUpdate = true; }

    // --- Weapon: view-bob, recoil, pump-action ----------------------------
    fireKick = Math.max(0, fireKick - dt * 5);
    flashT = Math.max(0, flashT - dt * 11);
    painT = Math.max(0, painT - dt * 2.2);
    const bobX = Math.sin(walk) * 0.05;
    const bobY = Math.abs(Math.sin(walk * 2)) * 0.045;
    gun.position.set(0.12 + bobX, -0.78 - bobY + fireKick * 0.06, -1.25 + fireKick * 0.32);
    gun.rotation.set(-fireKick * 0.32, 0, Math.sin(walk) * 0.015);
    if (pumpT >= 0) {
      pumpT += dt / 0.34;
      foregrip.position.z = -0.42 + Math.sin(Math.min(1, pumpT) * Math.PI) * 0.34;
      if (pumpT >= 1) { pumpT = -1; foregrip.position.z = -0.42; }
    }
    muzzleFlash.visible = flashT > 0.04;
    muzzleFlash.scale.setScalar(0.7 + flashT * 1.4);
    muzzleFlash.rotation.z += dt * 30;
    muzzleFlashMat.opacity = flashT;
    muzzleLight.intensity = flashT * 7;
    ambient.intensity = BASE_AMBIENT + flashT * 0.7;
    painMat.opacity = painT * 0.5;

    // --- Camera: view-bob + a slow look-sway ------------------------------
    camera.position.x = bobX * 0.5;
    camera.position.y = EYE_Y + bobY * 0.6 - fireKick * 0.03;
    camera.position.z = CAM_Z;
    camera.rotation.y = Math.sin(lookSway) * 0.05;
    camera.rotation.x = -0.04 + fireKick * 0.05 + Math.sin(walk * 2) * 0.006;
    camera.rotation.z = Math.sin(lookSway * 0.7) * 0.012;
    const targetFov = 74 + outputBoost * 8;
    fov += (targetFov - fov) * Math.min(1, dt * 4);
    camera.fov = fov;
    camera.updateProjectionMatrix();

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
