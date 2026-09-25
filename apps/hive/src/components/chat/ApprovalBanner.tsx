import { ShieldAlert, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PendingApproval } from '@/stores/chat-store';

interface Props {
  approval: PendingApproval;
  onApprove: () => void;
  onReject: () => void;
}

export default function ApprovalBanner({ approval, onApprove, onReject }: Props) {
  return (
    <div className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Claude needs your permission
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {approval.description}
          </p>
          {approval.rawText && approval.rawText !== approval.description && (
            <pre className="mt-2 text-[11px] text-muted-foreground bg-secondary rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-[100px] overflow-y-auto">
              {approval.rawText}
            </pre>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={onReject}
            className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
          >
            <X className="h-3.5 w-3.5" />
            Deny
          </Button>
          <Button
            size="sm"
            onClick={onApprove}
            className="gap-1.5"
          >
            <Check className="h-3.5 w-3.5" />
            Allow
          </Button>
        </div>
      </div>
    </div>
  );
}
