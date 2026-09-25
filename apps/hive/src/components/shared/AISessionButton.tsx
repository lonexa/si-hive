import { useState, useEffect } from 'react';
import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import GenericLaunchDialog from './GenericLaunchDialog';
import { useAISession } from '@/hooks/useAISession';
import { getAvailableDirs } from '@/lib/project-mappings';
import type { CodexReasoningEffort, ProviderId } from '@/lib/launch-flags';

interface AISessionButtonProps {
  cwd: string;
  prompt: string;
  label?: string;
  dialogLabel?: string;
  dialogSubtitle?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'icon-only';
  size?: 'sm' | 'default' | 'icon';
  showDialog?: boolean;
  className?: string;
  tooltip?: string;
  providerId?: ProviderId;
}

export default function AISessionButton({
  cwd,
  prompt,
  label,
  dialogLabel,
  dialogSubtitle,
  variant = 'ghost',
  size = 'sm',
  showDialog = true,
  className,
  tooltip,
  providerId,
}: AISessionButtonProps) {
  const { launchSession } = useAISession();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availableDirs, setAvailableDirs] = useState<string[]>([]);

  useEffect(() => {
    if (dialogOpen && availableDirs.length === 0) {
      getAvailableDirs().then(setAvailableDirs);
    }
  }, [dialogOpen, availableDirs.length]);

  async function handleClick() {
    if (showDialog) {
      setDialogOpen(true);
    } else {
      await launchSession({ cwd, prompt, providerId });
    }
  }

  function handleLaunch(
    finalPrompt: string,
    projectDir: string,
    selectedProviderId?: ProviderId,
    options?: { model?: string; reasoningEffort?: CodexReasoningEffort; accountId?: string },
  ) {
    setDialogOpen(false);
    launchSession({
      cwd: projectDir,
      prompt: finalPrompt,
      providerId: selectedProviderId ?? providerId,
      model: options?.model,
      reasoningEffort: options?.reasoningEffort,
      accountId: options?.accountId,
    });
  }

  const isIconOnly = variant === 'icon-only' || size === 'icon';
  const buttonVariant = variant === 'icon-only' ? 'ghost' : variant;

  const btn = (
    <Button
      variant={buttonVariant}
      size={isIconOnly ? 'icon' : size}
      className={className}
      onClick={handleClick}
    >
      <Bot className={isIconOnly ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5 mr-1.5'} />
      {!isIconOnly && (label || 'Open in AI')}
    </Button>
  );

  return (
    <>
      {tooltip ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{btn}</TooltipTrigger>
            <TooltipContent><p>{tooltip}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : btn}

      {showDialog && (
        <GenericLaunchDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          label={dialogLabel || label || 'Open in AI'}
          subtitle={dialogSubtitle}
          suggestedPrompt={prompt}
          projectDir={cwd}
          availableDirs={availableDirs}
          initialProvider={providerId}
          onLaunch={handleLaunch}
        />
      )}
    </>
  );
}
