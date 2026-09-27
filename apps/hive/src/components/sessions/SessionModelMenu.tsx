import { Bot, Check, ChevronDown, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  formatModelDisplay,
  getProviderModels,
  PROVIDER_SHORT_NAMES,
  type ProviderId,
  type ProviderStatus,
} from '@/lib/launch-flags';

interface SessionModelMenuProps {
  provider: ProviderId;
  providerStatuses: ProviderStatus[];
  currentModel?: string;
  onModelSelect: (modelId: string) => void;
  /**
   * Set when the session runs on a local model endpoint. The model is pinned by
   * the endpoint, so the Anthropic model list does not apply — show it read-only.
   */
  localModel?: string;
}

export default function SessionModelMenu({
  provider,
  providerStatuses,
  currentModel,
  onModelSelect,
  localModel,
}: SessionModelMenuProps) {
  if (localModel) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        className="gap-1.5 text-muted-foreground disabled:opacity-100"
        title="This session runs on a local model. Switch it from the account menu."
      >
        <Cpu className="h-4 w-4" />
        <span className="max-w-40 truncate">{localModel}</span>
        <span className="font-mono text-[9px] leading-none rounded bg-amber-500/20 text-amber-300 px-1 py-0.5">
          LOCAL
        </span>
      </Button>
    );
  }

  const models = getProviderModels(provider, providerStatuses);
  const activeModel = models.find((model) => model.id === currentModel);
  const label = activeModel?.displayName
    ?? (currentModel ? formatModelDisplay(provider, currentModel) : 'Model');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Change model for this session"
        >
          <Bot className="h-4 w-4" />
          <span className="max-w-28 truncate">{label}</span>
          <span className="font-mono text-[9px] leading-none rounded bg-accent px-1 py-0.5">
            {PROVIDER_SHORT_NAMES[provider]}
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {providerStatuses.find((p) => p.id === provider)?.displayName ?? provider}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {models.map((model) => {
          const selected = model.id === currentModel;
          return (
            <DropdownMenuItem
              key={model.id}
              onClick={() => onModelSelect(model.id)}
              className="gap-2 cursor-pointer"
            >
              <Check className={cn('h-3.5 w-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{model.displayName}</div>
                <div className="text-[11px] text-muted-foreground truncate">{model.id}</div>
                {model.description && (
                  <div className="text-[11px] text-muted-foreground/80 truncate">{model.description}</div>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
