import { useState } from 'react';
import { Bot } from 'lucide-react';
import { Button } from './ui/button.js';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip.js';
import GenericLaunchDialog from './GenericLaunchDialog.js';
import { useAISession } from '../hooks/useAISession.js';
import type { CodexReasoningEffort, ProviderId } from '../lib/launch-flags.js';

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
    options?: { model?: string; reasoningEffort?: CodexReasoningEffort },
  ) {
    setDialogOpen(false);
    launchSession({
      cwd: projectDir,
      prompt: finalPrompt,
      providerId: selectedProviderId ?? providerId,
      model: options?.model,
      reasoningEffort: options?.reasoningEffort,
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
          availableDirs={[]}
          initialProvider={providerId}
          onLaunch={handleLaunch}
        />
      )}
    </>
  );
}
