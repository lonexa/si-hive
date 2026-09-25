import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Save } from 'lucide-react';

import { API_BASE } from '@/lib/api-config';

interface KBEntryFormData {
  title: string;
  content: string;
  category: string;
  tags: string;
  scope: 'shared' | 'user';
  scope_owner: string;
  source: string;
  created_by: string;
}

interface KBEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: { id: number } & KBEntryFormData;
  onSaved: () => void;
  defaultScopeOwner?: string;
}

export default function KBEntryDialog({ open, onOpenChange, entry, onSaved, defaultScopeOwner }: KBEntryDialogProps) {
  const [form, setForm] = useState<KBEntryFormData>({
    title: '',
    content: '',
    category: '',
    tags: '',
    scope: 'shared',
    scope_owner: '',
    source: '',
    created_by: '',
  });
  const [categories, setCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (entry) {
        setForm({
          title: entry.title,
          content: entry.content,
          category: entry.category,
          tags: entry.tags,
          scope: entry.scope || 'shared',
          scope_owner: entry.scope_owner || '',
          source: entry.source,
          created_by: entry.created_by,
        });
      } else {
        setForm({
          title: '', content: '', category: '', tags: '',
          scope: 'shared', scope_owner: defaultScopeOwner || '',
          source: '', created_by: '',
        });
      }
      fetch(`${API_BASE}/api/kb/categories`)
        .then((r) => r.json())
        .then((data: string[]) => setCategories(data))
        .catch(() => {});
    }
  }, [open, entry, defaultScopeOwner]);

  async function handleSave() {
    if (!form.title.trim() || !form.content.trim()) return;
    const payload = {
      ...form,
      scope_owner: form.scope === 'user' ? (form.scope_owner || defaultScopeOwner || '') : '',
    };
    setSaving(true);
    try {
      const url = entry ? `${API_BASE}/api/kb/entries/${entry.id}` : `${API_BASE}/api/kb/entries`;
      const method = entry ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onSaved();
        onOpenChange(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit Entry' : 'Add Entry'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Title *</label>
            <Input
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Entry title"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Content *</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
              placeholder="Entry content..."
              rows={6}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Category</label>
              <Input
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                placeholder="e.g. patterns, debugging"
                list="kb-categories"
              />
              <datalist id="kb-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Tags</label>
              <Input
                value={form.tags}
                onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
                placeholder="comma, separated, tags"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Scope</label>
              <select
                value={form.scope}
                onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value as 'shared' | 'user' }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="shared">Shared (visible to everyone)</option>
                <option value="user">User (only me)</option>
              </select>
            </div>
            {form.scope === 'user' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Owner</label>
                <Input
                  value={form.scope_owner}
                  onChange={(e) => setForm((p) => ({ ...p, scope_owner: e.target.value }))}
                  placeholder={defaultScopeOwner || 'Your username'}
                />
              </div>
            )}
            {form.scope === 'shared' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Source</label>
                <Input
                  value={form.source}
                  onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))}
                  placeholder="Where this came from"
                />
              </div>
            )}
          </div>
          {form.scope === 'user' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Source</label>
                <Input
                  value={form.source}
                  onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))}
                  placeholder="Where this came from"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Created By</label>
                <Input
                  value={form.created_by}
                  onChange={(e) => setForm((p) => ({ ...p, created_by: e.target.value }))}
                  placeholder="Your name"
                />
              </div>
            </div>
          )}
          {form.scope === 'shared' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Created By</label>
              <Input
                value={form.created_by}
                onChange={(e) => setForm((p) => ({ ...p, created_by: e.target.value }))}
                placeholder="Your name"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !form.title.trim() || !form.content.trim()}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {entry ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
