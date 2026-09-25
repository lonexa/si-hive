/**
 * Activity → reaction helpers shared by every backdrop scene.
 *
 * The host feeds a BackdropActivity ref; computeBoosts() turns the raw
 * timestamps into decayed 0..1 levels that scenes blend into speed,
 * brightness, spawn rates, etc. Keeping this in one place means all scenes
 * react on the same curve.
 */

import type { BackdropActivity, Boosts } from './types';

/**
 * Per-tool accent colors for brief flashes when a tool call fires.
 * Values are hex; scenes convert as needed.
 */
export const TOOL_FLASH_COLOR: Record<string, string> = {
  Read:      '#3b82f6',
  Edit:      '#22c55e',
  Write:     '#f59e0b',
  Bash:      '#a855f7',
  Grep:      '#06b6d4',
  Glob:      '#06b6d4',
  Task:      '#ec4899',
  WebFetch:  '#14b8a6',
  WebSearch: '#14b8a6',
};

/** How long an output/tool event keeps influencing the scene. */
const DECAY_MS = 1500;

export function computeBoosts(activity: BackdropActivity, now: number): Boosts {
  const sinceOutput = now - activity.lastOutputAt;
  const sinceTool = now - activity.lastToolAt;
  const outputBoost = Math.max(0, 1 - sinceOutput / DECAY_MS);
  const toolBoost = Math.max(0, 1 - sinceTool / DECAY_MS);
  const flashColor =
    toolBoost > 0.05 && activity.lastToolName
      ? TOOL_FLASH_COLOR[activity.lastToolName] ?? null
      : null;
  return { outputBoost, toolBoost, sinceOutput, sinceTool, flashColor };
}
