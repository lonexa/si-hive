import { ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

/** Mirrors ConfigField in apps/hive/server/integrations/types.ts. */
export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'secret' | 'select' | 'boolean';
  required?: boolean;
  placeholder?: string;
  help?: string;
  helpUrl?: string;
  options?: { value: string; label: string }[];
  default?: string | boolean;
}

export type SchemaValues = Record<string, string | boolean | undefined>;

interface Props {
  fields: ConfigField[];
  values: SchemaValues;
  onChange: (key: string, value: string | boolean) => void;
  /** Masked value of already-saved secrets (e.g. "••••abcd"), keyed by field. */
  savedSecrets?: Record<string, string>;
}

/**
 * Renders a provider's declarative settings schema. Used by Settings →
 * Integrations (and login providers), so adding a provider never needs UI code.
 */
export default function SchemaForm({ fields, values, onChange, savedSecrets = {} }: Props) {
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const value = values[f.key] ?? f.default;
        const help = (f.help || f.helpUrl) && (
          <p className="text-xs text-muted-foreground">
            {f.help}
            {f.helpUrl && (
              <a href={f.helpUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">
                Docs <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </p>
        );

        if (f.type === 'boolean') {
          return (
            <div key={f.key} className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <span className="text-sm font-medium text-foreground">{f.label}</span>
                {help}
              </div>
              <Switch checked={value === true} onCheckedChange={(v) => onChange(f.key, v)} />
            </div>
          );
        }

        return (
          <label key={f.key} className="block space-y-1">
            <span className="text-sm font-medium text-foreground">
              {f.label}
              {f.required && <span className="text-destructive"> *</span>}
            </span>
            {f.type === 'select' ? (
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(f.key, e.target.value)}
              >
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <Input
                type={f.type === 'secret' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                autoComplete={f.type === 'secret' ? 'new-password' : 'off'}
                value={typeof value === 'string' ? value : ''}
                placeholder={f.type === 'secret' && savedSecrets[f.key] ? `Saved (${savedSecrets[f.key]}) — leave blank to keep` : f.placeholder}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            )}
            {help}
          </label>
        );
      })}
    </div>
  );
}
