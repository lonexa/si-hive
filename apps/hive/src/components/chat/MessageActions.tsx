import { Copy, RotateCcw, ThumbsUp, ThumbsDown, Pencil } from 'lucide-react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface Props {
  isUser: boolean;
  onCopy: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
}

export default function MessageActions({ isUser, onCopy, onRetry, onEdit }: Props) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="absolute -top-8 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-md px-1 py-0.5">
        <ActionButton icon={Copy} label="Copy" onClick={onCopy} />
        {isUser && onEdit && (
          <ActionButton icon={Pencil} label="Edit" onClick={onEdit} />
        )}
        {!isUser && onRetry && (
          <ActionButton icon={RotateCcw} label="Retry" onClick={onRetry} />
        )}
        {!isUser && (
          <>
            <ActionButton icon={ThumbsUp} label="Good response" hoverColor="hover:text-green-500" onClick={() => {}} />
            <ActionButton icon={ThumbsDown} label="Poor response" hoverColor="hover:text-destructive" onClick={() => {}} />
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

function ActionButton({ icon: Icon, label, onClick, hoverColor }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  hoverColor?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={`h-6 w-6 rounded-md hover:bg-accent flex items-center justify-center text-muted-foreground ${hoverColor ?? 'hover:text-foreground'} transition-colors`}
          onClick={onClick}
        >
          <Icon className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}
