/**
 * Planet — the original Hive backdrop, now a scene module.
 *
 * A WebGL scene that lives behind the terminal text:
 *   - Primary wireframe icosahedron ("planet") in the theme primary hue
 *   - Smaller octahedron orbiting on a tilted axis (secondary hue)
 *   - Faint torus halo ring around the planet
 *   - Two-layer particle starfield colored from theme.particle
 *   - Subtle camera orbit so the scene always has motion
 *
 * Reactions:
 *   - Idle:      slow calm rotation + camera drift
 *   - Streaming: shapes pulse, particles brighten + drift faster
 *   - Tool call: brief scale wobble + hue flash to the tool's accent color
 *
 * The host applies the global dimmer, so this renders at full strength.
 */

import * as THREE from 'three';
import type { SceneBuilder } from './types';
import { computeBoosts } from './activity';

export const buildPlanetScene: SceneBuilder = (ctx) => {
  const mount = ctx.mount;
  const reduced = ctx.reducedMotion;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.pointerEvents = 'none';
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
  camera.position.set(0, 0, 8.5);

  function sizeRenderer() {
    const w = Math.max(1, mount.clientWidth);
    const h = Math.max(1, mount.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const theme0 = ctx.getTheme();

  // --- Primary wireframe (theme primary color) ----------------------------
  const primaryGeom = new THREE.IcosahedronGeometry(2.0, 1);
  const primaryEdges = new THREE.EdgesGeometry(primaryGeom);
  const primaryLineMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(theme0.backdrop.primary),
    transparent: true,
    opacity: 0.6,
  });
  const primary = new THREE.LineSegments(primaryEdges, primaryLineMat);
  scene.add(primary);

  // Inner glow mesh — softer fill at the center for depth.
  const innerGeom = new THREE.IcosahedronGeometry(1.1, 2);
  const innerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(theme0.backdrop.primary),
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const innerCore = new THREE.Mesh(innerGeom, innerMat);
  scene.add(innerCore);

  // --- Secondary octahedron orbiting on a tilted axis ---------------------
  const secondaryGeom = new THREE.OctahedronGeometry(0.55, 0);
  const secondaryEdges = new THREE.EdgesGeometry(secondaryGeom);
  const secondaryLineMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(theme0.backdrop.secondary),
    transparent: true,
    opacity: 0.75,
  });
  const secondary = new THREE.LineSegments(secondaryEdges, secondaryLineMat);
  const secondaryPivot = new THREE.Group();
  secondaryPivot.rotation.z = Math.PI / 5;
  secondary.position.set(3.4, 0, 0);
  secondaryPivot.add(secondary);
  scene.add(secondaryPivot);

  // --- Halo torus around the primary shape --------------------------------
  const haloGeom = new THREE.TorusGeometry(2.6, 0.025, 8, 96);
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(theme0.backdrop.secondary),
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeom, haloMat);
  halo.rotation.x = Math.PI / 2.4;
  scene.add(halo);

  // --- Particle field (two layers for parallax) ---------------------------
  function buildParticleLayer(count: number, rMin: number, rMax: number, size: number, opacity: number) {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = rMin + Math.random() * (rMax - rMin);
      const thetaA = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(thetaA);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(thetaA);
      positions[i * 3 + 2] = r * Math.cos(phi);
      seeds[i] = Math.random() * Math.PI * 2;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(theme0.backdrop.particle),
      size,
      transparent: true,
      opacity,
      depthWrite: false,
      // Normal blending (not additive) so particles don't bloom against
      // the dark terminal and compete with the text.
      blending: THREE.NormalBlending,
    });
    const points = new THREE.Points(geom, mat);
    scene.add(points);
    return { points, geom, mat, seeds, count };
  }
  const inner = buildParticleLayer(420, 3.0, 6.5, 0.09, 0.85);
  const outer = buildParticleLayer(280, 7.0, 12.0, 0.05, 0.5);

  // --- Animation loop -----------------------------------------------------
  let raf = 0;
  let last = performance.now();
  let cameraAngle = 0;
  const targetMs = reduced ? Infinity : 1000 / 60;
  let appliedPrimary = theme0.backdrop.primary;
  let appliedSecondary = theme0.backdrop.secondary;
  let appliedParticle = theme0.backdrop.particle;
  const currentPrimary = new THREE.Color(appliedPrimary);
  const targetPrimary = new THREE.Color(appliedPrimary);

  function frame(now: number) {
    if (document.visibilityState === 'hidden') {
      raf = requestAnimationFrame(frame);
      last = now;
      return;
    }
    if (now - last < targetMs) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(80, now - last) / 1000;
    last = now;

    const { outputBoost, toolBoost, flashColor } = computeBoosts(ctx.activityRef.current, now);

    // Theme changes mid-session: re-color non-tweened materials directly.
    const theme = ctx.getTheme();
    if (theme.backdrop.primary !== appliedPrimary) {
      appliedPrimary = theme.backdrop.primary;
      innerMat.color.set(appliedPrimary);
      targetPrimary.set(appliedPrimary);
    }
    if (theme.backdrop.secondary !== appliedSecondary) {
      appliedSecondary = theme.backdrop.secondary;
      secondaryLineMat.color.set(appliedSecondary);
      haloMat.color.set(appliedSecondary);
    }
    if (theme.backdrop.particle !== appliedParticle) {
      appliedParticle = theme.backdrop.particle;
      inner.mat.color.set(appliedParticle);
      outer.mat.color.set(appliedParticle);
    }

    // Primary color: flash to the tool accent, otherwise theme primary.
    targetPrimary.set(flashColor ?? appliedPrimary);
    currentPrimary.lerp(targetPrimary, Math.min(1, dt * 5));
    primaryLineMat.color.copy(currentPrimary);

    // Rotation: faster when output is streaming, kicks on tool fires.
    const rotSpeed = 0.25 + outputBoost * 0.9 + toolBoost * 2.0;
    primary.rotation.x += rotSpeed * dt * 0.35;
    primary.rotation.y += rotSpeed * dt * 0.6;
    innerCore.rotation.x = primary.rotation.x * 0.45;
    innerCore.rotation.y = primary.rotation.y * 0.45;
    halo.rotation.z += dt * 0.1;
    secondaryPivot.rotation.y += dt * (0.6 + outputBoost * 1.2);
    secondaryPivot.rotation.x = Math.sin(now * 0.0004) * 0.3;
    secondary.rotation.x += dt * 1.4;
    secondary.rotation.y += dt * 1.1;

    // Scale wobble — bigger pulse on tool flashes, gentler on output.
    const pulse = 1 + outputBoost * 0.10 + toolBoost * 0.30 + Math.sin(now * 0.003) * 0.02;
    primary.scale.setScalar(pulse);
    innerCore.scale.setScalar(pulse * 0.95);
    secondary.scale.setScalar(1 + toolBoost * 0.5);

    // Opacities respond to activity.
    primaryLineMat.opacity = 0.5 + outputBoost * 0.45 + toolBoost * 0.3;
    innerMat.opacity = 0.14 + outputBoost * 0.28 + toolBoost * 0.25;
    secondaryLineMat.opacity = 0.6 + outputBoost * 0.3 + toolBoost * 0.3;
    haloMat.opacity = 0.25 + outputBoost * 0.4 + toolBoost * 0.45;
    inner.mat.opacity = 0.55 + outputBoost * 0.4;
    inner.mat.size = 0.08 + outputBoost * 0.08 + toolBoost * 0.06;
    outer.mat.opacity = 0.35 + outputBoost * 0.3;

    // Subtle camera orbit for a constant 3D feel.
    cameraAngle += dt * 0.09;
    camera.position.x = Math.sin(cameraAngle) * 0.9;
    camera.position.y = Math.cos(cameraAngle * 0.7) * 0.45;
    camera.position.z = 8.5 + Math.sin(cameraAngle * 0.5) * 0.5;
    camera.lookAt(0, 0, 0);

    // Bob particles. Inner layer bobs more visibly during activity.
    function bobLayer(layer: typeof inner, intensity: number) {
      const arr = layer.geom.attributes.position.array as Float32Array;
      const speed = 0.5 + outputBoost * 1.4 + toolBoost * 1.6;
      for (let i = 0; i < layer.count; i++) {
        const idx = i * 3;
        const t = now * 0.0008 * speed + layer.seeds[i];
        const wobble = Math.sin(t) * intensity;
        const x = arr[idx], y = arr[idx + 1], z = arr[idx + 2];
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        arr[idx]     = x + (x / len) * wobble * dt * 60 * 0.02;
        arr[idx + 1] = y + (y / len) * wobble * dt * 60 * 0.02;
        arr[idx + 2] = z + (z / len) * wobble * dt * 60 * 0.02;
      }
      layer.geom.attributes.position.needsUpdate = true;
    }
    bobLayer(inner, 0.08 + toolBoost * 0.18);
    bobLayer(outer, 0.04);
    inner.points.rotation.y += dt * (0.05 + outputBoost * 0.2);
    outer.points.rotation.y -= dt * 0.03;
    outer.points.rotation.x += dt * 0.02;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  sizeRenderer();
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(sizeRenderer);
  ro.observe(mount);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try { mount.removeChild(renderer.domElement); } catch { /* ignore */ }
      renderer.dispose();
      primaryGeom.dispose();
      primaryEdges.dispose();
      primaryLineMat.dispose();
      innerGeom.dispose();
      innerMat.dispose();
      secondaryGeom.dispose();
      secondaryEdges.dispose();
      secondaryLineMat.dispose();
      haloGeom.dispose();
      haloMat.dispose();
      inner.geom.dispose();
      inner.mat.dispose();
      outer.geom.dispose();
      outer.mat.dispose();
    },
  };
};
