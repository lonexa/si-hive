/**
 * Game of Life — Conway's cellular automaton, quietly evolving.
 *
 * A toroidal (wrap-around) grid steps on a timer. Cells born this
 * generation glow a little brighter; if the board stagnates it reseeds
 * itself with random soup.
 *
 * Reactions:
 *   - Streaming: the simulation steps faster
 *   - Tool call: a fresh cluster is seeded in, tagged with the tool accent
 *     color for a few generations
 */

import type { SceneBuilder } from './types';
import { runCanvasScene, withAlpha } from './canvas2d';

const FLASH_GENS = 6;

export const buildGameOfLifeScene: SceneBuilder = (ctx) =>
  runCanvasScene(ctx, (() => {
    let cols = 0;
    let rows = 0;
    let cell = 12;
    let grid = new Uint8Array(0);
    let next = new Uint8Array(0);
    let born = new Uint8Array(0);
    let flash = new Uint8Array(0);   // per-cell flash-tag countdown
    let flashColor = '#ffffff';
    let stepAccum = 0;
    let lastSeedAt = 0;

    function soup() {
      for (let i = 0; i < grid.length; i++) {
        grid[i] = Math.random() < 0.32 ? 1 : 0;
        born[i] = grid[i];
        flash[i] = 0;
      }
    }

    function init(w: number, h: number) {
      cell = Math.max(8, Math.round(Math.min(w, h) / 52));
      cols = Math.max(4, Math.ceil(w / cell));
      rows = Math.max(4, Math.ceil(h / cell));
      grid = new Uint8Array(cols * rows);
      next = new Uint8Array(cols * rows);
      born = new Uint8Array(cols * rows);
      flash = new Uint8Array(cols * rows);
      soup();
    }

    function seedCluster(color: string) {
      flashColor = color;
      const cx = (Math.random() * cols) | 0;
      const cy = (Math.random() * rows) | 0;
      const span = 5;
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          if (Math.random() < 0.5) continue;
          const x = (cx + dx + cols) % cols;
          const y = (cy + dy + rows) % rows;
          const idx = y * cols + x;
          grid[idx] = 1;
          born[idx] = 1;
          flash[idx] = FLASH_GENS;
        }
      }
    }

    function step() {
      let alive = 0;
      for (let y = 0; y < rows; y++) {
        const up = ((y - 1 + rows) % rows) * cols;
        const mid = y * cols;
        const dn = ((y + 1) % rows) * cols;
        for (let x = 0; x < cols; x++) {
          const xl = (x - 1 + cols) % cols;
          const xr = (x + 1) % cols;
          const n =
            grid[up + xl] + grid[up + x] + grid[up + xr] +
            grid[mid + xl] +                grid[mid + xr] +
            grid[dn + xl] + grid[dn + x] + grid[dn + xr];
          const idx = mid + x;
          const wasAlive = grid[idx];
          const nowAlive = wasAlive ? (n === 2 || n === 3) : (n === 3);
          next[idx] = nowAlive ? 1 : 0;
          born[idx] = nowAlive && !wasAlive ? 1 : 0;
          if (flash[idx] > 0) flash[idx]--;
          if (nowAlive) alive++;
        }
      }
      const tmp = grid;
      grid = next;
      next = tmp;
      // Reseed if the board has mostly died out.
      if (alive < grid.length * 0.02) soup();
    }

    return {
      init,
      frame(c, f) {
        const { theme, boosts, dt, w, h } = f;

        // A tool call seeds a tagged cluster (debounced).
        if (boosts.flashColor && boosts.sinceTool < 120 && f.now - lastSeedAt > 350) {
          lastSeedAt = f.now;
          seedCluster(boosts.flashColor);
        }

        // Step on a timer; faster while output streams.
        const interval = 0.16 / (1 + boosts.outputBoost * 2.4);
        stepAccum += dt;
        while (stepAccum >= interval) {
          stepAccum -= interval;
          step();
        }

        c.fillStyle = theme.backdrop.bg;
        c.fillRect(0, 0, w, h);

        const gap = cell > 10 ? 1.5 : 1;
        const size = cell - gap;
        const normal = withAlpha(theme.backdrop.primary, 0.62);
        const fresh = withAlpha(theme.backdrop.particle, 0.85);
        for (let y = 0; y < rows; y++) {
          const row = y * cols;
          for (let x = 0; x < cols; x++) {
            const idx = row + x;
            if (!grid[idx]) continue;
            c.fillStyle = flash[idx] > 0 ? flashColor : born[idx] ? fresh : normal;
            c.fillRect(x * cell, y * cell, size, size);
          }
        }
      },
    };
  })());
