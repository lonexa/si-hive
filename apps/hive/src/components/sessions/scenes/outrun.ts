/**
 * Outrun Drive — a neon synthwave highway racing toward the horizon.
 *
 *   - Slit-banded sun sitting on the horizon, lane grid receding to a
 *     vanishing point, side pylons streaking past, a star field above.
 *
 * Reactions:
 *   - Streaming: the road scrolls faster (you "drive" faster)
 *   - Tool call: the sun + horizon glow flash the tool accent color
 */

import type { SceneBuilder } from './types';
import { runCanvasScene, withAlpha, mixHex } from './canvas2d';

const GRID_LINES = 22;
const LANES = [-1, -0.6, -0.25, 0.25, 0.6, 1];

export const buildOutrunScene: SceneBuilder = (ctx) =>
  runCanvasScene(ctx, (() => {
    // Stars live in fractional coords (0..1 of width, 0..horizon) so they
    // survive resizes.
    let stars: { fx: number; fy: number; seed: number }[] = [];
    let scroll = 0;

    function init(w: number, _h: number) {
      const count = Math.round(w / 14);
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({ fx: Math.random(), fy: Math.random(), seed: Math.random() * 6.28 });
      }
    }

    return {
      init,
      frame(c, f) {
        const { theme, boosts, dt, w, h } = f;
        const horizonY = h * 0.46;
        const K = h - horizonY;
        const dNear = 1;
        const dFar = 16;
        const botHalf = w * 0.95;
        const topHalf = w * 0.03;
        const accent = boosts.flashColor;

        // Sky + road base.
        c.fillStyle = theme.backdrop.bg;
        c.fillRect(0, 0, w, h);

        // --- Stars above the horizon ---------------------------------------
        for (const s of stars) {
          const y = s.fy * horizonY;
          const tw = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(f.now * 0.002 + s.seed));
          c.fillStyle = withAlpha(theme.backdrop.particle, tw);
          c.fillRect(s.fx * w, y, 1.6, 1.6);
        }

        // --- Sun on the horizon -------------------------------------------
        const sunR = Math.min(w, h) * 0.17;
        const sunTop = mixHex(theme.backdrop.particle, theme.backdrop.primary, 0.35);
        const sunBot = accent
          ? mixHex(theme.backdrop.secondary, accent, 0.6)
          : theme.backdrop.secondary;
        const grad = c.createLinearGradient(0, horizonY - sunR, 0, horizonY);
        grad.addColorStop(0, sunTop);
        grad.addColorStop(1, sunBot);
        c.save();
        c.beginPath();
        c.rect(0, 0, w, horizonY);
        c.clip();
        c.fillStyle = grad;
        c.beginPath();
        c.arc(w / 2, horizonY, sunR, 0, Math.PI * 2);
        c.fill();
        // Retro slit bands across the lower half of the sun.
        c.fillStyle = theme.backdrop.bg;
        for (let i = 0; i < 7; i++) {
          const sy = horizonY - sunR * 0.5 + i * (sunR * 0.11);
          c.fillRect(w / 2 - sunR, sy, sunR * 2, Math.max(2, sunR * 0.045));
        }
        c.restore();

        // --- Horizon glow line --------------------------------------------
        c.strokeStyle = accent ?? theme.backdrop.primary;
        c.lineWidth = 2;
        c.globalAlpha = 0.5 + boosts.toolBoost * 0.4;
        c.beginPath();
        c.moveTo(0, horizonY);
        c.lineTo(w, horizonY);
        c.stroke();
        c.globalAlpha = 1;

        // --- Road: scrolling horizontal grid lines ------------------------
        scroll += (0.28 + boosts.outputBoost * 1.1) * dt;
        scroll %= 1;
        const halfWAt = (y: number) => {
          const t = (y - horizonY) / (h - horizonY);
          return topHalf + (botHalf - topHalf) * t;
        };

        c.strokeStyle = theme.backdrop.primary;
        for (let i = 0; i < GRID_LINES; i++) {
          const phase = ((i / GRID_LINES) + scroll) % 1;
          const d = dNear + (1 - phase) * (dFar - dNear);
          const y = horizonY + K / d;
          if (y <= horizonY + 0.5 || y > h) continue;
          const t = (y - horizonY) / (h - horizonY);
          const half = halfWAt(y);
          c.globalAlpha = 0.12 + t * 0.6;
          c.lineWidth = 1 + t * 1.4;
          c.beginPath();
          c.moveTo(w / 2 - half, y);
          c.lineTo(w / 2 + half, y);
          c.stroke();
        }
        c.globalAlpha = 1;

        // --- Road: converging lane lines ----------------------------------
        c.strokeStyle = theme.backdrop.secondary;
        c.lineWidth = 1.4;
        for (const u of LANES) {
          c.globalAlpha = Math.abs(u) === 1 ? 0.7 : 0.32;
          c.beginPath();
          c.moveTo(w / 2 + u * botHalf, h);
          c.lineTo(w / 2 + u * topHalf, horizonY + 0.5);
          c.stroke();
        }
        c.globalAlpha = 1;

        // --- Side pylons streaking past -----------------------------------
        for (let i = 0; i < GRID_LINES; i += 3) {
          const phase = ((i / GRID_LINES) + scroll) % 1;
          const d = dNear + (1 - phase) * (dFar - dNear);
          const y = horizonY + K / d;
          if (y <= horizonY + 4 || y > h) continue;
          const t = (y - horizonY) / (h - horizonY);
          const half = halfWAt(y);
          const postH = (K / d) * 0.13;
          const postW = Math.max(1.5, 5 * t);
          c.fillStyle = withAlpha(accent ?? theme.backdrop.particle, 0.3 + t * 0.55);
          c.fillRect(w / 2 - half * 1.07 - postW, y - postH, postW, postH);
          c.fillRect(w / 2 + half * 1.07, y - postH, postW, postH);
        }
      },
    };
  })());
