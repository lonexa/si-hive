import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TicketStats } from '@/stores/types';

interface TicketsSummaryProps {
  ticketStats: TicketStats | null;
}

const STATE_COLORS: Record<string, string> = {
  'In Progress': '#3b82f6',
  'Testing': '#f59e0b',
  'Completed': '#22c55e',
  'Active': '#8b5cf6',
};

export default function TicketsSummary({ ticketStats }: TicketsSummaryProps) {
  if (!ticketStats) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Tickets & Work</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-sm py-4 text-center">
            No ticket tracker connected. Connect one in Settings → Integrations to see ticket data.
          </div>
        </CardContent>
      </Card>
    );
  }

  const total = ticketStats.activeTickets + ticketStats.completedThisSprint;
  const segments = [
    { label: 'In Progress', count: ticketStats.inProgress, color: STATE_COLORS['In Progress'] },
    { label: 'Testing', count: ticketStats.testing, color: STATE_COLORS['Testing'] },
    { label: 'Active', count: Math.max(0, ticketStats.activeTickets - ticketStats.inProgress - ticketStats.testing), color: STATE_COLORS['Active'] },
    { label: 'Completed', count: ticketStats.completedThisSprint, color: STATE_COLORS['Completed'] },
  ].filter((s) => s.count > 0);

  // Build conic gradient
  let gradientParts: string[] = [];
  let currentDeg = 0;
  for (const seg of segments) {
    const segDeg = total > 0 ? (seg.count / total) * 360 : 0;
    gradientParts.push(`${seg.color} ${currentDeg}deg ${currentDeg + segDeg}deg`);
    currentDeg += segDeg;
  }
  const gradient = gradientParts.length > 0
    ? `conic-gradient(${gradientParts.join(', ')})`
    : 'conic-gradient(hsl(var(--muted)) 0deg 360deg)';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Tickets & Work</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          {/* Donut chart */}
          <div className="relative shrink-0">
            <div
              className="w-24 h-24 rounded-full"
              style={{ background: gradient }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-card flex items-center justify-center">
                <span className="text-lg font-bold">{total}</span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="space-y-1.5 flex-1">
            {segments.map((seg) => (
              <div key={seg.label} className="flex items-center gap-2 text-xs">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-muted-foreground">{seg.label}</span>
                <span className="font-medium ml-auto">{seg.count}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
