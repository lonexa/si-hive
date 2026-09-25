import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import ProjectPathPicker from '@/components/shared/ProjectPathPicker';
import ProviderPicker from '@hive/shared/components/ProviderPicker';
import AccountPicker from '@hive/shared/components/AccountPicker';
import {
  CODEX_REASONING_EFFORTS,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_CODEX_MODEL,
  getDefaultAccountId,
  getDefaultCodexReasoningEffort,
  getProviderModels,
  getProviderStatus,
  getPrimaryProviderId,
  getSelectableAccounts,
} from '@/lib/launch-flags';
import type { CodexReasoningEffort, ProviderId, ProviderStatus } from '@/lib/launch-flags';

export interface GenericLaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  subtitle?: string;
  suggestedPrompt: string;
  projectDir: string;
  availableDirs: string[];
  initialProvider?: ProviderId;
  onLaunch: (
    finalPrompt: string,
    projectDir: string,
    providerId?: ProviderId,
    options?: { model?: string; reasoningEffort?: CodexReasoningEffort; accountId?: string },
  ) => void;
  loading?: boolean;
}

export default function GenericLaunchDialog({
  open, onOpenChange, label, subtitle,
  suggestedPrompt, onLaunch, loading, projectDir = '', availableDirs = [], initialProvider,
}: GenericLaunchDialogProps) {
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [selectedDir, setSelectedDir] = useState('');
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [selectedAccount, setSelectedAccount] = useState<string>(DEFAULT_ACCOUNT_ID);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_CODEX_MODEL);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<CodexReasoningEffort>(
    getDefaultCodexReasoningEffort(DEFAULT_CODEX_MODEL),
  );

  useEffect(() => {
    if (open) {
      getProviderStatus().then((ps) => {
        const enabled = ps.filter((p) => p.enabled);
        setProviders(enabled);
      });
      if (initialProvider) {
        setSelectedProvider(initialProvider);
      } else {
        getPrimaryProviderId().then(setSelectedProvider);
      }
    }
  }, [open, initialProvider]);

  const effectiveDir = selectedDir || projectDir;
  const codexModels = selectedProvider === 'codex' ? getProviderModels('codex', providers) : [];
  // Only accounts that can actually be launched (default + authenticated ones).
  // With one account the row is hidden entirely — identical to the pre-accounts UI.
  const accounts = getSelectableAccounts(selectedProvider, providers);

  // Account ids are provider-scoped, so reset when the provider changes.
  useEffect(() => {
    setSelectedAccount(getDefaultAccountId(selectedProvider, providers));
  }, [selectedProvider, providers]);

  function handleLaunch() {
    let finalPrompt = suggestedPrompt;
    const trimmed = additionalInfo.trim();
    if (trimmed) {
      finalPrompt = finalPrompt
        ? `${finalPrompt}\n\nAdditional context from the user:\n${trimmed}`
        : trimmed;
    }
    onLaunch(
      finalPrompt,
      effectiveDir,
      selectedProvider,
      selectedProvider === 'codex'
        ? { model: selectedModel, reasoningEffort: selectedReasoningEffort, accountId: selectedAccount }
        : { accountId: selectedAccount },
    );
    setAdditionalInfo('');
    setSelectedDir('');
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setAdditionalInfo('');
      setSelectedDir('');
    }
    onOpenChange(next);
  }

  function handleModelChange(model: string) {
    setSelectedModel(model);
    setSelectedReasoningEffort(getDefaultCodexReasoningEffort(model));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-visible">
        <DialogHeader>
          <DialogTitle>{label || 'Open in AI'}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {providers.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">AI Provider</label>
                <div>
                  <ProviderPicker
                    value={selectedProvider}
                    onChange={setSelectedProvider}
                    enabledProviders={providers}
                    size="sm"
                  />
                </div>
              </div>
            )}

            {accounts.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Account</label>
                <div>
                  <AccountPicker
                    value={selectedAccount}
                    onChange={setSelectedAccount}
                    accounts={accounts}
                    size="sm"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Same skills, agents and session history either way — only the
                  subscription being billed changes.
                </p>
              </div>
            )}

            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}

            {selectedProvider === 'codex' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Model</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {codexModels.map((model) => (
                      <option key={model.id} value={model.id}>{model.displayName}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Reasoning</label>
                  <select
                    value={selectedReasoningEffort}
                    onChange={(e) => setSelectedReasoningEffort(e.target.value as CodexReasoningEffort)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {CODEX_REASONING_EFFORTS.map((effort) => (
                      <option key={effort.id} value={effort.id}>{effort.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <ProjectPathPicker
              value={effectiveDir}
              onChange={setSelectedDir}
              availableDirs={availableDirs}
            />

            {suggestedPrompt && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Prompt preview
                </label>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">
                  {suggestedPrompt}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Additional instructions (optional)
              </label>
              <Textarea
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
                placeholder="Add any extra context or constraints..."
                rows={3}
                className="resize-y text-sm"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleLaunch} disabled={loading || !effectiveDir}>
            Launch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
