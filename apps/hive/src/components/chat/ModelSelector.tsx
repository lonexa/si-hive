import { Bot, ChevronDown, Check } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

const MODELS = [
  { id: 'claude-fable-5', name: 'Fable 5', description: 'Latest flagship model' },
  { id: 'claude-opus-4-8', name: 'Opus 4.8', description: 'Latest flagship Opus' },
  { id: 'claude-opus-4-7', name: 'Opus 4.7', description: 'Previous Opus' },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', description: 'Earlier Opus' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', description: 'Fast and capable' },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: 'Fast and lightweight' },
];

interface Props {
  value?: string;
  onChange: (model: string) => void;
}

export default function ModelSelector({ value, onChange }: Props) {
  const currentModel = MODELS.find((m) => m.id === value) ?? MODELS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
          <Bot className="h-3 w-3" />
          {currentModel.name}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {MODELS.map((model) => (
          <DropdownMenuItem
            key={model.id}
            className="gap-2 cursor-pointer"
            onClick={() => onChange(model.id)}
          >
            <Check className={`h-3.5 w-3.5 ${model.id === currentModel.id ? 'opacity-100' : 'opacity-0'}`} />
            <div className="flex-1">
              <div className="text-sm font-medium">{model.name}</div>
              <div className="text-[11px] text-muted-foreground">{model.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
