interface BarSegment {
  value: number;
  color: string;
  label: string;
}

interface BarChartProps {
  data: { label: string; value: number; segments?: BarSegment[] }[];
  maxHeight?: number;
  barColor?: string;
  stacked?: boolean;
}

export default function BarChart({ data, maxHeight = 120, barColor = 'bg-blue-500', stacked = false }: BarChartProps) {
  const maxVal = Math.max(
    ...data.map((d) => {
      if (stacked && d.segments) {
        return d.segments.reduce((sum, s) => sum + s.value, 0);
      }
      return d.value;
    }),
    1
  );

  return (
    <div className="flex items-end gap-1" style={{ height: maxHeight }}>
      {data.map((d, i) => {
        const totalValue = stacked && d.segments
          ? d.segments.reduce((sum, s) => sum + s.value, 0)
          : d.value;
        const totalHeight = (totalValue / maxVal) * maxHeight;

        return (
          <div key={i} className="flex flex-col items-center flex-1 min-w-0 group">
            <div className="relative w-full flex justify-center">
              {stacked && d.segments ? (
                <div
                  className="w-full max-w-8 flex flex-col-reverse rounded-t overflow-hidden"
                  style={{ height: Math.max(totalHeight, 2) }}
                  title={d.segments.map((s) => `${s.label}: ${s.value}`).join('\n')}
                >
                  {d.segments.map((seg, si) => {
                    const segHeight = totalValue > 0 ? (seg.value / totalValue) * 100 : 0;
                    return (
                      <div
                        key={si}
                        style={{ height: `${segHeight}%`, backgroundColor: seg.color }}
                        className="transition-all duration-200 group-hover:opacity-80"
                      />
                    );
                  })}
                </div>
              ) : (
                <div
                  className={`w-full max-w-8 rounded-t ${barColor} transition-all duration-200 group-hover:opacity-80`}
                  style={{ height: Math.max(totalHeight, 2) }}
                  title={`${d.label}: ${d.value.toLocaleString()}`}
                />
              )}
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                {totalValue.toLocaleString()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
