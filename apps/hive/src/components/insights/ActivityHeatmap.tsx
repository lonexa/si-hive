interface ActivityHeatmapProps {
  hourCounts: Record<string, number>;
}

export default function ActivityHeatmap({ hourCounts }: ActivityHeatmapProps) {
  const maxCount = Math.max(...Object.values(hourCounts), 1);

  const hours = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    count: hourCounts[String(i)] ?? 0,
  }));

  return (
    <div>
      <div className="grid grid-cols-12 gap-1">
        {hours.map(({ hour, count }) => {
          const intensity = count / maxCount;
          return (
            <div
              key={hour}
              className="aspect-square rounded-sm flex items-center justify-center text-[10px] cursor-default transition-colors"
              style={{
                backgroundColor: count > 0
                  ? `hsl(217, 91%, ${85 - intensity * 50}%)`
                  : 'hsl(var(--muted))',
              }}
              title={`${hour}:00 — ${count} session${count !== 1 ? 's' : ''}`}
            >
              <span className={count > 0 ? 'text-white/80' : 'text-muted-foreground/50'}>
                {hour}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>11 PM</span>
      </div>
    </div>
  );
}
