/**
 * Matrix Rain — falling glyph columns.
 *
 * Classic effect: each column draws one fresh (bright) glyph per frame at
 * its head; a translucent background fill each frame fades older glyphs
 * into a trailing tail.
 *
 * Reactions:
 *   - Streaming: columns fall faster, trails run a touch longer
 *   - Tool call: a share of columns drop their glyph in the tool accent color
 */

import type { SceneBuilder } from './types';
import { runCanvasScene, withAlpha, mixHex } from './canvas2d';

// Half-width katakana + digits + a few symbols — the familiar "code rain" set.
const GLYPHS = (() => {
  const out: string[] = [];
  for (let c = 0xff66; c <= 0xff9d; c++) out.push(String.fromCharCode(c));
  for (let c = 0x30; c <= 0x39; c++) out.push(String.fromCharCode(c));
  '+-*/=<>|#$%&'.split('').forEach((s) => out.push(s));
  return out;
})();

const randGlyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

export const buildMatrixScene: SceneBuilder = (ctx) =>
  runCanvasScene(ctx, (() => {
    const FONT = 15; // px — column width and glyph size

    let cols = 0;
    // Per-column head row (float), fall speed (rows/sec), and current glyph.
    let head: Float32Array = new Float32Array(0);
    let speed: Float32Array = new Float32Array(0);
    let glyph: string[] = [];

    function init(w: number, h: number) {
      cols = Math.max(1, Math.ceil(w / FONT));
      head = new Float32Array(cols);
      speed = new Float32Array(cols);
      glyph = new Array(cols);
      const rows = h / FONT;
      for (let i = 0; i < cols; i++) {
        head[i] = Math.random() * rows;       // start scattered, not all at the top
        speed[i] = 6 + Math.random() * 10;    // rows per second
        glyph[i] = randGlyph();
      }
    }

    return {
      init,
      frame(c, f) {
        const { theme, boosts, dt, w, h } = f;
        const rows = h / FONT;

        // Fade prior glyphs toward the background to leave trailing tails.
        // A hotter stream fades a touch slower so the rain reads as "faster".
        const fade = 0.16 - boosts.outputBoost * 0.05;
        c.fillStyle = withAlpha(theme.backdrop.bg, fade);
        c.fillRect(0, 0, w, h);

        c.font = `${FONT}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        c.textBaseline = 'top';

        const headColor = mixHex(theme.backdrop.particle, '#ffffff', 0.55);
        const bodyColor = theme.backdrop.primary;
        const speedMul = 1 + boosts.outputBoost * 2.6;
        const flash = boosts.flashColor;

        for (let i = 0; i < cols; i++) {
          // Occasionally mutate the glyph so columns shimmer.
          if (Math.random() < 0.08) glyph[i] = randGlyph();

          const x = i * FONT;
          const y = head[i] * FONT;

          // A fraction of columns flash to the tool accent on tool calls.
          if (flash && ((i * 7 + ((f.now / 90) | 0)) % 5 === 0)) {
            c.fillStyle = flash;
          } else {
            c.fillStyle = i % 9 === 0 ? bodyColor : headColor;
          }
          c.fillText(glyph[i], x, y);

          head[i] += speed[i] * speedMul * dt;
          // Restart the column from the top once it falls off the bottom
          // (randomised so columns don't resync).
          if (head[i] * FONT > h && Math.random() > 0.965) {
            head[i] = -Math.random() * rows * 0.5;
            speed[i] = 6 + Math.random() * 10;
          }
        }
      },
    };
  })());
