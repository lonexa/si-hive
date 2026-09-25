import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE } from '@/lib/api-config';
import { collapsedForPersona, type PersonaId } from '@/components/layout/nav-config';

export interface NavPrefs {
  persona: PersonaId | 'custom';
  homeRoute: string;
  hidden: string[];
  sectionOrder: string[];
  itemOrder: Record<string, string[]>;
  favorites: string[];
  collapsedSections: string[];
}

interface NavStore extends NavPrefs {
  loaded: boolean;
  /** Reconcile with the server config (server is the durable source of truth). */
  load: () => Promise<void>;
  /** Apply a persona preset, re-seeding the layout (clears manual overrides). */
  applyPersona: (persona: PersonaId) => void;
  setHomeRoute: (route: string) => void;
  toggleHidden: (route: string) => void;
  toggleFavorite: (route: string) => void;
  toggleSection: (sectionId: string) => void;
  setSectionOrder: (ids: string[]) => void;
  setItemOrder: (sectionId: string, routes: string[]) => void;
}

const DEFAULTS: NavPrefs = {
  persona: 'developer',
  homeRoute: '/dashboard',
  hidden: [],
  sectionOrder: [],
  itemOrder: {},
  favorites: [],
  collapsedSections: [],
};

/** Build the server-persisted nav object from the current store state. */
function navPayload(s: NavPrefs): NavPrefs {
  return {
    persona: s.persona,
    homeRoute: s.homeRoute,
    hidden: s.hidden,
    sectionOrder: s.sectionOrder,
    itemOrder: s.itemOrder,
    favorites: s.favorites,
    collapsedSections: s.collapsedSections,
  };
}

/** Fire-and-forget PATCH so the layout survives a fresh install / cache clear. */
function syncServer(prefs: NavPrefs): void {
  void fetch(`${API_BASE}/api/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nav: navPayload(prefs) }),
  }).catch(() => {
    /* non-fatal: localStorage already holds the prefs */
  });
}

export const useNavStore = create<NavStore>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      loaded: false,

      load: async () => {
        try {
          const res = await fetch(`${API_BASE}/api/config`);
          const data = (await res.json()) as { nav?: Partial<NavPrefs> };
          const nav = data.nav;
          if (nav && Object.keys(nav).length > 0) {
            set({
              persona: nav.persona ?? get().persona,
              homeRoute: nav.homeRoute ?? get().homeRoute,
              hidden: nav.hidden ?? get().hidden,
              sectionOrder: nav.sectionOrder ?? get().sectionOrder,
              itemOrder: nav.itemOrder ?? get().itemOrder,
              favorites: nav.favorites ?? get().favorites,
              collapsedSections: nav.collapsedSections ?? get().collapsedSections,
            });
          }
        } catch {
          /* offline / no server: keep localStorage values */
        } finally {
          set({ loaded: true });
        }
      },

      applyPersona: (persona) => {
        const next: Partial<NavPrefs> = {
          persona,
          homeRoute: { developer: '/dashboard', manager: '/team', pm: '/devops' }[persona],
          collapsedSections: collapsedForPersona(persona),
          // Re-seed: drop manual customizations so the preset is clean.
          hidden: [],
          sectionOrder: [],
          itemOrder: {},
          favorites: [],
        };
        set(next);
        syncServer({ ...get(), ...next });
      },

      setHomeRoute: (route) => {
        set({ homeRoute: route });
        syncServer(get());
      },

      toggleHidden: (route) => {
        const hidden = get().hidden.includes(route)
          ? get().hidden.filter((r) => r !== route)
          : [...get().hidden, route];
        set({ hidden, persona: 'custom' });
        syncServer(get());
      },

      toggleFavorite: (route) => {
        const favorites = get().favorites.includes(route)
          ? get().favorites.filter((r) => r !== route)
          : [...get().favorites, route];
        set({ favorites, persona: 'custom' });
        syncServer(get());
      },

      toggleSection: (sectionId) => {
        const collapsedSections = get().collapsedSections.includes(sectionId)
          ? get().collapsedSections.filter((s) => s !== sectionId)
          : [...get().collapsedSections, sectionId];
        set({ collapsedSections });
        syncServer(get());
      },

      setSectionOrder: (ids) => {
        set({ sectionOrder: ids, persona: 'custom' });
        syncServer(get());
      },

      setItemOrder: (sectionId, routes) => {
        set({ itemOrder: { ...get().itemOrder, [sectionId]: routes }, persona: 'custom' });
        syncServer(get());
      },
    }),
    {
      name: 'hive-nav',
      // Persist layout prefs; `loaded` is runtime-only.
      partialize: (s) => ({
        persona: s.persona,
        homeRoute: s.homeRoute,
        hidden: s.hidden,
        sectionOrder: s.sectionOrder,
        itemOrder: s.itemOrder,
        favorites: s.favorites,
        collapsedSections: s.collapsedSections,
      }),
    },
  ),
);
