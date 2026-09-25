/**
 * Theme presets that re-skin the Hive terminal (xterm palette) AND the 3D
 * backdrop together. Picking a theme in Settings should give a noticeably
 * different overall vibe — colors, glow, particles all shift in concert.
 *
 * Each theme defines:
 *   - xterm: a partial ITheme that gets merged into createTerminal()'s defaults
 *   - backdrop: colors fed to the active backdrop scene (primary/secondary/particles)
 *   - effect: optional visual treatment (scanlines, CRT curvature) applied as a
 *     CSS class on the terminal wrapper
 *
 * Order matters here — it's the order they appear in the settings picker.
 */

import type { ITheme } from '@xterm/xterm';

export interface TerminalTheme {
  id: ThemeId;
  name: string;
  description: string;
  xterm: Partial<ITheme>;
  backdrop: {
    /** Hex color for the central wireframe shape. */
    primary: string;
    /** Hex color for the secondary orbiting shape. */
    secondary: string;
    /** Hex color for the particle field. */
    particle: string;
    /** Background gradient (CSS color). */
    bg: string;
  };
  /** Optional CSS-class effect: 'none' | 'scanlines' | 'crt'. */
  effect: 'none' | 'scanlines' | 'crt';
}

export const THEMES: TerminalTheme[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Neutral dark — the original SI Hive look.',
    xterm: {
      background: '#0a0a0a',
      foreground: '#e5e7eb',
      cursor: '#e5e7eb',
      cursorAccent: '#0a0a0a',
      selectionBackground: 'rgba(120, 120, 140, 0.4)',
    },
    backdrop: {
      primary:  '#7c3aed',
      secondary:'#3b82f6',
      particle: '#a78bfa',
      bg:       '#0a0a0a',
    },
    effect: 'none',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Deep purple + hot pink + cyan. Loud, neon, alive.',
    xterm: {
      background: '#0d0221',
      foreground: '#f5d4ff',
      cursor:     '#ff2bd6',
      cursorAccent: '#0d0221',
      selectionBackground: 'rgba(255, 43, 214, 0.35)',
      black:   '#0d0221',
      red:     '#ff3b8b',
      green:   '#26ffce',
      yellow:  '#ffd166',
      blue:    '#5b8cff',
      magenta: '#ff2bd6',
      cyan:    '#1de9ff',
      white:   '#f5d4ff',
      brightBlack:   '#5a3a78',
      brightRed:     '#ff70a8',
      brightGreen:   '#6fffe0',
      brightYellow:  '#ffe28a',
      brightBlue:    '#8db0ff',
      brightMagenta: '#ff8af0',
      brightCyan:    '#8df5ff',
      brightWhite:   '#ffffff',
    },
    backdrop: {
      primary:  '#ff2bd6',
      secondary:'#1de9ff',
      particle: '#f5d4ff',
      bg:       '#0d0221',
    },
    effect: 'none',
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    description: 'Sunset gradient — magenta, orange, deep blue.',
    xterm: {
      background: '#15052a',
      foreground: '#ffd0ff',
      cursor:     '#ff6ec7',
      cursorAccent: '#15052a',
      selectionBackground: 'rgba(255, 110, 199, 0.3)',
      black:   '#15052a',
      red:     '#ff6ec7',
      green:   '#3ff5b1',
      yellow:  '#ff9966',
      blue:    '#5e7cff',
      magenta: '#c074ff',
      cyan:    '#3fe8ff',
      white:   '#ffd0ff',
      brightBlack:   '#4d2a73',
      brightRed:     '#ffa0d8',
      brightGreen:   '#7df5cb',
      brightYellow:  '#ffbf9a',
      brightBlue:    '#8ea7ff',
      brightMagenta: '#dba5ff',
      brightCyan:    '#80efff',
      brightWhite:   '#ffe8ff',
    },
    backdrop: {
      primary:  '#ff6ec7',
      secondary:'#5e7cff',
      particle: '#ff9966',
      bg:       '#15052a',
    },
    effect: 'none',
  },
  {
    id: 'retro-green',
    name: 'Retro Green',
    description: 'Vintage phosphor terminal. Optional scanline overlay.',
    xterm: {
      background: '#001a00',
      foreground: '#33ff66',
      cursor:     '#66ff99',
      cursorAccent: '#001a00',
      selectionBackground: 'rgba(51, 255, 102, 0.3)',
      black:   '#001a00',
      red:     '#ff8888',
      green:   '#33ff66',
      yellow:  '#bbff66',
      blue:    '#66ffcc',
      magenta: '#88ffaa',
      cyan:    '#88ffee',
      white:   '#ddffdd',
      brightBlack:   '#226622',
      brightRed:     '#ffaaaa',
      brightGreen:   '#66ff88',
      brightYellow:  '#ddff88',
      brightBlue:    '#99ffdd',
      brightMagenta: '#aaffbb',
      brightCyan:    '#aaffee',
      brightWhite:   '#ffffff',
    },
    backdrop: {
      primary:  '#33ff66',
      secondary:'#1a8033',
      particle: '#66ff99',
      bg:       '#001a00',
    },
    effect: 'scanlines',
  },
  {
    id: 'amber-crt',
    name: 'Amber CRT',
    description: 'Warm amber on black. CRT glow + scanlines.',
    xterm: {
      background: '#1a0d00',
      foreground: '#ffb84d',
      cursor:     '#ffd28a',
      cursorAccent: '#1a0d00',
      selectionBackground: 'rgba(255, 184, 77, 0.3)',
      black:   '#1a0d00',
      red:     '#ff7a4d',
      green:   '#cca360',
      yellow:  '#ffd28a',
      blue:    '#a36b3d',
      magenta: '#ff9966',
      cyan:    '#dcb478',
      white:   '#ffe1b3',
      brightBlack:   '#6b4422',
      brightRed:     '#ffa080',
      brightGreen:   '#e3c483',
      brightYellow:  '#ffe7b3',
      brightBlue:    '#c98a55',
      brightMagenta: '#ffbb99',
      brightCyan:    '#f0d09a',
      brightWhite:   '#fff2d8',
    },
    backdrop: {
      primary:  '#ffb84d',
      secondary:'#a36b3d',
      particle: '#ffd28a',
      bg:       '#1a0d00',
    },
    effect: 'scanlines',
  },
  {
    id: 'soft-pastel',
    name: 'Soft Pastel',
    description: 'Lighter, calmer palette. Mint, peach, lavender on charcoal.',
    xterm: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor:     '#bb9af7',
      cursorAccent: '#1a1b26',
      selectionBackground: 'rgba(187, 154, 247, 0.3)',
      black:   '#1a1b26',
      red:     '#f7768e',
      green:   '#9ece6a',
      yellow:  '#e0af68',
      blue:    '#7aa2f7',
      magenta: '#bb9af7',
      cyan:    '#7dcfff',
      white:   '#c0caf5',
      brightBlack:   '#414868',
      brightRed:     '#ff9aaf',
      brightGreen:   '#b9f0a0',
      brightYellow:  '#fad0a5',
      brightBlue:    '#a0c4ff',
      brightMagenta: '#d0baff',
      brightCyan:    '#a8e0ff',
      brightWhite:   '#e6e6f0',
    },
    backdrop: {
      primary:  '#bb9af7',
      secondary:'#7aa2f7',
      particle: '#7dcfff',
      bg:       '#1a1b26',
    },
    effect: 'none',
  },
];

export type ThemeId =
  | 'default'
  | 'cyberpunk'
  | 'synthwave'
  | 'retro-green'
  | 'amber-crt'
  | 'soft-pastel';
export const DEFAULT_THEME_ID: ThemeId = 'default';

const THEME_BY_ID = new Map<string, TerminalTheme>(THEMES.map((t) => [t.id, t]));

export function getTheme(id: string | undefined): TerminalTheme {
  return (id ? THEME_BY_ID.get(id) : undefined) ?? THEMES[0];
}
