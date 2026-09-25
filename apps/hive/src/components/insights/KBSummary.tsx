import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KBStats } from '@/stores/types';

interface KBSummaryProps {
  kbStats: KBStats | null;
}

const CATEGORY_COLORS = [
  '#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

export default function KBSummary({ kbStats }: KBSummaryProps) {
  if (!kbStats) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Knowledge Base</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-sm py-4 text-center">
            Knowledge Base not configured. Set KB environment variables to see entries.
          </div>
        </CardContent>
      </Card>
    );
  }

  const categoryEntries = Object.entries(kbStats.categoryCounts).sort((a, b) => b[1] - a[1]);
  const total = kbStats.totalEntries || 1;

  // Build conic gradient for category donut
  let gradientParts: string[] = [];
  let currentDeg = 0;
  categoryEntries.forEach(([, count], i) => {
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    const segDeg = (count / total) * 360;
    gradientParts.push(`${color} ${currentDeg}deg ${currentDeg + segDeg}deg`);
    currentDeg += segDeg;
  });
  const gradient = gradientParts.length > 0
    ? `conic-gradient(${gradientParts.join(', ')})`
    : 'conic-gradient(hsl(var(--muted)) 0deg 360deg)';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Knowledge Base</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-6">
          {/* Category donut */}
          <div className="relative shrink-0">
            <div
              className="w-20 h-20 rounded-full"
              style={{ background: gradient }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-card flex items-center justify-center">
                <span className="text-sm font-bold">{kbStats.totalEntries}</span>
              </div>
            </div>
          </div>

          {/* Category legend */}
          <div className="space-y-1 flex-1 max-h-20 overflow-y-auto">
            {categoryEntries.slice(0, 6).map(([cat, count], i) => (
              <div key={cat} className="flex items-center gap-2 text-xs">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                />
                <span className="text-muted-foreground truncate">{cat}</span>
                <span className="font-medium ml-auto shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent entries */}
        {kbStats.recentEntries.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">Recent Entries</div>
            <div className="space-y-1.5">
              {kbStats.recentEntries.map((entry, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate">{entry.title}</span>
                  <span className="text-muted-foreground shrink-0 ml-2">{entry.category}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
