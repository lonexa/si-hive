import { useState } from 'react';
import { GripVertical, Star, Eye, EyeOff, Home } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { useNavStore } from '@/stores/nav-store';
import {
  NAV_SECTIONS, applyOrder, PERSONA_PRESETS, type NavItem, type PersonaId,
} from '@/components/layout/nav-config';

type DragState =
  | { type: 'section'; id: string }
  | { type: 'item'; sectionId: string; route: string }
  | null;

export default function NavigationTab() {
  const { hasAccess } = useAuth();
  const {
    persona, homeRoute, hidden, favorites, sectionOrder, itemOrder,
    applyPersona, setHomeRoute, toggleHidden, toggleFavorite, setSectionOrder, setItemOrder,
  } = useNavStore();

  const [drag, setDrag] = useState<DragState>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const canSee = (item: NavItem) => !item.feature || hasAccess(item.feature);

  // Sections in the user's order; each shows ALL accessible items (hidden ones
  // appear toggled off here so they can be re-enabled).
  const orderedSections = applyOrder(NAV_SECTIONS, sectionOrder, (s) => s.id).map((sec) => ({
    ...sec,
    items: applyOrder(sec.items, itemOrder[sec.id], (i) => i.to).filter(canSee),
  }));

  const homeOptions = orderedSections.flatMap((s) => s.items).filter((i) => !hidden.includes(i.to));

  function moveSection(targetId: string) {
    if (!drag || drag.type !== 'section' || drag.id === targetId) return;
    const ids = orderedSections.map((s) => s.id).filter((id) => id !== drag.id);
    const idx = ids.indexOf(targetId);
    ids.splice(idx, 0, drag.id);
    setSectionOrder(ids);
  }

  function moveItem(sectionId: string, targetRoute: string) {
    if (!drag || drag.type !== 'item' || drag.sectionId !== sectionId || drag.route === targetRoute) return;
    const sec = orderedSections.find((s) => s.id === sectionId);
    if (!sec) return;
    const routes = sec.items.map((i) => i.to).filter((r) => r !== drag.route);
    const idx = routes.indexOf(targetRoute);
    routes.splice(idx, 0, drag.route);
    setItemOrder(sectionId, routes);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Navigation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tailor the sidebar to how you work. Hiding a page only affects your own view — it never
          changes what you're allowed to access.
        </p>
      </div>

      {/* Persona presets */}
      <Card>
        <CardHeader>
          <CardTitle>Persona</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pick a starting layout. This re-seeds section order and which groups are expanded —
            you can fine-tune everything below afterwards.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(Object.keys(PERSONA_PRESETS) as PersonaId[]).map((id) => {
              const p = PERSONA_PRESETS[id];
              const active = persona === id;
              return (
                <button
                  key={id}
                  onClick={() => applyPersona(id)}
                  data-track="settings.nav.apply_persona"
                  data-track-category="action"
                  data-track-props={JSON.stringify({ persona: id })}
                  className={cn(
                    'rounded-md border p-3 text-left transition',
                    active
                      ? 'border-foreground/60 bg-foreground/5'
                      : 'border-border hover:border-foreground/30 hover:bg-foreground/[0.02]',
                  )}
                >
                  <div className="text-sm font-medium text-foreground">{p.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{p.description}</div>
                </button>
              );
            })}
          </div>
          {persona === 'custom' && (
            <p className="text-[11px] text-amber-400">
              Custom layout — your manual changes are in effect. Pick a persona above to reset.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Home page */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="h-4 w-4" /> Home page
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">The page SI Hive opens to.</p>
          <select
            value={homeRoute}
            onChange={(e) => setHomeRoute(e.target.value)}
            className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            {homeOptions.map((i) => (
              <option key={i.to} value={i.to}>{i.label}</option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Pages: show/hide, reorder, favorite */}
      <Card>
        <CardHeader>
          <CardTitle>Pages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Drag the <GripVertical className="inline h-3 w-3" /> handles to reorder sections and pages.
            Star to pin to Favorites. Toggle to show or hide.
          </p>

          {orderedSections.map((sec) => (
            <div
              key={sec.id}
              draggable
              onDragStart={() => setDrag({ type: 'section', id: sec.id })}
              onDragOver={(e) => { e.preventDefault(); if (drag?.type === 'section') setDragOverKey(`sec:${sec.id}`); }}
              onDrop={() => { moveSection(sec.id); setDrag(null); setDragOverKey(null); }}
              onDragEnd={() => { setDrag(null); setDragOverKey(null); }}
              className={cn(
                'rounded-md border border-border p-2',
                dragOverKey === `sec:${sec.id}` && 'border-foreground/50 bg-foreground/5',
              )}
            >
              <div className="flex items-center gap-2 px-1 pb-1.5">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {sec.label ?? 'Home'}
                </span>
              </div>

              <div className="flex flex-col gap-0.5">
                {sec.items.map((item) => {
                  const isHidden = hidden.includes(item.to);
                  const isFav = favorites.includes(item.to);
                  return (
                    <div
                      key={item.to}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); setDrag({ type: 'item', sectionId: sec.id, route: item.to }); }}
                      onDragOver={(e) => { e.preventDefault(); if (drag?.type === 'item' && drag.sectionId === sec.id) setDragOverKey(`item:${item.to}`); }}
                      onDrop={(e) => { e.stopPropagation(); moveItem(sec.id, item.to); setDrag(null); setDragOverKey(null); }}
                      className={cn(
                        'flex items-center gap-2 rounded px-1.5 py-1.5',
                        dragOverKey === `item:${item.to}` && 'bg-foreground/10',
                      )}
                    >
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab shrink-0" />
                      <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className={cn('flex-1 text-sm', isHidden ? 'text-muted-foreground/50' : 'text-foreground')}>
                        {item.label}
                      </span>
                      <button
                        onClick={() => toggleFavorite(item.to)}
                        title={isFav ? 'Unpin from Favorites' : 'Pin to Favorites'}
                        className={cn('shrink-0', isFav ? 'text-amber-400' : 'text-muted-foreground hover:text-foreground')}
                      >
                        <Star className={cn('h-4 w-4', isFav && 'fill-current')} />
                      </button>
                      <button
                        onClick={() => toggleHidden(item.to)}
                        title={isHidden ? 'Show' : 'Hide'}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <Switch
                        checked={!isHidden}
                        onCheckedChange={() => toggleHidden(item.to)}
                        aria-label={`Toggle ${item.label}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
