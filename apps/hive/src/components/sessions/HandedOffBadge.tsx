import { Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHandoffLock } from '@/lib/peer-handoff';

/** "On <peer>" chip for a session whose live copy is on another Hive. */
export default function HandedOffBadge({ sessionId, className }: { sessionId: string; className?: string }) {
  const lock = useHandoffLock(sessionId);
  if (!lock) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 text-[10px] text-sky-500 shrink-0', className)}
      title={`Running on ${lock.peerLabel} since ${new Date(lock.since).toLocaleString()}`}
    >
      <Server className="h-2.5 w-2.5" />
      {lock.peerLabel}
    </span>
  );
}
