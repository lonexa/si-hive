import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Wand2, Pencil, Trash2, Globe, User, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import PersonaEditorDialog from './PersonaEditorDialog';
import PersonaDesigner from './PersonaDesigner';

import { API_BASE } from '@/lib/api-config';

interface Persona {
  id: number;
  name: string;
  description: string;
  content: string;
  tags: string;
  scope: 'shared' | 'user';
  scope_owner: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export default function PersonasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'all';
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [currentUser, setCurrentUser] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Persona | null>(null);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/personas/current-user`);
      const data = await resp.json();
      setCurrentUser(data.username);
    } catch { /* ignore */ }
  }, []);

  const fetchPersonas = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      const resp = await fetch(`${API_BASE}/api/personas?${params}`);
      const data = await resp.json();
      setPersonas(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [search]);

  useEffect(() => { void fetchCurrentUser(); }, [fetchCurrentUser]);
  useEffect(() => { void fetchPersonas(); }, [fetchPersonas]);

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await fetch(`${API_BASE}/api/personas/${deleteTarget.id}`, { method: 'DELETE' });
      void fetchPersonas();
    } catch { /* ignore */ }
    setDeleteTarget(null);
  };

  const handleEdit = (persona: Persona) => {
    setEditingPersona(persona);
    setEditorOpen(true);
  };

  const handleNew = () => {
    setEditingPersona(null);
    setEditorOpen(true);
  };

  const handleDesignerComplete = (persona: { name: string; description: string; content: string }) => {
    setDesignerOpen(false);
    setEditingPersona({ ...persona, id: 0, tags: '', scope: 'shared', scope_owner: '', created_by: currentUser, created_at: '', updated_at: '' });
    setEditorOpen(true);
  };

  const filtered = personas.filter((p) => {
    if (activeTab === 'mine') return p.scope === 'user' && p.scope_owner === currentUser;
    if (activeTab === 'shared') return p.scope === 'shared';
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Personas</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDesignerOpen(true)} className="gap-1.5" data-track="personas.open_designer" data-track-category="modal">
            <Wand2 className="h-3.5 w-3.5" />
            Design with Wizard
          </Button>
          <Button size="sm" onClick={handleNew} className="gap-1.5" data-track="personas.new_persona" data-track-category="modal">
            <Plus className="h-3.5 w-3.5" />
            New Persona
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex items-center gap-3">
          <TabsList>
            <TabsTrigger value="all" data-track="personas.tab.all" data-track-category="nav">All</TabsTrigger>
            <TabsTrigger value="mine" data-track="personas.tab.mine" data-track-category="nav">My Personas</TabsTrigger>
            <TabsTrigger value="shared" data-track="personas.tab.shared" data-track-category="nav">Shared</TabsTrigger>
          </TabsList>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search personas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>

        {['all', 'mine', 'shared'].map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            {loading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No personas found. Create one to get started.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map((persona) => (
                  <Card key={persona.id} className="group hover:border-foreground/20 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-foreground truncate">{persona.name}</h3>
                            <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 h-4">
                              {persona.scope === 'shared' ? (
                                <><Globe className="h-2.5 w-2.5 mr-0.5" />Shared</>
                              ) : (
                                <><User className="h-2.5 w-2.5 mr-0.5" />Private</>
                              )}
                            </Badge>
                          </div>
                          {persona.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{persona.description}</p>
                          )}
                          {persona.tags && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {persona.tags.split(',').map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 gap-0.5">
                                  <Tag className="h-2 w-2" />{tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <div className="text-[10px] text-muted-foreground mt-2">
                            by {persona.created_by || 'unknown'} · {new Date(persona.updated_at).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(persona)} data-track="personas.edit_persona" data-track-category="modal">
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(persona)} data-track="personas.delete_persona" data-track-category="action">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <PersonaEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        persona={editingPersona}
        currentUser={currentUser}
        onSaved={() => { setEditorOpen(false); void fetchPersonas(); }}
      />

      {designerOpen && (
        <PersonaDesigner
          open={designerOpen}
          onOpenChange={setDesignerOpen}
          onComplete={handleDesignerComplete}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Persona</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This will also remove it from all project assignments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-track="personas.confirm_delete" data-track-category="action">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
