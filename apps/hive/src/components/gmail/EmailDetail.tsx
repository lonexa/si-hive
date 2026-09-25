import { ArrowLeft, Clock } from 'lucide-react';
import { Button } from '@hive/shared/components/ui/button';
import { Badge } from '@hive/shared/components/ui/badge';
import { ScrollArea } from '@hive/shared/components/ui/scroll-area';
import { Separator } from '@hive/shared/components/ui/separator';
import AISessionButton from '@hive/shared/components/AISessionButton';
import { useGmailStore } from '@/stores/gmail-store';

export default function EmailDetail() {
  const { selectedMessage, setSelectedMessage } = useGmailStore();

  if (!selectedMessage) return null;

  const { subject, from, to, cc, date, body, isUnread } = selectedMessage;

  function formatFullDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleString([], {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Build a plain-text excerpt of the body for the Claude prompt
  function stripHtml(html: string): string {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  const plainBody = stripHtml(body).slice(0, 3000);
  const claudePrompt = `Analyze this email and suggest a response:\n\nSubject: ${subject}\nFrom: ${from}\n\n${plainBody}`;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedMessage(null)}
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Inbox
        </Button>
        <AISessionButton
          cwd="."
          prompt={claudePrompt}
          label="+Claude"
          dialogLabel="Analyze Email with Claude"
          dialogSubtitle={subject}
          variant="outline"
          size="sm"
        />
      </div>

      {/* Email metadata */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold leading-tight">{subject}</h2>
          {isUnread && (
            <Badge variant="default" className="flex-shrink-0">Unread</Badge>
          )}
        </div>

        <div className="text-sm space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-10">From</span>
            <span className="font-medium">{from}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-10">To</span>
            <span>{to}</span>
          </div>
          {cc && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-10">Cc</span>
              <span>{cc}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-xs">{formatFullDate(date)}</span>
          </div>
        </div>
      </div>

      <Separator />

      {/* Email body */}
      <ScrollArea className="h-[calc(100vh-320px)] rounded-md border p-4">
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: body }}
        />
      </ScrollArea>
    </div>
  );
}
