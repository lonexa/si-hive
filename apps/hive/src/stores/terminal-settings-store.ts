import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_THEME_ID, type ThemeId } from '@/components/sessions/themes';
import { DEFAULT_SCENE_ID, type SceneId } from '@/components/sessions/scenes/registry';

export interface TerminalSettings {
  mode: 'enhanced' | 'classic';
  gpu: boolean;
  inlineImages: boolean;
  webLinks: boolean;
  search: boolean;
  dragDrop: boolean;
  toolDecorations: boolean;
  ambientCanvas: boolean;
  stickyToolBanner: boolean;
  workItemCards: boolean;
  filePathLinks: boolean;
  toolTimingChips: boolean;
  /** Active theme preset id — drives xterm palette + backdrop colors. */
  theme: ThemeId;
  /** Active backdrop scene id — which animated graphic plays behind the terminal. */
  terminalScene: SceneId;
}

interface TerminalSettingsStore extends TerminalSettings {
  setMode: (mode: 'enhanced' | 'classic') => void;
  setGpu: (on: boolean) => void;
  setInlineImages: (on: boolean) => void;
  setWebLinks: (on: boolean) => void;
  setSearch: (on: boolean) => void;
  setDragDrop: (on: boolean) => void;
  setToolDecorations: (on: boolean) => void;
  setAmbientCanvas: (on: boolean) => void;
  setStickyToolBanner: (on: boolean) => void;
  setWorkItemCards: (on: boolean) => void;
  setFilePathLinks: (on: boolean) => void;
  setToolTimingChips: (on: boolean) => void;
  setTheme: (id: ThemeId) => void;
  setTerminalScene: (id: SceneId) => void;
  resetClassic: () => void;
  resetEnhanced: () => void;
}

const ENHANCED_DEFAULTS: TerminalSettings = {
  mode: 'enhanced',
  gpu: true,
  inlineImages: true,
  webLinks: true,
  search: true,
  dragDrop: true,
  toolDecorations: true,
  // ON by default — the dramatized 3D backdrop is the headline graphics
  // feature. Users can still flip it off in Settings.
  ambientCanvas: true,
  stickyToolBanner: true,
  workItemCards: true,
  filePathLinks: true,
  toolTimingChips: true,
  theme: DEFAULT_THEME_ID,
  terminalScene: DEFAULT_SCENE_ID,
};

const CLASSIC_DEFAULTS: TerminalSettings = {
  mode: 'classic',
  gpu: false,
  inlineImages: false,
  webLinks: false,
  search: false,
  dragDrop: false,
  toolDecorations: false,
  ambientCanvas: false,
  stickyToolBanner: false,
  workItemCards: false,
  filePathLinks: false,
  toolTimingChips: false,
  theme: DEFAULT_THEME_ID,
  terminalScene: DEFAULT_SCENE_ID,
};

export const useTerminalSettings = create<TerminalSettingsStore>()(
  persist(
    (set) => ({
      ...ENHANCED_DEFAULTS,
      setMode: (mode) => set({ mode }),
      setGpu: (gpu) => set({ gpu }),
      setInlineImages: (inlineImages) => set({ inlineImages }),
      setWebLinks: (webLinks) => set({ webLinks }),
      setSearch: (search) => set({ search }),
      setDragDrop: (dragDrop) => set({ dragDrop }),
      setToolDecorations: (toolDecorations) => set({ toolDecorations }),
      setAmbientCanvas: (ambientCanvas) => set({ ambientCanvas }),
      setStickyToolBanner: (stickyToolBanner) => set({ stickyToolBanner }),
      setWorkItemCards: (workItemCards) => set({ workItemCards }),
      setFilePathLinks: (filePathLinks) => set({ filePathLinks }),
      setToolTimingChips: (toolTimingChips) => set({ toolTimingChips }),
      setTheme: (theme) => set({ theme }),
      setTerminalScene: (terminalScene) => set({ terminalScene }),
      resetClassic: () => set(CLASSIC_DEFAULTS),
      resetEnhanced: () => set(ENHANCED_DEFAULTS),
    }),
    { name: 'hive-terminal-settings' },
  ),
);

export function resolveEffectiveSettings(s: TerminalSettings): TerminalSettings {
  // Classic mode forces the minimal feature set, but the user's chosen
  // theme + backdrop scene are cosmetic and always preserved.
  if (s.mode === 'classic') {
    return { ...CLASSIC_DEFAULTS, theme: s.theme, terminalScene: s.terminalScene };
  }
  return s;
}
