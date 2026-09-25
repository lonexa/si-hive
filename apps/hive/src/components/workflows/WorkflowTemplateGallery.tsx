import { TrendingUp, Eye, FileInput, Activity, Newspaper, type LucideIcon } from 'lucide-react';
import { Button } from '@hive/shared/components/ui/button';
import type { WorkflowTemplate } from '@/stores/workflow-store';

const ICON_MAP: Record<string, LucideIcon> = {
  TrendingUp, Eye, FileInput, Activity, Newspaper,
};

interface Props {
  templates: WorkflowTemplate[];
  onSelect: (template: WorkflowTemplate) => void;
}

function cronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;

  if (cron.startsWith('*/5')) return 'Every 5 minutes';
  if (cron.startsWith('0 *')) return 'Every hour';

  const h = parseInt(hour);
  const m = parseInt(min);
  const timeStr = `${h > 12 ? h - 12 : h}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;

  if (dow === '1-5') return `${timeStr} weekdays`;
  if (dow === '*') return `${timeStr} daily`;
  return `${timeStr} (${dow})`;
}

export function WorkflowTemplateGallery({ templates, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {templates.map((t) => {
        const Icon = ICON_MAP[t.icon] || Activity;
        return (
          <Button
            key={t.id}
            variant="outline"
            className="h-auto p-4 flex flex-col items-start gap-2 text-left hover:border-primary"
            onClick={() => onSelect(t)}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-primary" />
              <span className="font-medium text-sm">{t.name}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{t.description}</p>
            <span className="text-xs text-muted-foreground/70 mt-1">
              Default: {cronToHuman(t.defaultCron)}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
