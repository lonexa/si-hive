/**
 * Horse Race — silhouette horses galloping a looping track.
 *
 * Five horses run their own lanes left-to-right and wrap around forever.
 * Legs animate on a gallop cycle whose tempo follows each horse's speed;
 * hooves kick up dust.
 *
 * Reactions:
 *   - Streaming: the whole field gallops faster
 *   - Tool call: a random horse gets a surge of speed (decaying)
 */

import type { SceneBuilder } from './types';
import { runCanvasScene, withAlpha, mixHex } from './canvas2d';

interface Horse {
  x: number;
  lane: number;       // 0..N-1
  baseSpeed: number;  // px/s at scale 1
  surge: number;      // extra px/s, decays
  phase: number;      // gallop cycle phase
  hue: number;        // 0 = primary, 1 = secondary tint mix
}

interface Dust {
  x: number;
  y: number;
  r: number;
  life: number; // 1 -> 0
}

const HORSE_COUNT = 5;

/** Stylised side-view horse silhouette, origin at the shoulder line. */
function drawHorse(c: CanvasRenderingContext2D, s: number, phase: number, color: string) {
  c.fillStyle = color;
  c.strokeStyle = color;
  c.lineCap = 'round';

  // Legs first (drawn behind the body). Diagonal-pair gallop gait.
  const legs = [
    { hipX: 11 * s, off: 0 },
    { hipX: 9 * s, off: Math.PI * 0.65 },
    { hipX: -11 * s, off: Math.PI },
    { hipX: -9 * s, off: Math.PI * 1.65 },
  ];
  c.lineWidth = 2.4 * s;
  for (const leg of legs) {
    const a = phase + leg.off;
    const swing = Math.sin(a);
    const lift = Math.max(0, Math.cos(a));
    const kneeX = leg.hipX + swing * 3.5 * s;
    const kneeY = 7 * s - lift * 2 * s;
    const footX = leg.hipX + swing * 7 * s;
    const footY = 15 * s - lift * 8 * s;
    c.beginPath();
    c.moveTo(leg.hipX, 0);
    c.lineTo(kneeX, kneeY);
    c.lineTo(footX, footY);
    c.stroke();
  }

  // Body + hindquarter.
  c.beginPath();
  c.ellipse(0, -2 * s, 15 * s, 8 * s, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(-12 * s, -3 * s, 8.5 * s, 8.5 * s, 0, 0, Math.PI * 2);
  c.fill();

  // Neck + head.
  c.beginPath();
  c.moveTo(9 * s, -7 * s);
  c.lineTo(19 * s, -19 * s);
  c.lineTo(26 * s, -17 * s);
  c.lineTo(23 * s, -9 * s);
  c.lineTo(14 * s, -1 * s);
  c.closePath();
  c.fill();
  c.beginPath();
  c.ellipse(24 * s, -17 * s, 5 * s, 3.2 * s, -0.5, 0, Math.PI * 2);
  c.fill();

  // Tail — sways with the gallop.
  c.lineWidth = 3.2 * s;
  c.beginPath();
  c.moveTo(-18 * s, -6 * s);
  c.quadraticCurveTo(-27 * s, -1 * s + Math.sin(phase) * 2 * s, -24 * s, 9 * s);
  c.stroke();
}

export const buildHorseRaceScene: SceneBuilder = (ctx) =>
  runCanvasScene(ctx, (() => {
    let horses: Horse[] = [];
    let dust: Dust[] = [];
    let scale = 1;
    let laneH = 60;
    let topPad = 40;

    function init(w: number, h: number) {
      scale = Math.max(0.5, Math.min(1.4, h / 340));
      laneH = h / (HORSE_COUNT + 1);
      topPad = laneH;
      horses = [];
      dust = [];
      for (let i = 0; i < HORSE_COUNT; i++) {
        horses.push({
          x: Math.random() * w,
          lane: i,
          baseSpeed: 70 + Math.random() * 55,
          surge: 0,
          phase: Math.random() * Math.PI * 2,
          hue: Math.random(),
        });
      }
    }

    let lastToolAt = 0;

    return {
      init,
      frame(c, f) {
        const { theme, boosts, dt, w, h } = f;

        // Slight motion smear rather than a hard clear.
        c.fillStyle = withAlpha(theme.backdrop.bg, 0.42);
        c.fillRect(0, 0, w, h);

        // Faint lane lines.
        c.strokeStyle = withAlpha(theme.backdrop.secondary, 0.18);
        c.lineWidth = 1;
        for (let i = 0; i < HORSE_COUNT; i++) {
          const y = topPad + i * laneH + laneH * 0.42;
          c.beginPath();
          c.moveTo(0, y);
          c.lineTo(w, y);
          c.stroke();
        }

        // Checkered finish post near the right edge.
        const finishX = w * 0.86;
        const sq = Math.max(5, 7 * scale);
        for (let r = 0; r * sq < h; r++) {
          c.fillStyle = withAlpha(theme.backdrop.particle, r % 2 ? 0.5 : 0.16);
          c.fillRect(finishX, r * sq, sq, sq);
        }

        // A tool call gives one random horse a surge (debounced on tool time).
        if (boosts.flashColor && boosts.sinceTool < 120 && f.now - lastToolAt > 300) {
          lastToolAt = f.now;
          const lucky = horses[(Math.random() * horses.length) | 0];
          lucky.surge += 90;
        }

        const speedMul = 1 + boosts.outputBoost * 1.6;

        for (const horse of horses) {
          const speed = (horse.baseSpeed * speedMul + horse.surge) * scale;
          horse.x += speed * dt;
          horse.surge *= Math.pow(0.25, dt); // decay surge
          horse.phase += (speed / (12 * scale)) * dt;
          if (horse.x > w + 40 * scale) horse.x = -40 * scale;

          const y = topPad + horse.lane * laneH + laneH * 0.42;

          // Kick up dust off the hind hooves on the down-beat.
          if (Math.sin(horse.phase + Math.PI) > 0.85 && Math.random() < 0.6) {
            dust.push({
              x: horse.x - 16 * scale,
              y: y + 14 * scale,
              r: (2 + Math.random() * 3) * scale,
              life: 1,
            });
          }

          const color = mixHex(theme.backdrop.primary, theme.backdrop.secondary, horse.hue * 0.6);
          // A surging horse glows in the tool accent.
          const drawColor = horse.surge > 8 && boosts.flashColor ? boosts.flashColor : color;

          c.save();
          c.translate(horse.x, y);
          drawHorse(c, scale, horse.phase, drawColor);
          c.restore();
        }

        // Dust update + draw.
        c.fillStyle = withAlpha(theme.backdrop.particle, 0.25);
        const next: Dust[] = [];
        for (const d of dust) {
          d.life -= dt * 1.6;
          d.x -= 14 * scale * dt;
          d.r += 8 * scale * dt;
          if (d.life > 0) {
            c.globalAlpha = d.life * 0.5;
            c.beginPath();
            c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
            c.fill();
            next.push(d);
          }
        }
        c.globalAlpha = 1;
        dust = next.length > 240 ? next.slice(-240) : next;
      },
    };
  })());
