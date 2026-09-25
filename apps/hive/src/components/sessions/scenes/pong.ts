/**
 * Pong — a retro match playing itself.
 *
 * Both paddles are AI: they predict where the ball will cross their column
 * (reflecting off the top/bottom walls) and ease toward it, so the rally
 * never ends. A faint rally counter ticks up on every paddle hit.
 *
 * Reactions:
 *   - Streaming: the ball — and the whole rally — speeds up
 *   - Tool call: the ball's trail flashes the tool accent color
 */

import type { SceneBuilder } from './types';
import { runCanvasScene, withAlpha } from './canvas2d';

/** Where will the ball cross paddleX, accounting for wall bounces? */
function predictY(
  ballX: number, ballY: number, vx: number, vy: number,
  paddleX: number, top: number, bot: number,
): number {
  if (vx === 0 || (paddleX - ballX) / vx <= 0) return ballY;
  const span = Math.max(1, bot - top);
  const y = ballY + vy * ((paddleX - ballX) / vx);
  let m = (y - top) % (2 * span);
  if (m < 0) m += 2 * span;
  return m < span ? top + m : top + (2 * span - m);
}

export const buildPongScene: SceneBuilder = (ctx) =>
  runCanvasScene(ctx, (() => {
    let ballX = 0;
    let ballY = 0;
    let vx = 1;
    let vy = 1;
    let leftY = 0;
    let rightY = 0;
    let rally = 0;
    let trail: { x: number; y: number }[] = [];
    let cw = 1;
    let ch = 1;

    function serve(w: number, h: number) {
      ballX = w / 2;
      ballY = h / 2;
      const ang = (Math.random() * 0.6 - 0.3) + (Math.random() < 0.5 ? 0 : Math.PI);
      vx = Math.cos(ang);
      vy = Math.sin(ang);
      rally = 0;
      trail = [];
    }

    function init(w: number, h: number) {
      cw = w;
      ch = h;
      leftY = h / 2;
      rightY = h / 2;
      serve(w, h);
    }

    return {
      init,
      frame(c, f) {
        const { theme, boosts, dt, w, h } = f;
        if (w !== cw || h !== ch) { cw = w; ch = h; }

        const margin = Math.max(14, w * 0.03);
        const paddleW = Math.max(5, w * 0.008);
        const paddleH = Math.max(34, h * 0.16);
        const ballR = Math.max(4, Math.min(w, h) * 0.011);
        const top = ballR;
        const bot = h - ballR;
        const leftX = margin;
        const rightX = w - margin;

        const speed = (w * 0.42) * (1 + boosts.outputBoost * 1.7);
        ballX += vx * speed * dt;
        ballY += vy * speed * dt;

        // Walls.
        if (ballY < top) { ballY = top; vy = Math.abs(vy); }
        else if (ballY > bot) { ballY = bot; vy = -Math.abs(vy); }

        // Paddle collisions — add "english" from the contact offset.
        if (vx < 0 && ballX - ballR < leftX + paddleW && ballX > leftX) {
          ballX = leftX + paddleW + ballR;
          vx = Math.abs(vx);
          vy += ((ballY - leftY) / paddleH) * 1.4;
          rally++;
        } else if (vx > 0 && ballX + ballR > rightX - paddleW && ballX < rightX) {
          ballX = rightX - paddleW - ballR;
          vx = -Math.abs(vx);
          vy += ((ballY - rightY) / paddleH) * 1.4;
          rally++;
        }
        // Re-normalise so total speed stays constant regardless of english.
        const mag = Math.hypot(vx, vy) || 1;
        vx /= mag; vy /= mag;

        // Safety net: if the ball somehow escapes, re-serve.
        if (ballX < -40 || ballX > w + 40) serve(w, h);

        // AI paddles: ease toward the predicted crossing point.
        const ease = Math.min(1, dt * 7);
        const half = paddleH / 2;
        if (vx < 0) {
          const ty = predictY(ballX, ballY, vx * speed, vy * speed, leftX, top, bot);
          leftY += (ty - leftY) * ease;
        } else {
          leftY += (h / 2 - leftY) * ease * 0.4; // drift home
        }
        if (vx > 0) {
          const ty = predictY(ballX, ballY, vx * speed, vy * speed, rightX, top, bot);
          rightY += (ty - rightY) * ease;
        } else {
          rightY += (h / 2 - rightY) * ease * 0.4;
        }
        leftY = Math.max(half, Math.min(h - half, leftY));
        rightY = Math.max(half, Math.min(h - half, rightY));

        // --- Draw ----------------------------------------------------------
        c.fillStyle = theme.backdrop.bg;
        c.fillRect(0, 0, w, h);

        // Center net.
        c.fillStyle = withAlpha(theme.backdrop.secondary, 0.35);
        const dash = h * 0.03;
        for (let y = dash; y < h; y += dash * 2) {
          c.fillRect(w / 2 - 1.5, y, 3, dash);
        }

        // Ball trail.
        trail.push({ x: ballX, y: ballY });
        if (trail.length > 16) trail.shift();
        const trailColor = boosts.flashColor ?? theme.backdrop.particle;
        for (let i = 0; i < trail.length; i++) {
          const a = (i / trail.length) * 0.5;
          c.fillStyle = withAlpha(trailColor, a);
          c.beginPath();
          c.arc(trail[i].x, trail[i].y, ballR * (0.4 + (i / trail.length) * 0.6), 0, Math.PI * 2);
          c.fill();
        }

        // Paddles.
        c.fillStyle = theme.backdrop.primary;
        c.fillRect(leftX, leftY - half, paddleW, paddleH);
        c.fillRect(rightX - paddleW, rightY - half, paddleW, paddleH);

        // Ball.
        c.fillStyle = boosts.flashColor ?? theme.backdrop.particle;
        c.beginPath();
        c.arc(ballX, ballY, ballR, 0, Math.PI * 2);
        c.fill();

        // Faint rally counter.
        c.fillStyle = withAlpha(theme.backdrop.secondary, 0.4);
        c.font = `${Math.max(14, h * 0.05)}px ui-monospace, Menlo, monospace`;
        c.textAlign = 'center';
        c.textBaseline = 'top';
        c.fillText(String(rally), w / 2, h * 0.04);
        c.textAlign = 'left';
      },
    };
  })());
