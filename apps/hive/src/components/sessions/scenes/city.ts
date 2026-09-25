/**
 * City Skyline — a night cityscape with traffic.
 *
 * Two depth layers of building silhouettes (regenerated on resize) with
 * twinkling lit windows, a star field above, and car-light trails
 * streaking along the road in the foreground.
 *
 * Reactions:
 *   - Streaming: traffic gets denser and faster
 *   - Tool call: a bright car (and a window cluster) flares in the tool accent
 */

import type { SceneBuilder } from './types';
import { runCanvasScene, withAlpha, mixHex } from './canvas2d';

interface Building {
  x: number;
  w: number;
  h: number;
  winCols: number;
  winRows: number;
  cell: number;
  margin: number;
  lit: Uint8Array;
  layer: 0 | 1;
}

interface Car {
  x: number;
  speed: number;
  dir: 1 | -1;
  color: string;
  len: number;
}

export const buildCityScene: SceneBuilder = (ctx) =>
  runCanvasScene(ctx, (() => {
    let buildings: Building[] = [];
    let stars: { fx: number; fy: number; seed: number }[] = [];
    let cars: Car[] = [];
    let roadTop = 0;
    let spawnAccum = 0;
    let lastFlareAt = 0;

    function genLayer(w: number, layer: 0 | 1, minH: number, maxH: number): Building[] {
      const arr: Building[] = [];
      let x = -30;
      const cell = layer === 0 ? 6 : 8;
      while (x < w + 30) {
        const bw = (layer === 0 ? 26 : 40) + Math.random() * (layer === 0 ? 40 : 70);
        const bh = minH + Math.random() * (maxH - minH);
        const margin = 5;
        const winCols = Math.max(0, Math.floor((bw - margin * 2) / cell));
        const winRows = Math.max(0, Math.floor((bh - margin * 2) / cell));
        const lit = new Uint8Array(winCols * winRows);
        for (let i = 0; i < lit.length; i++) lit[i] = Math.random() < 0.42 ? 1 : 0;
        arr.push({ x, w: bw, h: bh, winCols, winRows, cell, margin, lit, layer });
        x += bw + (layer === 0 ? 1 + Math.random() * 5 : 3 + Math.random() * 12);
      }
      return arr;
    }

    function init(w: number, h: number) {
      roadTop = h * 0.9;
      stars = [];
      const starCount = Math.round(w / 12);
      for (let i = 0; i < starCount; i++) {
        stars.push({ fx: Math.random(), fy: Math.random(), seed: Math.random() * 6.28 });
      }
      // Back layer first (drawn behind), then front.
      buildings = [
        ...genLayer(w, 0, h * 0.18, h * 0.42),
        ...genLayer(w, 1, h * 0.3, h * 0.62),
      ];
      cars = [];
      spawnAccum = 0;
    }

    function spawnCar(w: number, color: string) {
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      // Each car's y is derived per-frame from the road band by direction.
      cars.push({
        x: dir === 1 ? -40 : w + 40,
        speed: 120 + Math.random() * 150,
        dir,
        color,
        len: 22 + Math.random() * 26,
      });
    }

    return {
      init,
      frame(c, f) {
        const { theme, boosts, dt, w, h } = f;
        roadTop = h * 0.9;

        // Sky.
        c.fillStyle = theme.backdrop.bg;
        c.fillRect(0, 0, w, h);

        // Stars.
        for (const s of stars) {
          const y = s.fy * (roadTop * 0.7);
          const tw = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(f.now * 0.0018 + s.seed));
          c.fillStyle = withAlpha(theme.backdrop.particle, tw);
          c.fillRect(s.fx * w, y, 1.5, 1.5);
        }

        // Twinkle a few windows.
        for (let k = 0; k < 3; k++) {
          const b = buildings[(Math.random() * buildings.length) | 0];
          if (b && b.lit.length) {
            const i = (Math.random() * b.lit.length) | 0;
            b.lit[i] = b.lit[i] ? 0 : 1;
          }
        }

        // Buildings + windows.
        for (const b of buildings) {
          const bodyT = b.layer === 0 ? 0.1 : 0.22;
          c.fillStyle = mixHex(theme.backdrop.bg, theme.backdrop.secondary, bodyT);
          const topY = roadTop - b.h;
          c.fillRect(b.x, topY, b.w, b.h);

          const winColor = b.layer === 0
            ? withAlpha(theme.backdrop.primary, 0.4)
            : withAlpha(theme.backdrop.particle, 0.7);
          c.fillStyle = winColor;
          const ws = b.cell * 0.6;
          for (let r = 0; r < b.winRows; r++) {
            for (let col = 0; col < b.winCols; col++) {
              if (!b.lit[r * b.winCols + col]) continue;
              c.fillRect(
                b.x + b.margin + col * b.cell,
                topY + b.margin + r * b.cell,
                ws, ws,
              );
            }
          }
        }

        // Road.
        c.fillStyle = mixHex(theme.backdrop.bg, '#000000', 0.4);
        c.fillRect(0, roadTop, w, h - roadTop);
        c.strokeStyle = withAlpha(theme.backdrop.secondary, 0.3);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, roadTop);
        c.lineTo(w, roadTop);
        c.stroke();

        // Spawn traffic — denser while output streams.
        const interval = 0.55 / (1 + boosts.outputBoost * 3.2);
        spawnAccum += dt;
        while (spawnAccum >= interval) {
          spawnAccum -= interval;
          const warm = Math.random() < 0.5;
          spawnCar(w, warm
            ? mixHex(theme.backdrop.particle, '#ffffff', 0.5)
            : mixHex(theme.backdrop.primary, theme.backdrop.secondary, 0.5));
        }
        // A tool call sends a bright accent car through (debounced).
        if (boosts.flashColor && boosts.sinceTool < 120 && f.now - lastFlareAt > 300) {
          lastFlareAt = f.now;
          spawnCar(w, boosts.flashColor);
        }

        // Move + draw cars as streaks along the road band.
        const roadH = h - roadTop;
        const next: Car[] = [];
        for (const car of cars) {
          car.x += car.dir * car.speed * (1 + boosts.outputBoost * 1.4) * dt;
          // Lane band: forward traffic nearer, backward traffic farther.
          const y = roadTop + roadH * (car.dir === 1 ? 0.62 : 0.32);
          if (car.x < -60 || car.x > w + 60) continue;
          const tailX = car.x - car.dir * car.len;
          const grad = c.createLinearGradient(car.x, y, tailX, y);
          grad.addColorStop(0, withAlpha(car.color, 0.85));
          grad.addColorStop(1, withAlpha(car.color, 0));
          c.strokeStyle = grad;
          c.lineWidth = Math.max(1.5, roadH * 0.12);
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(car.x, y);
          c.lineTo(tailX, y);
          c.stroke();
          // Bright head.
          c.fillStyle = withAlpha(car.color, 0.95);
          c.beginPath();
          c.arc(car.x, y, Math.max(1.5, roadH * 0.08), 0, Math.PI * 2);
          c.fill();
          next.push(car);
        }
        cars = next.length > 80 ? next.slice(-80) : next;
      },
    };
  })());
