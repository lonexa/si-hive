// Re-export shared utilities
export { cn, timeAgo, statusColor, statusBgColor, eventTypeColor, eventTypeBgColor, eventTypeIcon, sessionStatusLabel, terminalLabel, formatFullDate, shortProject, getSessionDisplayName } from './lib/utils';
export { useThemeEffect, getStoredTheme } from './hooks/useTheme';

// Re-export types
export type * from './stores/types';
