/**
 * Star Fox — a 3D on-rails dash through a Corneria-style canyon.
 *
 * A WebGL scene (three.js) with a real chase camera:
 *   - A low-poly Arwing flies in the foreground with twin engine flames
 *   - Scrolling flat-shaded terrain carved into a valley you race through
 *   - A passing city of low-poly buildings with beacon lights
 *   - Giant arches the Arwing flies through
 *   - A drifting starfield, plus a planet + sun fixed on the horizon
 *
 * Reactions:
 *   - Idle:      gentle banking weave, slow scroll, soft engine glow
 *   - Streaming: the world rushes by faster, engine flames stretch, FOV widens
 *   - Tool call: the Arwing does a real barrel roll and fires twin lasers in
 *                the tool's accent color
 *
 * The host applies the global dimmer, so this renders at full strength.
 */

import * as THREE from 'three';
import type { SceneBuilder } from './types';
import { computeBoosts } from './activity';

const ROLL_DUR = 0.72;        // seconds for one full barrel roll
const IDLE_ROLL_GAP = 9000;   // ms — do a victory roll at least this often
const LASER_SPEED = 110;      // world units / second
const LASER_LIFE = 1.1;       // seconds before a bolt recycles
const TERRAIN_W = 84;
const TERRAIN_D = 184;
const SEG_W = 48;
const SEG_D = 92;
const BUILDING_COUNT = 26;
const ARCH_COUNT = 3;
const STAR_COUNT = 280;
const LASER_POOL = 14;

/**
 * Terrain height as a function of world (x, z). Stacked sines keep it cheap
 * and deterministic; a carved valley down the middle gives the Arwing a
 * canyon to race through.
 */
function terrainHeight(x: number, z: number): number {
  const ridge = Math.sin(x * 0.17) * 2.0 + Math.sin(x * 0.06 + 1.3) * 1.5;
  const roll = Math.sin(z * 0.10) * 1.3 + Math.sin(z * 0.043 + 2.1) * 2.0;
  const cross = Math.sin(x * 0.05 + z * 0.055) * 1.1;
  let h = ridge + roll + cross;
  const v = Math.min(1, Math.abs(x) / 11);
  const valley = v * v;                       // 0 at center, 1 past the rim
  h = h * (0.18 + 0.82 * valley) - (1 - valley) * 3.4;
  return h;
}

export const buildStarfoxScene: SceneBuilder = (ctx) => {
  const mount = ctx.mount;
  const reduced = ctx.reducedMotion;

  // Everything disposable, collected up front so teardown is one loop.
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
  let appliedBg = theme0.backdrop.bg;
  let appliedPrimary = theme0.backdrop.primary;
  let appliedSecondary = theme0.backdrop.secondary;
  let appliedParticle = theme0.backdrop.particle;

  /** Linear blend of two hex colors into a fresh THREE.Color. */
  const mix = (a: string, b: string, t: number) =>
    new THREE.Color(a).lerp(new THREE.Color(b), t);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(appliedBg), 34, 156);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 420);
  camera.position.set(0, 2.6, 8);

  // --- Lights -------------------------------------------------------------
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.05);
  sunLight.position.set(-7, 11, 5);
  scene.add(sunLight);

  // --- Terrain: a displaced plane lying in the XZ floor -------------------
  const terrainGeo = track(new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_D, SEG_W, SEG_D));
  terrainGeo.rotateX(-Math.PI / 2);
  const terrainMat = track(new THREE.MeshLambertMaterial({
    color: mix(appliedSecondary, appliedBg, 0.5),
    flatShading: true,
  }));
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.position.set(0, -4.6, -TERRAIN_D / 2 + 14);
  scene.add(terrain);
  const terrainPos = terrainGeo.attributes.position as THREE.BufferAttribute;
  /** World Y of the terrain surface under (worldX, worldZ) for a given scroll. */
  const groundAt = (worldX: number, worldZ: number, scroll: number) =>
    terrain.position.y + terrainHeight(worldX, worldZ - scroll);

  // --- City: a pool of low-poly buildings with beacon lights --------------
  const boxGeo = track(new THREE.BoxGeometry(1, 1, 1));
  const beaconGeo = track(new THREE.BoxGeometry(0.34, 0.34, 0.34));
  const buildingMats = [
    track(new THREE.MeshLambertMaterial({ color: mix(appliedBg, appliedPrimary, 0.32), flatShading: true })),
    track(new THREE.MeshLambertMaterial({ color: mix(appliedBg, appliedSecondary, 0.4), flatShading: true })),
    track(new THREE.MeshLambertMaterial({ color: mix(appliedBg, appliedParticle, 0.22), flatShading: true })),
  ];
  const beaconMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(appliedParticle) }));

  interface Building { mesh: THREE.Mesh; beacon: THREE.Mesh | null; x: number; h: number; }
  const buildings: Building[] = [];
  function placeBuilding(b: Building, fresh: boolean) {
    // Cluster in the valley and along its rim, the way a canyon city would.
    const side = Math.random() < 0.5 ? -1 : 1;
    b.x = side * (2.5 + Math.random() * 24);
    b.h = 1.6 + Math.random() * 7.5;
    const w = 1.1 + Math.random() * 3;
    const d = 1.1 + Math.random() * 3;
    b.mesh.scale.set(w, b.h, d);
    b.mesh.position.z = fresh
      ? 10 - Math.random() * TERRAIN_D
      : -TERRAIN_D + 14 - Math.random() * 36;
  }
  for (let i = 0; i < BUILDING_COUNT; i++) {
    const mesh = new THREE.Mesh(boxGeo, buildingMats[i % buildingMats.length]);
    let beacon: THREE.Mesh | null = null;
    if (i % 3 === 0) {
      beacon = new THREE.Mesh(beaconGeo, beaconMat);
      scene.add(beacon);
    }
    const b: Building = { mesh, beacon, x: 0, h: 1 };
    placeBuilding(b, true);
    scene.add(mesh);
    buildings.push(b);
  }

  // --- Arches the Arwing flies through ------------------------------------
  const archGeo = track(new THREE.TorusGeometry(7.2, 0.5, 7, 22));
  const archMat = track(new THREE.MeshLambertMaterial({
    color: mix(appliedPrimary, appliedBg, 0.25),
    flatShading: true,
  }));
  const arches: THREE.Mesh[] = [];
  for (let i = 0; i < ARCH_COUNT; i++) {
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.z = -40 - i * 70 - Math.random() * 30;
    scene.add(arch);
    arches.push(arch);
  }

  // --- Starfield ----------------------------------------------------------
  const starGeo = track(new THREE.BufferGeometry());
  const starPos = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    starPos[i * 3] = (Math.random() * 2 - 1) * 54;
    starPos[i * 3 + 1] = 6 + Math.random() * 42;
    starPos[i * 3 + 2] = 14 - Math.random() * (TERRAIN_D + 20);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = track(new THREE.PointsMaterial({
    color: new THREE.Color(appliedParticle),
    size: 0.62,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  }));
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);
  const starAttr = starGeo.attributes.position as THREE.BufferAttribute;

  // --- Horizon: a planet + a sun, both immune to fog ----------------------
  const planetGeo = track(new THREE.IcosahedronGeometry(11, 1));
  const planetMat = track(new THREE.MeshLambertMaterial({
    color: new THREE.Color(appliedSecondary),
    flatShading: true,
    fog: false,
  }));
  const planet = new THREE.Mesh(planetGeo, planetMat);
  planet.position.set(-36, 27, -168);
  scene.add(planet);

  const sunGeo = track(new THREE.SphereGeometry(5.5, 18, 14));
  const sunMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(appliedParticle), fog: false }));
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunMesh.position.set(33, 31, -176);
  scene.add(sunMesh);

  // --- The Arwing ---------------------------------------------------------
  const hullMat = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(appliedPrimary), flatShading: true }));
  const wingMat = track(new THREE.MeshLambertMaterial({ color: mix(appliedSecondary, appliedParticle, 0.2), flatShading: true }));
  const trimMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(appliedParticle) }));
  const glowMat = track(new THREE.MeshBasicMaterial({
    color: new THREE.Color(appliedParticle),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));

  const ship = new THREE.Group();
  const glows: THREE.Mesh[] = [];

  const noseGeo = track(new THREE.ConeGeometry(0.42, 1.8, 6));
  const nose = new THREE.Mesh(noseGeo, hullMat);
  nose.rotation.x = -Math.PI / 2;       // tip toward -Z (forward)
  nose.position.set(0, 0, -1.05);
  ship.add(nose);

  const bodyGeo = track(new THREE.BoxGeometry(0.72, 0.5, 1.6));
  const body = new THREE.Mesh(bodyGeo, hullMat);
  body.position.set(0, 0, 0.1);
  ship.add(body);

  const tailGeo = track(new THREE.ConeGeometry(0.4, 0.95, 6));
  const tail = new THREE.Mesh(tailGeo, hullMat);
  tail.rotation.x = Math.PI / 2;        // tip toward +Z (backward)
  tail.position.set(0, 0, 1.1);
  ship.add(tail);

  const cockpitGeo = track(new THREE.SphereGeometry(0.27, 10, 8));
  const cockpit = new THREE.Mesh(cockpitGeo, trimMat);
  cockpit.scale.set(1, 0.66, 1.5);
  cockpit.position.set(0, 0.22, -0.3);
  ship.add(cockpit);

  // Shared per-side parts (meshes share geometry; cheap to build, cheap to free).
  const wingGeo = track(new THREE.BoxGeometry(2.8, 0.12, 1.1));
  const strutGeo = track(new THREE.BoxGeometry(1.35, 0.1, 0.2));
  const podGeo = track(new THREE.CylinderGeometry(0.13, 0.13, 1.25, 8));
  const engineGeo = track(new THREE.CylinderGeometry(0.27, 0.22, 1.05, 10));
  const glowGeo = track(new THREE.ConeGeometry(0.23, 1.5, 10));
  const finGeo = track(new THREE.BoxGeometry(0.1, 0.72, 0.72));

  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.position.set(s * 1.75, -0.05, 0.32);
    wing.rotation.y = -s * 0.26;        // swept back
    wing.rotation.z = -s * 0.2;         // dihedral — wingtips angled down
    ship.add(wing);

    const strut = new THREE.Mesh(strutGeo, hullMat);
    strut.position.set(s * 0.9, -0.05, 0.18);
    strut.rotation.y = -s * 0.26;
    ship.add(strut);

    const pod = new THREE.Mesh(podGeo, trimMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 2.9, -0.18, 0.34);
    ship.add(pod);

    const engine = new THREE.Mesh(engineGeo, hullMat);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(s * 0.5, -0.04, 1.2);
    ship.add(engine);

    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = Math.PI / 2;      // base at engine, tip trailing +Z
    glow.position.set(s * 0.5, -0.04, 2.3);
    ship.add(glow);
    glows.push(glow);

    const fin = new THREE.Mesh(finGeo, wingMat);
    fin.position.set(s * 0.16, 0.42, 0.95);
    fin.rotation.z = s * 0.5;
    ship.add(fin);
  }

  ship.scale.setScalar(0.9);
  scene.add(ship);

  // --- Lasers (pooled) ----------------------------------------------------
  const laserGeo = track(new THREE.BoxGeometry(0.13, 0.13, 2.0));
  const laserMat = track(new THREE.MeshBasicMaterial({
    color: new THREE.Color(appliedParticle),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  interface Laser { mesh: THREE.Mesh; life: number; }
  const lasers: Laser[] = [];
  for (let i = 0; i < LASER_POOL; i++) {
    const mesh = new THREE.Mesh(laserGeo, laserMat);
    mesh.visible = false;
    scene.add(mesh);
    lasers.push({ mesh, life: 0 });
  }
  const tipLocal = new THREE.Vector3();
  function fireLasers() {
    let fired = 0;
    for (const s of [-1, 1]) {
      const l = lasers.find((x) => !x.mesh.visible);
      if (!l) break;
      tipLocal.set(s * 2.9, -0.18, 0);
      ship.localToWorld(tipLocal);
      l.mesh.position.copy(tipLocal);
      l.mesh.visible = true;
      l.life = LASER_LIFE;
      fired++;
    }
    return fired > 0;
  }

  // --- Animation state ----------------------------------------------------
  let raf = 0;
  let last = performance.now();
  let scroll = 0;
  let sway = 0;
  let rolling = false;
  let rollT = 0;
  let seenToolAt = ctx.activityRef.current.lastToolAt;
  let lastRollAt = performance.now() - 5000;   // first victory roll comes soon
  let fov = 62;
  const tmpColor = new THREE.Color();
  const currentHull = new THREE.Color(appliedPrimary);
  const targetHull = new THREE.Color(appliedPrimary);

  function sizeRenderer() {
    const w = Math.max(1, mount.clientWidth);
    const h = Math.max(1, mount.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function syncTheme() {
    const theme = ctx.getTheme();
    const { bg, primary, secondary, particle } = theme.backdrop;
    if (bg !== appliedBg) {
      appliedBg = bg;
      (scene.fog as THREE.Fog).color.set(bg);
    }
    if (secondary !== appliedSecondary || bg !== appliedBg) {
      terrainMat.color.copy(mix(appliedSecondary, appliedBg, 0.5));
      planetMat.color.set(secondary);
    }
    if (primary !== appliedPrimary || bg !== appliedBg) {
      buildingMats[0].color.copy(mix(bg, primary, 0.32));
      archMat.color.copy(mix(primary, bg, 0.25));
    }
    if (secondary !== appliedSecondary || bg !== appliedBg) {
      buildingMats[1].color.copy(mix(bg, secondary, 0.4));
    }
    if (particle !== appliedParticle) {
      appliedParticle = particle;
      buildingMats[2].color.copy(mix(appliedBg, particle, 0.22));
      beaconMat.color.set(particle);
      starMat.color.set(particle);
      sunMat.color.set(particle);
      trimMat.color.set(particle);
    }
    appliedPrimary = primary;
    appliedSecondary = secondary;
  }

  function renderFrame(now: number) {
    const dt = Math.min(80, now - last) / 1000;
    last = now;

    const { outputBoost, toolBoost, flashColor } = computeBoosts(ctx.activityRef.current, now);
    syncTheme();

    // Barrel roll triggers: any new tool call fires a roll + a laser volley,
    // and a periodic victory roll keeps the Arwing showing off while idle (so
    // it rolls even if tool-name detection misses).
    const toolAt = ctx.activityRef.current.lastToolAt;
    const newTool = toolAt !== seenToolAt;
    if (newTool) seenToolAt = toolAt;
    if (!rolling && (newTool || now - lastRollAt > IDLE_ROLL_GAP)) {
      rolling = true;
      rollT = 0;
      lastRollAt = now;
      const accent = flashColor ?? appliedParticle;
      laserMat.color.set(accent);
      glowMat.color.set(accent);
      if (newTool) fireLasers();
    }

    // Hull flashes to the tool accent, then eases back to the theme primary.
    targetHull.set(flashColor ?? appliedPrimary);
    currentHull.lerp(targetHull, Math.min(1, dt * 5));
    hullMat.color.copy(currentHull);
    if (!flashColor) glowMat.color.lerp(tmpColor.set(appliedParticle), Math.min(1, dt * 3));

    // The whole world rushes the camera; faster while output streams.
    const speed = 17 + outputBoost * 52;
    scroll += speed * dt;

    // --- Terrain displacement ---------------------------------------------
    for (let i = 0; i < terrainPos.count; i++) {
      const x = terrainPos.getX(i);
      const worldZ = terrainPos.getZ(i) + terrain.position.z;
      terrainPos.setY(i, terrainHeight(x, worldZ - scroll));
    }
    terrainPos.needsUpdate = true;

    // --- Buildings glide past and hug the ground --------------------------
    for (const b of buildings) {
      b.mesh.position.z += speed * dt;
      if (b.mesh.position.z > 16) placeBuilding(b, false);
      b.mesh.position.x = b.x;
      const gy = groundAt(b.x, b.mesh.position.z, scroll);
      b.mesh.position.y = gy + b.h / 2;
      if (b.beacon) {
        b.beacon.position.set(b.x, gy + b.h + 0.25, b.mesh.position.z);
        b.beacon.visible = b.mesh.position.z < 12;
      }
      b.mesh.visible = b.mesh.position.z < 12;
    }

    // --- Arches: spaced out, grounded, recycled ---------------------------
    for (let i = 0; i < arches.length; i++) {
      const arch = arches[i];
      arch.position.z += speed * dt;
      if (arch.position.z > 22) {
        const furthest = Math.min(...arches.map((a) => a.position.z));
        arch.position.z = furthest - 60 - Math.random() * 50;
      }
      arch.position.y = groundAt(0, arch.position.z, scroll) + 5.4;
      arch.rotation.z += dt * 0.12;
    }

    // --- Starfield drifts toward the camera (slow parallax) ---------------
    const starSpeed = speed * 0.32;
    for (let i = 0; i < STAR_COUNT; i++) {
      let z = starAttr.getZ(i) + starSpeed * dt;
      if (z > 14) {
        z = 14 - (TERRAIN_D + 20);
        starAttr.setX(i, (Math.random() * 2 - 1) * 54);
        starAttr.setY(i, 6 + Math.random() * 42);
      }
      starAttr.setZ(i, z);
    }
    starAttr.needsUpdate = true;

    // --- Horizon idles ----------------------------------------------------
    planet.rotation.y += dt * 0.06;
    planet.rotation.x = Math.sin(now * 0.0002) * 0.15;

    // --- The Arwing: weave, bank, bob, and barrel roll --------------------
    sway += dt * (0.5 + outputBoost * 0.25);
    const swayX = Math.sin(sway) * 2.6 + Math.sin(sway * 0.53) * 1.1;
    const bankBase = -Math.cos(sway) * 0.52;         // banks into the weave
    ship.position.x = swayX;
    ship.position.y = Math.sin(sway * 1.7) * 0.34 + Math.sin(sway * 0.9) * 0.18;
    ship.position.z = -0.4;
    ship.rotation.x = Math.sin(sway * 1.7) * 0.05 - 0.03;
    ship.rotation.y = -Math.cos(sway) * 0.16;

    if (rolling) {
      rollT += dt / ROLL_DUR;
      if (rollT >= 1) { rolling = false; rollT = 0; }
    }
    // A subtle ease so the spin snaps in and settles out.
    const rollEase = rolling ? rollT * rollT * (3 - 2 * rollT) : 0;
    ship.rotation.z = bankBase + rollEase * Math.PI * 2;

    // Engine flames stretch with the boost (and flare during a roll).
    const flame = 1 + outputBoost * 2.6 + toolBoost * 1.4 + (rolling ? 0.7 : 0);
    for (const g of glows) {
      g.scale.set(0.85 + toolBoost * 0.4, 0.85 + toolBoost * 0.4, flame);
      g.position.z = 2.3 + flame * 0.55;
    }
    glowMat.opacity = 0.5 + outputBoost * 0.4 + toolBoost * 0.3;

    // --- Lasers -----------------------------------------------------------
    for (const l of lasers) {
      if (!l.mesh.visible) continue;
      l.mesh.position.z -= LASER_SPEED * dt;
      l.life -= dt;
      const tNorm = Math.max(0, l.life / LASER_LIFE);
      l.mesh.scale.z = 0.6 + tNorm * 1.6;
      (l.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + tNorm * 0.6;
      if (l.life <= 0 || l.mesh.position.z < -200) l.mesh.visible = false;
    }

    // --- Chase camera -----------------------------------------------------
    camera.position.x += (swayX * 0.45 - camera.position.x) * Math.min(1, dt * 3);
    camera.position.y += (2.6 + ship.position.y * 0.3 - camera.position.y) * Math.min(1, dt * 3);
    const targetFov = 62 + outputBoost * 7;
    fov += (targetFov - fov) * Math.min(1, dt * 4);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(swayX * 0.7, 0.7, -12);

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
    // One calm framed shot, then hold — no animation.
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
