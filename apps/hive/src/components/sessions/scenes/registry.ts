/**
 * Scene registry — the catalog of terminal backdrop scenes.
 *
 * Each scene is a renderer-agnostic builder (2D canvas or WebGL). The host
 * (TerminalBackdrop.tsx) looks one up by id; the Settings picker renders the
 * metadata. Order here is the order shown in the picker.
 */

import type { SceneBuilder } from './types';
import { buildPlanetScene } from './planet';
import { buildMatrixScene } from './matrix';
import { buildHorseRaceScene } from './horse-race';
import { buildOutrunScene } from './outrun';
import { buildGameOfLifeScene } from './game-of-life';
import { buildPongScene } from './pong';
import { buildCityScene } from './city';
import { buildStarfoxScene } from './starfox';
import { buildMarioKartScene } from './mario-kart';
import { buildDoomScene } from './doom';

export type SceneId =
  | 'planet'
  | 'matrix'
  | 'horse-race'
  | 'outrun'
  | 'game-of-life'
  | 'pong'
  | 'city'
  | 'starfox'
  | 'mario-kart'
  | 'doom';

export interface SceneMeta {
  id: SceneId;
  name: string;
  description: string;
  build: SceneBuilder;
}

export const SCENES: SceneMeta[] = [
  {
    id: 'planet',
    name: 'Planet',
    description: 'Rotating wireframe planet, halo ring, and a drifting starfield.',
    build: buildPlanetScene,
  },
  {
    id: 'matrix',
    name: 'Matrix Rain',
    description: 'Falling glyph columns. Rains faster while Claude streams.',
    build: buildMatrixScene,
  },
  {
    id: 'horse-race',
    name: 'Horse Race',
    description: 'Silhouette horses galloping a looping track — they surge on tool calls.',
    build: buildHorseRaceScene,
  },
  {
    id: 'outrun',
    name: 'Outrun Drive',
    description: 'A neon synthwave highway racing toward the horizon.',
    build: buildOutrunScene,
  },
  {
    id: 'game-of-life',
    name: 'Game of Life',
    description: "Conway's cellular automaton — new cells seed in on tool calls.",
    build: buildGameOfLifeScene,
  },
  {
    id: 'pong',
    name: 'Pong',
    description: 'A retro Pong match playing itself. Rallies speed up on activity.',
    build: buildPongScene,
  },
  {
    id: 'city',
    name: 'City Skyline',
    description: 'Night cityscape with car-light trails streaking along the road.',
    build: buildCityScene,
  },
  {
    id: 'starfox',
    name: 'Star Fox',
    description: '3D chase cam: a low-poly Arwing races a canyon past a city and arches — barrel-rolls and fires lasers on tool calls.',
    build: buildStarfoxScene,
  },
  {
    id: 'mario-kart',
    name: 'Mario Kart',
    description: '3D kart race through winding green countryside with a full pack of rivals — speeds up as output streams, power-drifts on tool calls.',
    build: buildMarioKartScene,
  },
  {
    id: 'doom',
    name: 'Doom',
    description: 'First-person blast down a demon-infested corridor — the shotgun fires and gibs the nearest demon on every tool call.',
    build: buildDoomScene,
  },
];

export const DEFAULT_SCENE_ID: SceneId = 'planet';

const SCENE_BY_ID = new Map<SceneId, SceneMeta>(SCENES.map((s) => [s.id, s]));

export function getScene(id: string | undefined): SceneMeta {
  return (id ? SCENE_BY_ID.get(id as SceneId) : undefined) ?? SCENES[0];
}
