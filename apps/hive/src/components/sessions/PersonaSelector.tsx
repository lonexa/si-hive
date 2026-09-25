import { useState, useEffect, useRef } from 'react';
import { UserCircle2, Check, Loader2, Globe, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { API_BASE } from '@/lib/api-config';

interface Persona {
  id: number;
  name: string;
  description: string;
  scope: 'shared' | 'user';
  scope_owner: string;
}

interface PersonaSelectorProps {
  projectDir: string;
}

export default function PersonaSelector({ projectDir }: PersonaSelectorProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activeIds, setActiveIds] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Load personas + active assignments
  useEffect(() => {
    fetch(`${API_BASE}/api/personas`)
      .then((r) => r.json())
      .then((data) => setPersonas(Array.isArray(data) ? data : []))
      .catch(() => {});

    fetch(`${API_BASE}/api/personas/assignments/${encodeURIComponent(projectDir)}`)
      .then((r) => r.json())
      .then((data) => setActiveIds(data.personaIds ?? []))
      .catch(() => {});
  }, [projectDir]);

  async function setAssignments(next: number[]) {
    setActivating(true);
    try {
      const res = await fetch(`${API_BASE}/api/personas/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: projectDir, personaIds: next }),
      });
      if (res.ok) {
        setActiveIds(next);
      }
    } catch { /* ignore */ }
    setActivating(false);
  }

  function togglePersona(id: number) {
    const next = activeIds.includes(id)
      ? activeIds.filter((i) => i !== id)
      : [...activeIds, id];
    return setAssignments(next);
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        className={cn(
          'gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent',
          open && 'bg-accent text-foreground',
        )}
        title="Select active personas"
      >
        <UserCircle2 className="h-4 w-4" />
        Personas
        {activeIds.length > 0 && (
          <Badge className="text-[10px] px-1.5 py-0 min-w-[18px] h-4 bg-blue-600 text-white border-0">
            {activeIds.length}
          </Badge>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-md border border-border bg-card shadow-lg">
          <div className="px-3 py-2 border-b border-border">
            <span className="text-xs font-medium text-foreground">Active Personas</span>
            <span className="text-xs text-muted-foreground ml-1">— select for this project</span>
          </div>

          {personas.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No personas found. Create one on the Personas page.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {personas.map((persona) => {
                const isActive = activeIds.includes(persona.id);
                return (
                  <button
                    key={persona.id}
                    onClick={() => void togglePersona(persona.id)}
                    disabled={activating}
                    className={cn(
                      'w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-accent transition-colors',
                      isActive && 'bg-accent/50',
                    )}
                  >
                    <div className={cn(
                      'mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0',
                      isActive ? 'bg-blue-600 border-blue-600' : 'border-muted-foreground/40',
                    )}>
                      {isActive && <Check className="h-3 w-3 text-white" />}
                      {activating && !isActive && <Loader2 className="h-3 w-3 animate-spin" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground truncate">{persona.name}</span>
                        {persona.scope === 'shared' ? (
                          <Globe className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                        ) : (
                          <User className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                        )}
                      </div>
                      {persona.description && (
                        <div className="text-[10px] text-muted-foreground truncate">{persona.description}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {activeIds.length > 0 && (
            <div className="px-3 py-2 border-t border-border">
              <button
                onClick={() => void setAssignments([])}
                className="text-[10px] text-muted-foreground hover:text-foreground"
                disabled={activating}
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
