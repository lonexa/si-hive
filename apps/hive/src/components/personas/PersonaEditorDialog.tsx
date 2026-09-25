import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';

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
}

interface PersonaEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persona: Persona | null;
  currentUser: string;
  onSaved: () => void;
}

export default function PersonaEditorDialog({ open, onOpenChange, persona, currentUser, onSaved }: PersonaEditorDialogProps) {
  const isEditing = persona && persona.id > 0;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(persona?.name ?? '');
      setDescription(persona?.description ?? '');
      setContent(persona?.content ?? '');
      setTags(persona?.tags ?? '');
      setIsShared(persona ? persona.scope === 'shared' : true);
      setError('');
    }
  }, [open, persona]);

  async function handleSave() {
    if (!name.trim() || !content.trim()) {
      setError('Name and content are required.');
      return;
    }
    setSaving(true);
    setError('');

    const body = {
      name: name.trim(),
      description: description.trim(),
      content: content.trim(),
      tags: tags.trim(),
      scope: isShared ? 'shared' : 'user',
      scope_owner: isShared ? '' : currentUser,
      created_by: currentUser,
    };

    try {
      const url = isEditing ? `${API_BASE}/api/personas/${persona.id}` : `${API_BASE}/api/personas`;
      const resp = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const data = await resp.json();
        setError(data.error || 'Failed to save');
      } else {
        onSaved();
      }
    } catch {
      setError('Network error');
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Persona' : 'New Persona'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Senior Backend Engineer" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this persona" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Content <span className="text-muted-foreground font-normal">(instructions that will be injected into CLAUDE.md)</span>
            </label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="You are a senior backend engineer specializing in..."
              className="font-mono text-xs min-h-[200px]"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tags <span className="font-normal">(comma-separated)</span></label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="backend, python, security" />
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={isShared} onCheckedChange={setIsShared} />
            <label className="text-sm text-foreground">
              {isShared ? 'Shared with team' : 'Private to me'}
            </label>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {isEditing ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
