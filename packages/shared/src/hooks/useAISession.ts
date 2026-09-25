import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildProviderArgs, getPrimaryProviderId } from '../lib/launch-flags.js';
import type { CodexReasoningEffort, ProviderId } from '../lib/launch-flags.js';

export interface LaunchOptions {
  cwd: string;
  prompt: string;
  /** Start this session incognito (nothing about it is logged off-machine). */
  incognito?: boolean;
  label?: string;
  subtitle?: string;
  contextPaths?: string[];
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  permissionMode?: string;
  providerId?: ProviderId;
  /** Credential identity to launch under; omitted = the provider's default. */
  accountId?: string;
}

export interface GenericLaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  subtitle?: string;
  suggestedPrompt: string;
  projectDir: string;
  availableDirs: string[];
  onLaunch: (
    finalPrompt: string,
    projectDir: string,
    providerId?: ProviderId,
    options?: { model?: string; reasoningEffort?: CodexReasoningEffort; accountId?: string },
  ) => void;
  loading?: boolean;
}

export function useAISession() {
  const navigate = useNavigate();
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    label: string;
    subtitle?: string;
    suggestedPrompt: string;
    projectDir: string;
    availableDirs: string[];
    contextPaths?: string[];
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
    permissionMode?: string;
    incognito?: boolean;
  }>({
    open: false,
    label: '',
    suggestedPrompt: '',
    projectDir: '',
    availableDirs: [],
  });

  const spawnSession = useCallback(async (cwd: string, prompt: string, opts?: {
    contextPaths?: string[];
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
    permissionMode?: string;
    providerId?: ProviderId;
    accountId?: string;
    incognito?: boolean;
  }) => {
    const providerId = opts?.providerId ?? await getPrimaryProviderId();
    const { command, args } = await buildProviderArgs(providerId, prompt, {
      contextPaths: opts?.contextPaths,
      model: opts?.model,
      reasoningEffort: opts?.reasoningEffort,
      permissionMode: opts?.permissionMode,
    });
    sessionStorage.setItem('hive-terminal-spawn', JSON.stringify({
      cwd,
      command,
      args,
      initialPrompt: prompt,
      provider: providerId,
      account: opts?.accountId,
      incognito: opts?.incognito === true,
    }));
    navigate('/sessions');
  }, [navigate]);

  const launchSession = useCallback(async (opts: LaunchOptions) => {
    await spawnSession(opts.cwd, opts.prompt, {
      contextPaths: opts.contextPaths,
      model: opts.model,
      reasoningEffort: opts.reasoningEffort,
      permissionMode: opts.permissionMode,
      providerId: opts.providerId,
      accountId: opts.accountId,
      incognito: opts.incognito,
    });
  }, [spawnSession]);

  const openLaunchDialog = useCallback((opts: LaunchOptions & { availableDirs?: string[] }) => {
    setDialogState({
      open: true,
      label: opts.label || 'Open in AI',
      subtitle: opts.subtitle,
      suggestedPrompt: opts.prompt,
      projectDir: opts.cwd,
      availableDirs: opts.availableDirs || [],
      contextPaths: opts.contextPaths,
      model: opts.model,
      reasoningEffort: opts.reasoningEffort,
      permissionMode: opts.permissionMode,
      incognito: opts.incognito,
    });
  }, []);

  const handleDialogLaunch = useCallback(async (
    finalPrompt: string,
    projectDir: string,
    providerId?: ProviderId,
    options?: { model?: string; reasoningEffort?: CodexReasoningEffort; accountId?: string },
  ) => {
    setDialogState((prev) => ({ ...prev, open: false }));
    await spawnSession(projectDir, finalPrompt, {
      contextPaths: dialogState.contextPaths,
      model: options?.model ?? dialogState.model,
      reasoningEffort: options?.reasoningEffort ?? dialogState.reasoningEffort,
      permissionMode: dialogState.permissionMode,
      providerId,
      accountId: options?.accountId,
      incognito: dialogState.incognito,
    });
  }, [spawnSession, dialogState.contextPaths, dialogState.model, dialogState.reasoningEffort, dialogState.permissionMode, dialogState.incognito]);

  const dialogProps: GenericLaunchDialogProps = {
    open: dialogState.open,
    onOpenChange: (open) => setDialogState((prev) => ({ ...prev, open })),
    label: dialogState.label,
    subtitle: dialogState.subtitle,
    suggestedPrompt: dialogState.suggestedPrompt,
    projectDir: dialogState.projectDir,
    availableDirs: dialogState.availableDirs,
    onLaunch: handleDialogLaunch,
  };

  return { launchSession, openLaunchDialog, dialogProps };
}
